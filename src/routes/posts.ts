import { Router, Request, Response } from 'express';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import firebaseConfigJson from '../../firebase-applet-config.json';
import { encryptToken, decryptToken } from '../utils/cryptoSecurity';
import { socialPublisherManager } from '../services/publisher/SocialPublisherManager';
import { DecryptedAccountCredentials, SupportedSocialPlatform } from '../services/publisher/types';

const router = Router();

// Validate Firebase DB Id
function isValidDatabaseId(dbId: string | undefined): boolean {
  if (!dbId) return false;
  if (dbId === '(default)') return true;
  return /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/.test(dbId);
}

const resolvedProjectId = process.env.VITE_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || firebaseConfigJson.projectId;
const envDbId = process.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID || process.env.FIREBASE_FIRESTORE_DATABASE_ID;
const resolvedDatabaseId = isValidDatabaseId(envDbId)
  ? envDbId
  : (isValidDatabaseId(firebaseConfigJson.firestoreDatabaseId) ? firebaseConfigJson.firestoreDatabaseId : undefined);

const adminApp = getApps().length === 0
  ? initializeApp({ projectId: resolvedProjectId })
  : getApps()[0];

const firestore = resolvedDatabaseId
  ? getFirestore(adminApp, resolvedDatabaseId)
  : getFirestore(adminApp);

/**
 * Firestore is only used when credentials actually resolve. Without them the
 * Firebase SDK rejects a promise nobody awaits, which crashes the whole
 * Node process; checking first lets the in-memory fallback below take over.
 */
const firestoreReady: Promise<boolean> = (async () => {
  try {
    const credential: any = (adminApp as any).options?.credential;
    if (!credential?.getAccessToken) return false;
    await credential.getAccessToken();
    // Verify actual Firestore read permissions
    await firestore.collection('posts').limit(1).get();
    return true;
  } catch {
    console.warn('[Posts Router] Firestore credentials unavailable or lack permissions; using the in-memory post store.');
    return false;
  }
})();

async function requireFirestore() {
  if (!(await firestoreReady)) throw new Error('Firestore is not configured');
  return firestore;
}

// In-Memory Fallback Store for High-Availability and Dev Environments
interface MemoryScheduledPost {
  id: string;
  userId: string;
  content: string;
  caption: string;
  mediaUrls: string[];
  platforms: string[];
  scheduledAt: string;
  status: 'draft' | 'pending' | 'published' | 'failed' | 'processing';
  publishedAt?: string;
  failureReason?: string;
  createdAt: string;
  updatedAt: string;
}

interface MemorySocialAccount {
  id: string;
  userId: string;
  platform: string;
  handle: string;
  encryptedToken: string;
  iv: string;
  authTag: string;
  instanceUrl?: string;
  updatedAt: string;
}

const inMemoryPosts: MemoryScheduledPost[] = [];
const inMemoryAccounts: MemorySocialAccount[] = [
  {
    id: 'acc_linkedin_demo',
    userId: 'demo-user-123',
    platform: 'linkedin',
    handle: '@sarah_jenkins_lead',
    ...encryptToken('mock_linkedin_token_live'),
    updatedAt: new Date().toISOString()
  },
  {
    id: 'acc_x_demo',
    userId: 'demo-user-123',
    platform: 'x',
    handle: '@flowforge',
    ...encryptToken('mock_x_bearer_token'),
    updatedAt: new Date().toISOString()
  },
  {
    id: 'acc_bluesky_demo',
    userId: 'demo-user-123',
    platform: 'bluesky',
    handle: '@sarah.bsky.social',
    ...encryptToken('mock_bsky_app_pass_xyz'),
    updatedAt: new Date().toISOString()
  },
  {
    id: 'acc_mastodon_demo',
    userId: 'demo-user-123',
    platform: 'mastodon',
    handle: '@sarah_crm',
    instanceUrl: 'https://mastodon.social',
    ...encryptToken('mock_mastodon_access_token'),
    updatedAt: new Date().toISOString()
  }
];

// Helper to extract or fallback userId from request
/**
 * The caller, as verified by requireUser (server.ts mounts this router behind it).
 * Client-supplied userId / raw bearer strings are no longer trusted.
 */
function resolveUserId(req: Request): string {
  const id = (req as any).accountUser?.id;
  if (!id) throw Object.assign(new Error('Unauthenticated request reached the legacy posts router.'), { status: 401 });
  return id;
}

type EditableStatus = 'draft' | 'pending';

