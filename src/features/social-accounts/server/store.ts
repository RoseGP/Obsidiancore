/**
 * Persistence for connected accounts (server only).
 *
 * Per-user documents plus a small key→value "owners" table that guarantees a
 * channel (and a shared-workspace connection lock) belongs to one user.
 *
 *   createFirestoreStore  production: Firestore, one transaction per change
 *   createFileStore       development / single instance: JSON file on disk
 *   createAutoStore       Firestore when credentials resolve, else the file store
 *
 * Select with SOCIAL_ACCOUNTS_STORE=firestore | file | auto (default auto).
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { AccountPlatform, AttemptStatus, ConnectionMethod } from '../shared/types';
import type { Sealed } from './config';

export interface StoredConnection {
  id: string;
  platform: AccountPlatform;
  method: ConnectionMethod;
  /** Postiz integration id, or the provider's account id for direct connections. */
  externalId: string;
  name: string;
  handle?: string;
  pictureUrl?: string;
  connectedAt: string;
  lastVerifiedAt?: string;
  problem?: { status: 'expired' | 'needs_attention'; detail: string };
  /** Direct connections: encrypted provider credential. */
  secret?: Sealed;
  meta?: Record<string, string>;
}

export interface StoredAttempt {
  id: string;
  platform: AccountPlatform | null; // null = Postiz workspace authorization
  kind: 'workspace' | 'channel';
  status: AttemptStatus;
  baseline: string[];
  reconnectOf?: string;
  resume?: AccountPlatform;
  returnsToApp: boolean;
  createdAt: string;
  expiresAt: string;
  detail?: string;
}

/** Server-side record of a post: proves ownership and keeps what Postiz's list omits. */
export interface PostIndexEntry {
  connectionId: string;
  channelId: string;
  group: string;
  publishAt: string;
  /** Created through this app (media known), vs. found in the workspace. */
  createdByApp: boolean;
  media?: { id: string; path: string }[];
  updatedAt: string;
}

export interface UserDoc {
  userId: string;
  posts?: Record<string, PostIndexEntry>;
  /** Media this user uploaded to the workspace, keyed by its Postiz path (reused instead of re-uploading). */
  uploads?: Record<string, { id: string; path: string; at: string }>;
  /** Encrypted Postiz access token (pos_…) for this user's workspace. */
  postizWorkspace?: { token: Sealed; name?: string; authorizedAt: string; revokedAt?: string };
  connections: StoredConnection[];
  attempts: StoredAttempt[];
}

/** Owner entries loaded for one update. Writes are applied when the update commits. */
export interface OwnersTx {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
  delete(key: string): void;
}

export interface AccountsStore {
  readonly kind: 'file' | 'firestore';
  getUser(userId: string): Promise<UserDoc>;
  getOwner(key: string): Promise<string | undefined>;
  /**
   * Atomic read-modify-write of one user's document and the listed owner keys.
   * `fn` must not do other I/O; throwing aborts the change.
   */
  updateUser<T>(userId: string, ownerKeys: string[], fn: (u: UserDoc, owners: OwnersTx) => T): Promise<T>;
}

export const emptyUser = (userId: string): UserDoc => ({ userId, connections: [], attempts: [] });

/** Finished attempts older than a day are dropped to keep documents small. */
function prune(u: UserDoc) {
  const cutoff = Date.now() - 86_400_000;
  u.attempts = u.attempts.filter((a) => a.status === 'pending' || new Date(a.createdAt).getTime() > cutoff);
  if (u.posts) {
    // Keep the index bounded: drop entries older than ~13 months, cap at 3000.
    const old = Date.now() - 400 * 86_400_000;
    const entries = Object.entries(u.posts).filter(([, e]) => new Date(e.publishAt).getTime() > old)
      .sort((a, b) => b[1].publishAt.localeCompare(a[1].publishAt)).slice(0, 3000);
    u.posts = Object.fromEntries(entries);
  }
}

