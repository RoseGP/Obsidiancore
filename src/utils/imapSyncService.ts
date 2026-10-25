import { ImapFlow } from 'imapflow';
import { wsDispatcher } from './wsDispatcher';

// Synchronization result metadata
export interface ImapSyncResult {
  success: boolean;
  mailbox: string;
  condstoreSupported: boolean;
  initialHighestModSeq: string;
  newHighestModSeq: string;
  syncedMessagesCount: number;
  changesFetchedCount: number;
  syncType: 'INCREMENTAL_CONDSTORE' | 'FULL_SYNC_FALLBACK';
  logs: string[];
}

// Queue item structure for thread-safe lock execution
interface SyncQueueItem {
  mailboxName: string;
  lastModSeq: string;
  resolve: (value: ImapSyncResult) => void;
  reject: (reason: any) => void;
}

/**
 * Advanced Stateful IMAP Incremental Sync Engine
 * Built to leverage CONDSTORE for ultra-fast, delta-only updates.
 */
export class ImapSyncEngine {
  private client: ImapFlow;
  private isProcessing: boolean = false;
  private queue: SyncQueueItem[] = [];
  private logs: string[] = [];

  constructor(authConfig: {
    host: string;
    port: number;
    secure: boolean;
    auth: {
      user: string;
      pass: string;
    };
  }) {
    // Instantiate ImapFlow with optimized buffer and timeout configurations
    this.client = new ImapFlow({
      host: authConfig.host,
      port: authConfig.port,
      secure: authConfig.secure,
      auth: {
        user: authConfig.auth.user,
        pass: authConfig.auth.pass,
      },
      logger: false, // Disables raw verbose output to keep system terminal pristine
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 30000,
    });
  }

  /**
   * Safe Logger Utility
   */
  private log(message: string) {
    const timestamp = new Date().toISOString();
    const formatted = `[IMAP Sync Engine] [${timestamp}] ${message}`;
    console.log(formatted);
    this.logs.push(formatted);
  }

  /**
   * Thread-Safe Sync Execution Wrapper
   * Guarantees non-overlapping sync cycles on the same IMAP mailbox.
   */
  public async queueSync(mailboxName: string = 'INBOX', lastModSeq: string = '0'): Promise<ImapSyncResult> {
    return new Promise((resolve, reject) => {
      this.log(`Queueing synchronization request for mailbox: "${mailboxName}" (Last ModSeq: ${lastModSeq})`);
      
      this.queue.push({
        mailboxName,
        lastModSeq,
        resolve,
        reject
      });

      this.processQueueNext();
    });
  }

  /**
   * Asynchronous sequential queue processing loop
   */
  private async processQueueNext() {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;
    const item = this.queue.shift()!;

    try {
      this.log(`Acquired concurrency lock. Commencing synchronization for: "${item.mailboxName}"`);
      const result = await this.executeSyncWithRetry(item.mailboxName, item.lastModSeq);
      item.resolve(result);
    } catch (err) {
      item.reject(err);
    } finally {
      this.isProcessing = false;
      this.log(`Released concurrency lock.`);
      // Stagger next queue execution slightly
      setTimeout(() => this.processQueueNext(), 50);
    }
  }

  /**
   * Resilience Wrapper with Exponential Backoff
   */
  private async executeSyncWithRetry(
    mailboxName: string, 
    lastModSeq: string, 
    attempt: number = 1, 
    maxAttempts: number = 3
  ): Promise<ImapSyncResult> {
    try {
      return await this.syncMailboxIncremental(mailboxName, lastModSeq);
    } catch (error: any) {
      this.log(`Error encountered during attempt ${attempt}/${maxAttempts}: ${error.message}`);
      
      if (attempt >= maxAttempts) {
        this.log(`Resilience threshold reached. Failing synchronization loop permanently.`);
        throw error;
      }

      // Calculate exponential backoff duration (2^attempt * 1000 ms)
      const backoffMs = Math.pow(2, attempt) * 1000;
      this.log(`Backing off for ${backoffMs}ms before executing retry attempt...`);
      await new Promise(resolve => setTimeout(resolve, backoffMs));
      
      return this.executeSyncWithRetry(mailboxName, lastModSeq, attempt + 1, maxAttempts);
    }
  }