/** Loads a post the caller owns, from Firestore or the in-memory fallback. */
async function loadOwnedPost(postId: string, userId: string): Promise<{ data: any; source: 'firestore' | 'memory' } | { error: number; message: string }> {
  try {
    const snap = await (await requireFirestore()).collection('posts').doc(postId).get();
    if (snap.exists) {
      const data = snap.data() as any;
      if (data.userId && data.userId !== userId) return { error: 404, message: 'Post not found.' };
      return { data, source: 'firestore' };
    }
  } catch (e) { /* Firestore unavailable: fall through to memory */ }
  const mem = inMemoryPosts.find((p) => p.id === postId);
  if (!mem || mem.userId !== userId) return { error: 404, message: 'Post not found.' };
  return { data: mem, source: 'memory' };
}

/**
 * PATH: POST /api/posts/schedule
 * Schedules a multi-platform social media post with encrypted token validation
 */
router.post('/schedule', async (req: Request, res: Response) => {
  try {
    const userId = resolveUserId(req);
    const { 
      content, 
      text, 
      caption, 
      platforms, 
      platformTargets, 
      scheduledAt, 
      targetUtcTime, 
      executionTimestamp,
      mediaUrls, 
      mediaUrl,
      status: requestedStatus
    } = req.body;
    const initialStatus: EditableStatus = requestedStatus === 'draft' ? 'draft' : 'pending';

    const postContent = (content || text || caption || '').trim();
    const targetPlatforms: string[] = (platforms || platformTargets || ['linkedin']).map((p: string) => p.toLowerCase());
    const finalScheduledAt = scheduledAt || targetUtcTime || executionTimestamp;
    const finalMediaUrls: string[] = Array.isArray(mediaUrls) 
      ? mediaUrls 
      : (mediaUrls ? [mediaUrls] : (mediaUrl ? [mediaUrl] : []));

    // 1. Validation
    if (!postContent) {
      return res.status(400).json({
        success: false,
        error: 'Validation Error: Post content / caption cannot be empty.'
      });
    }

    if (!finalScheduledAt) {
      return res.status(400).json({
        success: false,
        error: 'Validation Error: target timestamp (scheduledAt) is required.'
      });
    }

    const scheduledDate = new Date(finalScheduledAt);
    if (isNaN(scheduledDate.getTime())) {
      return res.status(400).json({
        success: false,
        error: 'Validation Error: Invalid datetime timestamp format provided.'
      });
    }

    if (targetPlatforms.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Validation Error: At least one target platform must be selected.'
      });
    }

    const postId = `post_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const nowIso = new Date().toISOString();

    // 2. Fetch User Connected Accounts and Decrypt Tokens to Verify Readiness
    let verifiedAccounts: string[] = [];
    try {
      const accountsSnapshot = await (await requireFirestore())
        .collection('social_accounts')
        .where('userId', '==', userId)
        .get();

      if (!accountsSnapshot.empty) {
        accountsSnapshot.forEach(docSnap => {
          const acc = docSnap.data();
          if (acc.encryptedToken && acc.iv && acc.authTag) {
            try {
              decryptToken(acc.encryptedToken, acc.iv, acc.authTag);
              verifiedAccounts.push(acc.platform);
            } catch (e) {}
          }
        });
      }
    } catch (dbErr: any) {
      // Fallback verification from in-memory accounts
      const userMemoryAccounts = inMemoryAccounts.filter(a => a.userId === userId);
      verifiedAccounts = userMemoryAccounts.map(a => a.platform);
    }

    // 3. Persist in Firestore
    const postRecord = {
      id: postId,
      userId,
      content: postContent,
      caption: postContent,
      mediaUrls: finalMediaUrls,
      platforms: targetPlatforms,
      scheduled_at: Timestamp.fromDate(scheduledDate),
      scheduledAt: scheduledDate.toISOString(),
      status: initialStatus, // 'draft' | 'pending' | 'processing' | 'published' | 'failed'
      retry_count: 0,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now()
    };

    let savedInFirestore = false;
    try {
      await (await requireFirestore()).collection('posts').doc(postId).set(postRecord);
      savedInFirestore = true;
      console.log(`[Posts Router] Post ${postId} saved to Firestore successfully.`);
    } catch (fsErr: any) {
      console.warn(`[Posts Router] Firestore set bypassed, using memory store: ${fsErr.message}`);
    }

    // Also update in-memory list for instant synchronous response
    inMemoryPosts.unshift({
      id: postId,
      userId,
      content: postContent,
      caption: postContent,
      mediaUrls: finalMediaUrls,
      platforms: targetPlatforms,
      scheduledAt: scheduledDate.toISOString(),
      status: initialStatus,
      createdAt: nowIso,
      updatedAt: nowIso
    });

    return res.status(201).json({
      success: true,
      message: initialStatus === 'draft' ? 'Draft saved.' : 'Social media post scheduled successfully.',
      postId,
      post: {
        id: postId,
        content: postContent,
        caption: postContent,
        platforms: targetPlatforms,
        scheduledAt: scheduledDate.toISOString(),
        mediaUrls: finalMediaUrls,
        status: initialStatus
      },
      verification: {
        verifiedPlatforms: verifiedAccounts.filter(p => targetPlatforms.includes(p.toLowerCase())),
        encryptedAtRest: true,
        savedInFirestore
      }
    });

  } catch (error: any) {
    console.error('[POST /api/posts/schedule Error]:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal Server Error',
      details: error.message
    });
  }
});

/**
 * PATH: GET /api/posts/queue
 * Retrieves pending scheduled posts with optional status filter, sorting, and user filtering
 */
router.get('/queue', async (req: Request, res: Response) => {
  try {
    const userId = resolveUserId(req);
    const statusFilter = (req.query.status as string || 'pending').toLowerCase();
    const limitNum = Math.min(Math.max(parseInt(req.query.limit as string || '50', 10) || 50, 1), 1000);
    const fromMs = req.query.from ? new Date(req.query.from as string).getTime() : NaN;
    const toMs = req.query.to ? new Date(req.query.to as string).getTime() : NaN;
    const inRange = (iso: string) => {
      const t = new Date(iso).getTime();
      if (!Number.isNaN(fromMs) && t < fromMs) return false;
      if (!Number.isNaN(toMs) && t > toMs) return false;
      return true;
    };

    let queueItems: any[] = [];

    // Attempt querying Firestore
    try {
 // Only the caller's posts.
      let queryRef: any = (await requireFirestore()).collection('posts').where('userId', '==', userId);
      
      if (statusFilter && statusFilter !== 'all') {
        queryRef = queryRef.where('status', '==', statusFilter);
      }

      const snapshot = await queryRef.get();
      if (!snapshot.empty) {
        snapshot.forEach((docSnap: any) => {
          const d = docSnap.data();
          const scheduledTimeIso = d.scheduled_at?.toDate?.() 
            ? d.scheduled_at.toDate().toISOString() 
            : (d.scheduledAt || new Date().toISOString());

          queueItems.push({
            id: docSnap.id,
            userId: d.userId,
            content: d.content || d.caption || '',
            caption: d.content || d.caption || '',
            mediaUrls: d.mediaUrls || [],
            platforms: d.platforms || [],
            scheduledAt: scheduledTimeIso,
            status: d.status || 'pending',
            failureReason: d.failure_reason || d.failureReason || d.error,
            publishedAt: d.actual_publish_time?.toDate?.() ? d.actual_publish_time.toDate().toISOString() : d.publishedAt,
            createdAt: d.createdAt?.toDate?.() ? d.createdAt.toDate().toISOString() : d.createdAt
          });
        });
      }
    } catch (fsErr: any) {
      console.warn(`[Posts Router] Firestore query fallback to memory: ${fsErr.message}`);
    }

    // Merge in-memory posts to ensure no pending records are dropped in local preview
    const mergedMap = new Map<string, any>();
    inMemoryPosts.forEach(p => {
      if (p.userId !== userId) return;
      if (!statusFilter || statusFilter === 'all' || p.status === statusFilter) {
        mergedMap.set(p.id, p);
      }
    });
    queueItems.forEach(p => mergedMap.set(p.id, p));

    const finalQueue = Array.from(mergedMap.values()).filter(p => inRange(p.scheduledAt)).sort((a, b) => {
      return new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime();
    }).slice(0, limitNum);

    return res.status(200).json({
      success: true,
      count: finalQueue.length,
      status: statusFilter,
      posts: finalQueue
    });

  } catch (error: any) {
    console.error('[GET /api/posts/queue Error]:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve scheduled posts queue',
      details: error.message
    });
  }
});

/**
 * PATH: GET /api/posts/accounts
 * Retrieves list of user's connected social accounts with tokens safely sanitized
 */
router.get('/accounts', async (req: Request, res: Response) => {
  try {
    const userId = resolveUserId(req);
    const accounts: any[] = [];

    try {
      const snap = await (await requireFirestore())
        .collection('social_accounts')
        .where('userId', '==', userId)
        .get();

      snap.forEach(d => {
        const data = d.data();
        accounts.push({
          id: d.id,
          platform: data.platform,
          handle: data.handle,
          instanceUrl: data.instanceUrl,
          connected: true,
          updatedAt: data.updatedAt
        });
      });
    } catch (e) {}

    // Merge with in-memory accounts
    inMemoryAccounts.filter(a => a.userId === userId).forEach(a => {
      if (!accounts.some(acc => acc.platform === a.platform)) {
        accounts.push({
          id: a.id,
          platform: a.platform,
          handle: a.handle,
          instanceUrl: a.instanceUrl,
          connected: true,
          updatedAt: a.updatedAt
        });
      }
    });

    return res.status(200).json({
      success: true,
      accounts
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PATH: POST /api/posts/accounts/connect
 * Connects an external social account (X, LinkedIn, Bluesky, Mastodon)
 * Stores tokens encrypted at rest using AES-256-GCM
 */
router.post('/accounts/connect', async (req: Request, res: Response) => {
  try {
    const userId = resolveUserId(req);
    const { platform, handle, accessToken, refreshToken, appPassword, instanceUrl } = req.body;

    if (!platform || !handle) {
      return res.status(400).json({
        success: false,
        error: 'platform and handle are required to connect an account.'
      });
    }

    const rawSecret = accessToken || appPassword || 'mock_token_dev_auth';
    const encrypted = encryptToken(rawSecret);
    const canonicalPlatform = platform.toLowerCase();
    const accountId = `acc_${canonicalPlatform}_${userId}`;
    const nowIso = new Date().toISOString();

    const accountRecord = {
      id: accountId,
      userId,
      platform: canonicalPlatform,
      handle,
      instanceUrl: instanceUrl || undefined,
      encryptedToken: encrypted.encryptedToken,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      refreshToken: refreshToken ? encryptToken(refreshToken).encryptedToken : undefined,
      updatedAt: Timestamp.now()
    };

    try {
      await (await requireFirestore()).collection('social_accounts').doc(accountId).set(accountRecord);
    } catch (e) {
      console.warn('[Posts Router] Firestore account save bypassed, saved in memory.');
    }

    const memoryIndex = inMemoryAccounts.findIndex(a => a.id === accountId);
    const memoryObj: MemorySocialAccount = {
      id: accountId,
      userId,
      platform: canonicalPlatform,
      handle,
      instanceUrl: instanceUrl || undefined,
      encryptedToken: encrypted.encryptedToken,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      updatedAt: nowIso
    };

    if (memoryIndex > -1) {
      inMemoryAccounts[memoryIndex] = memoryObj;
    } else {
      inMemoryAccounts.push(memoryObj);
    }

    return res.status(200).json({
      success: true,
      message: `Account for ${platform} connected successfully with AES-256 encryption.`,
      account: {
        id: accountId,
        platform: canonicalPlatform,
        handle,
        instanceUrl,
        connected: true
      }
    });

  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PATH: PATCH /api/posts/:id
 * Edits or reschedules a draft or scheduled post the caller owns.
 * Published and in-flight posts can't be changed.
 */
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const userId = resolveUserId(req);
    const postId = req.params.id;
    const found = await loadOwnedPost(postId, userId);
    if ('error' in found) return res.status(found.error).json({ success: false, error: found.message });
    const current = found.data;
    if (current.status === 'published' || current.status === 'processing') {
      return res.status(409).json({ success: false, error: 'Published or publishing posts can’t be edited.' });
    }

    const { content, platforms, scheduledAt, mediaUrls, status } = req.body || {};
    const updates: any = {};
    if (content !== undefined) {
      const text = String(content).trim();
      if (!text) return res.status(400).json({ success: false, error: 'Validation Error: Post content / caption cannot be empty.' });
      if (text.length > 63206) return res.status(400).json({ success: false, error: 'Validation Error: Post content is too long.' });
      updates.content = text;
      updates.caption = text;
    }
    if (platforms !== undefined) {
      if (!Array.isArray(platforms) || platforms.length === 0) {
        return res.status(400).json({ success: false, error: 'Validation Error: At least one target platform must be selected.' });
      }
      updates.platforms = platforms.map((p: string) => String(p).toLowerCase()).slice(0, 10);
    }
    if (scheduledAt !== undefined) {
      const d = new Date(scheduledAt);
      if (isNaN(d.getTime())) return res.status(400).json({ success: false, error: 'Validation Error: Invalid datetime timestamp format provided.' });
      updates.scheduledAt = d.toISOString();
    }
    if (mediaUrls !== undefined) {
      if (!Array.isArray(mediaUrls)) return res.status(400).json({ success: false, error: 'Validation Error: mediaUrls must be a list.' });
      updates.mediaUrls = mediaUrls.map(String).slice(0, 10);
    }
    if (status !== undefined) {
      if (status !== 'draft' && status !== 'pending') {
        return res.status(400).json({ success: false, error: 'Validation Error: status must be draft or pending.' });
      }
      updates.status = status;
    }
    const finalStatus = updates.status ?? current.status;
    const finalAt = updates.scheduledAt ?? current.scheduledAt;
    if (finalStatus === 'pending' && new Date(finalAt).getTime() < Date.now() - 60_000) {
      return res.status(400).json({ success: false, error: 'Validation Error: Scheduled time must be in the future.' });
    }
    // Rescheduling a failed post returns it to the queue.
    if (current.status === 'failed' && updates.status === undefined && (updates.scheduledAt || updates.content)) {
      updates.status = 'pending';
    }
    const nowIso = new Date().toISOString();

    if (found.source === 'firestore') {
      const fsUpdates: any = { ...updates, updatedAt: Timestamp.now() };
      if (updates.scheduledAt) fsUpdates.scheduled_at = Timestamp.fromDate(new Date(updates.scheduledAt));
      if (updates.status === 'pending') { fsUpdates.failure_reason = null; fsUpdates.error = null; }
      await (await requireFirestore()).collection('posts').doc(postId).update(fsUpdates);
    }
    const mem = inMemoryPosts.find(p => p.id === postId);
    if (mem) Object.assign(mem, updates, { updatedAt: nowIso }, updates.status === 'pending' ? { failureReason: undefined } : {});

    const merged = { ...current, ...updates };
    const scheduledIso = merged.scheduled_at?.toDate?.() && !updates.scheduledAt ? merged.scheduled_at.toDate().toISOString() : merged.scheduledAt;
    return res.status(200).json({
      success: true,
      post: {
        id: postId,
        content: merged.content || merged.caption || '',
        caption: merged.content || merged.caption || '',
        platforms: merged.platforms || [],
        mediaUrls: merged.mediaUrls || [],
        scheduledAt: scheduledIso,
        status: merged.status,
        failureReason: merged.status === 'failed' ? (merged.failure_reason || merged.failureReason) : undefined,
      }
    });
  } catch (error: any) {
    console.error('[PATCH /api/posts/:id Error]:', error);
    return res.status(500).json({ success: false, error: 'Failed to update post', details: error.message });
  }
});

/**
 * PATH: DELETE /api/posts/:id
 * Cancels or removes a scheduled post
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const postId = req.params.id;
    const owned = await loadOwnedPost(postId, resolveUserId(req));
    if ('error' in owned) return res.status(owned.error).json({ success: false, error: owned.message });

    try {
      await (await requireFirestore()).collection('posts').doc(postId).delete();
    } catch (e) {}

    const memIdx = inMemoryPosts.findIndex(p => p.id === postId);
    if (memIdx > -1) {
      inMemoryPosts.splice(memIdx, 1);
    }

    return res.status(200).json({
      success: true,
      message: `Scheduled post ${postId} removed.`
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PATH: POST /api/posts/retry/:id
 * Retries a failed post immediately
 */
router.post('/retry/:id', async (req: Request, res: Response) => {
  try {
    const postId = req.params.id;
    const owned = await loadOwnedPost(postId, resolveUserId(req));
    if ('error' in owned) return res.status(owned.error).json({ success: false, error: owned.message });
    if (owned.data.status !== 'failed') {
      return res.status(409).json({ success: false, error: 'Only failed posts can be retried.' });
    }

    // Reset status to pending
    try {
      await (await requireFirestore()).collection('posts').doc(postId).update({
        status: 'pending',
        failure_reason: null,
        error: null,
        updatedAt: Timestamp.now()
      });
    } catch (e) {}

    const memPost = inMemoryPosts.find(p => p.id === postId);
    if (memPost) {
      memPost.status = 'pending';
      memPost.failureReason = undefined;
    }

    return res.status(200).json({
      success: true,
      message: `Post ${postId} reset to pending for background scheduler pickup.`
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
export { inMemoryPosts, inMemoryAccounts };