function makeOwnersTx(loaded: Map<string, string | undefined>) {
  const changes = new Map<string, string | null>();
  const tx: OwnersTx = {
    get: (k) => {
      if (changes.has(k)) return changes.get(k) ?? undefined;
      if (!loaded.has(k)) throw new Error(`Owner key "${k}" wasn't loaded for this update.`);
      return loaded.get(k);
    },
    set: (k, v) => { changes.set(k, v); },
    delete: (k) => { changes.set(k, null); },
  };
  return { tx, changes };
}

// ---------- File store ----------

interface FileShape { users: Record<string, UserDoc>; owners: Record<string, string> }

export function createFileStore(dataDir: string): AccountsStore {
  const file = path.resolve(dataDir, 'accounts.json');
  let chain: Promise<unknown> = Promise.resolve();

  async function load(): Promise<FileShape> {
    try {
      const s = JSON.parse(await fs.readFile(file, 'utf8')) as FileShape;
      return { users: s.users ?? {}, owners: s.owners ?? {} };
    } catch (err: any) {
      if (err?.code === 'ENOENT') return { users: {}, owners: {} };
      throw err;
    }
  }
  async function save(s: FileShape) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(s), { mode: 0o600 });
    await fs.rename(tmp, file);
  }

  return {
    kind: 'file',
    async getUser(userId) { return structuredClone((await load()).users[userId] ?? emptyUser(userId)); },
    async getOwner(key) { return (await load()).owners[key]; },
    updateUser(userId, ownerKeys, fn) {
      const run = chain.catch(() => undefined).then(async () => {
        const s = await load();
        const u = structuredClone(s.users[userId] ?? emptyUser(userId));
        const { tx, changes } = makeOwnersTx(new Map(ownerKeys.map((k) => [k, s.owners[k]])));
        const result = fn(u, tx);
        prune(u);
        s.users[userId] = u;
        for (const [k, v] of changes) { if (v === null) delete s.owners[k]; else s.owners[k] = v; }
        await save(s);
        return result;
      });
      chain = run;
      return run;
    },
  };
}

// ---------- Firestore store ----------

/** Minimal surface of firebase-admin Firestore used here (kept narrow so it can be faked in tests). */
export interface FirestoreLike {
  collection(name: string): { doc(id: string): any };
  runTransaction<T>(fn: (tx: { get(ref: any): Promise<{ exists: boolean; data(): any }>; set(ref: any, data: any): void; delete(ref: any): void }) => Promise<T>): Promise<T>;
}

const docId = (key: string) => (/^[A-Za-z0-9_.@-]{1,200}$/.test(key) && !key.startsWith('__') ? key : `b64_${Buffer.from(key).toString('base64url')}`);

export function createFirestoreStore(db: FirestoreLike, prefix = 'social_account'): AccountsStore {
  const users = db.collection(`${prefix}_users`);
  const owners = db.collection(`${prefix}_owners`);
  const toUser = (userId: string, data: any): UserDoc => ({
    userId,
    postizWorkspace: data?.postizWorkspace ?? undefined,
    posts: data?.posts && typeof data.posts === 'object' ? data.posts : undefined,
    connections: Array.isArray(data?.connections) ? data.connections : [],
    attempts: Array.isArray(data?.attempts) ? data.attempts : [],
  });
  // Firestore rejects `undefined` values; JSON round-trip drops them.
  const clean = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

  return {
    kind: 'firestore',
    async getUser(userId) {
      const snap = await users.doc(docId(userId)).get();
      return toUser(userId, snap.exists ? snap.data() : null);
    },
    async getOwner(key) {
      const snap = await owners.doc(docId(key)).get();
      return snap.exists ? snap.data()?.value : undefined;
    },
    updateUser(userId, ownerKeys, fn) {
      return db.runTransaction(async (t) => {
        // Firestore transactions: every read happens before any write.
        const userRef = users.doc(docId(userId));
        const keys = [...new Set(ownerKeys)];
        const [userSnap, ...ownerSnaps] = await Promise.all([t.get(userRef), ...keys.map((k) => t.get(owners.doc(docId(k))))]);
        const u = toUser(userId, userSnap.exists ? userSnap.data() : null);
        const loaded = new Map(keys.map((k, i) => [k, ownerSnaps[i].exists ? ownerSnaps[i].data()?.value : undefined]));
        const { tx, changes } = makeOwnersTx(loaded);
        const result = fn(u, tx);
        prune(u);
        t.set(userRef, clean({ ...u, updatedAt: new Date().toISOString() }));
        for (const [k, v] of changes) {
          const ref = owners.doc(docId(k));
          if (v === null) t.delete(ref); else t.set(ref, { key: k, value: v, updatedAt: new Date().toISOString() });
        }
        return result;
      });
    },
  };
}