  /**
   * Core stateful incremental sync engine using CONDSTORE capability
   */
  private async syncMailboxIncremental(mailboxName: string, lastModSeq: string): Promise<ImapSyncResult> {
    this.logs = []; // Reset instance synchronization logs
    this.log(`Connecting to secure IMAP server...`);
    
    await this.client.connect();
    this.log(`Successfully authenticated.`);

    let mailboxInfo;
    try {
      mailboxInfo = await this.client.mailboxOpen(mailboxName, { readOnly: true });
      this.log(`Mailbox "${mailboxName}" opened. Total Messages: ${mailboxInfo.exists}`);
    } catch (openError: any) {
      await this.client.logout();
      throw new Error(`Failed to open target mailbox: ${openError.message}`);
    }

    // Retrieve current server highestModseq (returns bigint or undefined if unsupported)
    const serverHighestModSeqBigInt = mailboxInfo.highestModseq;
    const condstoreSupported = serverHighestModSeqBigInt !== undefined;
    
    let initialHighestModSeq = lastModSeq;
    if (initialHighestModSeq === '0' || !initialHighestModSeq) {
      try {
        const { adminDb } = await import('../lib/firebaseAdmin');
        const docSnap = await adminDb.collection('imap_sync_checkpoints').doc(mailboxName).get();
        if (docSnap.exists) {
          const data = docSnap.data();
          if (data && data.highestModseq) {
            initialHighestModSeq = data.highestModseq;
            this.log(`Resolved last saved Modseq from Firestore for "${mailboxName}": ${initialHighestModSeq}`);
          }
        }
      } catch (dbErr: any) {
        this.log(`Warning: Failed to load last Modseq from Firestore: ${dbErr.message}`);
      }
    }

    const currentHighestModSeqString = condstoreSupported 
      ? serverHighestModSeqBigInt.toString() 
      : '0';

    this.log(`CONDSTORE support evaluated: ${condstoreSupported ? 'ENABLED' : 'DISABLED'}`);
    if (condstoreSupported) {
      this.log(`Server highestModseq: ${currentHighestModSeqString}. Database last Modseq: ${initialHighestModSeq}`);
    }

    let syncedMessagesCount = 0;
    let changesFetchedCount = 0;
    let syncType: 'INCREMENTAL_CONDSTORE' | 'FULL_SYNC_FALLBACK' = 'FULL_SYNC_FALLBACK';

    const syncedDeltas: any[] = [];

    // Attempt CONDSTORE incremental sync
    if (condstoreSupported && BigInt(initialHighestModSeq) > 0n) {
      syncType = 'INCREMENTAL_CONDSTORE';
      this.log(`Initiating incremental sync since Modseq: ${initialHighestModSeq}...`);

      try {
        // Query server for any flag or metadata modifications changed since our highestModseq
        const fetchRange = '1:*';
        const queryOptions: any = {
          uid: true,
          flags: true,
          modseq: true,
          envelope: true,
        };
        const searchModifiers = {
          changedSince: BigInt(initialHighestModSeq)
        };

        const fetchGenerator = this.client.fetch(fetchRange, queryOptions, searchModifiers);

        for await (const msg of fetchGenerator) {
          changesFetchedCount++;
          syncedDeltas.push({
            uid: msg.uid,
            seq: msg.seq,
            flags: Array.from(msg.flags || []),
            modseq: msg.modseq?.toString(),
            subject: msg.envelope?.subject || '(No Subject)',
            from: msg.envelope?.from?.[0]?.address || 'unknown',
            date: msg.envelope?.date,
            action: 'UPDATE_METADATA_FLAGS'
          });
        }

        this.log(`Incremental delta fetch complete. Found ${changesFetchedCount} changed messages.`);
      } catch (incrementalFetchError: any) {
        this.log(`Incremental fetch failed: ${incrementalFetchError.message}. Recoil to standard sync.`);
        syncType = 'FULL_SYNC_FALLBACK';
      }
    }

    // Full Sync Fallback: Triggered if CONDSTORE is unsupported, or if we have no prior saved Modseq
    if (syncType === 'FULL_SYNC_FALLBACK') {
      this.log(`Executing standard full envelope synchronization for the mailbox (limit: 50 latest messages)...`);
      
      const totalMsg = mailboxInfo.exists;
      if (totalMsg > 0) {
        const startSeq = Math.max(1, totalMsg - 49);
        const fetchRange = `${startSeq}:${totalMsg}`;
        
        const fetchGenerator = this.client.fetch(fetchRange, {
          uid: true,
          flags: true,
          envelope: true,
          modseq: condstoreSupported ? true : undefined
        } as any);

        for await (const msg of fetchGenerator) {
          syncedMessagesCount++;
          syncedDeltas.push({
            uid: msg.uid,
            seq: msg.seq,
            flags: Array.from(msg.flags || []),
            modseq: msg.modseq?.toString() || '0',
            subject: msg.envelope?.subject || '(No Subject)',
            from: msg.envelope?.from?.[0]?.address || 'unknown',
            date: msg.envelope?.date,
            action: 'INITIAL_IMPORT_SYNC'
          });
        }
      }
      this.log(`Standard sync completed. Synced ${syncedMessagesCount} messages.`);
    }

    // Always log out gracefully to recycle secure ports
    await this.client.logout();
    this.log(`Disconnected from IMAP server safely.`);

    // Persist highestModseq checkpoint to Firestore
    try {
      const { adminDb } = await import('../lib/firebaseAdmin');
      const checkpointRef = adminDb.collection('imap_sync_checkpoints').doc(mailboxName);
      await checkpointRef.set({
        mailboxName,
        highestModseq: currentHighestModSeqString,
        lastSyncTime: new Date().toISOString(),
        syncType,
        syncedMessagesCount,
        changesFetchedCount
      }, { merge: true });
      this.log(`Saved IMAP sync checkpoint for "${mailboxName}" to Firestore: modseq=${currentHighestModSeqString}`);
    } catch (dbErr: any) {
      this.log(`Warning: Failed to save IMAP checkpoint to Firestore: ${dbErr.message}`);
    }

    // Dispatch a real-time WebSocket notification to keep frontend pipelines accurate
    wsDispatcher.broadcast('IMAP_SYNCHRONIZED', {
      mailboxName,
      syncType,
      changesCount: syncedDeltas.length,
      newHighestModSeq: currentHighestModSeqString,
      timestamp: new Date().toISOString(),
    });

    return {
      success: true,
      mailbox: mailboxName,
      condstoreSupported,
      initialHighestModSeq,
      newHighestModSeq: currentHighestModSeqString,
      syncedMessagesCount,
      changesFetchedCount,
      syncType,
      logs: [...this.logs]
    };
  }
}