// ---------- Selection ----------

/**
 * Resolves the store on first use. "auto" checks that Firestore credentials
 * actually resolve and have read permissions before using it: without valid
 * IAM permissions or credentials, the Firebase SDK throws PERMISSION_DENIED;
 * verifying first lets the file store seamlessly take over.
 */
export function createAutoStore(mode: 'auto' | 'firestore' | 'file', dataDir: string, isProduction: boolean): AccountsStore & { ready(): Promise<'file' | 'firestore'> } {
  let resolved: Promise<AccountsStore> | null = null;
  const fileStore = createFileStore(dataDir);

  const resolve = () => (resolved ??= (async () => {
    if (mode === 'file') return fileStore;
    try {
      const { adminApp, adminDb } = await import('../../../lib/firebaseAdmin');
      const cred: any = (adminApp as any).options?.credential;
      if (cred?.getAccessToken) {
        await cred.getAccessToken();
        // Verify actual Firestore permissions by executing a lightweight limit(1) read
        await (adminDb as any).collection('social_account_users').limit(1).get();
        const firestoreStore = createFirestoreStore(adminDb as unknown as FirestoreLike);
        
        // Wrap with resilient fallback in case permissions change or expire
        return {
          kind: 'firestore' as const,
          async getUser(userId: string) {
            try {
              return await firestoreStore.getUser(userId);
            } catch (err: any) {
              if (err?.code === 7 || err?.message?.includes('PERMISSION_DENIED')) {
                console.warn('[social-accounts] Firestore PERMISSION_DENIED on getUser; using local file store');
                return fileStore.getUser(userId);
              }
              throw err;
            }
          },
          async getOwner(key: string) {
            try {
              return await firestoreStore.getOwner(key);
            } catch (err: any) {
              if (err?.code === 7 || err?.message?.includes('PERMISSION_DENIED')) {
                console.warn('[social-accounts] Firestore PERMISSION_DENIED on getOwner; using local file store');
                return fileStore.getOwner(key);
              }
              throw err;
            }
          },
          async updateUser<T>(userId: string, ownerKeys: string[], fn: (u: UserDoc, owners: OwnersTx) => T): Promise<T> {
            try {
              return await firestoreStore.updateUser(userId, ownerKeys, fn);
            } catch (err: any) {
              if (err?.code === 7 || err?.message?.includes('PERMISSION_DENIED')) {
                console.warn('[social-accounts] Firestore PERMISSION_DENIED on updateUser; using local file store');
                return fileStore.updateUser(userId, ownerKeys, fn);
              }
              throw err;
            }
          }
        };
      }
    } catch (probeErr: any) {
      if (mode === 'firestore') {
        throw new Error(`SOCIAL_ACCOUNTS_STORE=firestore but Firestore access failed: ${probeErr?.message || probeErr}`);
      }
      console.warn(`[social-accounts] Firestore credentials unavailable or lack permissions (${probeErr?.message || probeErr}); using local file store at ${dataDir}.${isProduction ? ' Configure Firestore IAM roles for production.' : ''}`);
      return fileStore;
    }
    if (mode === 'firestore') throw new Error('SOCIAL_ACCOUNTS_STORE=firestore but Firestore credentials are unavailable.');
    console.warn(`[social-accounts] Firestore credentials unavailable; using the file store at ${dataDir}.${isProduction ? ' Configure Firestore for production.' : ''}`);
    return fileStore;
  })());

  const proxy: any = {
    get kind() { return 'pending'; },
    ready: async () => (await resolve()).kind,
    getUser: async (id: string) => (await resolve()).getUser(id),
    getOwner: async (k: string) => (await resolve()).getOwner(k),
    updateUser: async (id: string, keys: string[], fn: any) => (await resolve()).updateUser(id, keys, fn),
  };
  return proxy;
}
