import { Worker, Job } from 'bullmq';
import crypto from 'crypto';
import axios from 'axios';
import { db } from '../utils/db';
import { wsDispatcher } from '../utils/wsDispatcher';
import { coreSecret } from '../utils/secrets';

// --- CONFIGURATION ---
const REDIS_HOST = process.env.REDIS_HOST || '127.0.0.1';
const REDIS_PORT = Number(process.env.REDIS_PORT) || 6379;
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;

const connection = {
  host: REDIS_HOST,
  port: REDIS_PORT,
  password: REDIS_PASSWORD,
  maxRetriesPerRequest: null, // Critical mandatory setting for BullMQ
};

// AES-256-GCM Secure Decryption Helper
function decryptToken(encryptedToken: string, ivHex: string, authTagHex: string): string {
  const algorithm = 'aes-256-gcm';
  const secretKey = coreSecret('ENCRYPTION_KEY', { length: 32 });
  
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const key = Buffer.alloc(32);
  Buffer.from(secretKey).copy(key);
  
  const decipher = crypto.createDecipheriv(algorithm, key, iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(encryptedToken, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

interface LinkedInJobData {
  postId: string;
  userId?: string;
}

// Global worker state
export let linkedinPostWorker: Worker<LinkedInJobData> | null = null;

export function initializeLinkedinPostWorker() {
  if (linkedinPostWorker) {
    return;
  }

  console.log('[LinkedIn Worker] Initializing Worker instance.');

  linkedinPostWorker = new Worker<LinkedInJobData>(
    'linkedin-post-queue',
    async (job: Job<LinkedInJobData>) => {
      const { postId } = job.data;
      console.log(`[LinkedIn Worker] Processing job ${job.id} for Post ID: ${postId}`);

      try {
        // 1. Fetch the SocialPost from the database
        const post = await db.socialPost.findUnique({
          where: { id: postId },
        });

        if (!post) {
          throw new Error(`SocialPost with ID ${postId} could not be found in the database.`);
        }

        // Verify state safety. We only process if SCHEDULED or FAILED
        if (post.status !== 'SCHEDULED' && post.status !== 'FAILED' && post.status !== 'PROCESSING') {
          console.warn(`[LinkedIn Worker] Skipping Post ${postId} due to invalid state: ${post.status}`);
          return { success: false, reason: 'Invalid post status for queue execution' };
        }

        // 2. Fetch the corresponding SocialAccount for LINKEDIN
        const userId = job.data.userId || post.createdById;
        const socialAccount = await db.socialAccount.findFirst({
          where: {
            userId: userId,
            platform: 'LINKEDIN',
          },
        });

        if (!socialAccount) {
          const errorMsg = `No LinkedIn SocialAccount found for user ID: ${userId}`;
          console.error(`[LinkedIn Worker] ${errorMsg}`);
          await db.socialPost.update({
            where: { id: postId },
            data: {
              status: 'FAILED',
              errorLog: errorMsg,
              updatedAt: new Date(),
            },
          });
          return { success: false, error: errorMsg };
        }

        // 3. Retrieve and Decrypt the Access Token
        const { accessToken: encryptedToken, iv, authTag } = socialAccount;
        if (!encryptedToken || !iv || !authTag) {
          const errorMsg = 'LinkedIn credentials incomplete: missing token, IV, or Auth Tag.';
          console.error(`[LinkedIn Worker] ${errorMsg}`);
          await db.socialPost.update({
            where: { id: postId },
            data: {
              status: 'FAILED',
              errorLog: errorMsg,
              updatedAt: new Date(),
            },
          });
          return { success: false, error: errorMsg };
        }

        let accessToken: string;
        try {
          accessToken = decryptToken(encryptedToken, iv, authTag);
        } catch (decryptErr: any) {
          const errorMsg = `Failed to decrypt LinkedIn Access Token: ${decryptErr.message}`;
          console.error(`[LinkedIn Worker] ${errorMsg}`);
          await db.socialPost.update({
            where: { id: postId },
            data: {
              status: 'FAILED',
              errorLog: errorMsg,
              updatedAt: new Date(),
            },
          });
          return { success: false, error: errorMsg };
        }

        // 4. Handle Mock bypass for Sandbox developer experience
        if (accessToken.startsWith('mock_') || accessToken === 'challenge') {
          console.log('[LinkedIn Worker] Sandbox/Mock access token detected. Simulating successful publishing.');
          const mockPostUrn = `urn:li:share:mock_share_${Math.floor(Math.random() * 99999999)}`;
          
          await db.socialPost.update({
            where: { id: postId },
            data: {
              status: 'PUBLISHED',
              errorLog: `Successfully published (Mock mode). Share ID: ${mockPostUrn}`,
              updatedAt: new Date(),
            },
          });

          // Broadcast status update over websockets to keep UI in sync
          wsDispatcher.broadcast('SOCIAL_POST_STATUS_UPDATED', {
            postId,
            status: 'PUBLISHED',
            platforms: ['LINKEDIN'],
            logs: `Successfully published (Mock mode). URN: ${mockPostUrn}`,
            timestamp: new Date().toISOString(),
          });

          return { success: true, postUrn: mockPostUrn };
        }

        // Update state to PROCESSING during live execution
        await db.socialPost.update({
          where: { id: postId },
          data: {
            status: 'PROCESSING',
            updatedAt: new Date(),
          },
        });

        // 5. Structure payload with author and commentary correctly
        const authorUrn = socialAccount.accountId.startsWith('urn:li:')
          ? socialAccount.accountId
          : `urn:li:person:${socialAccount.accountId}`;

        const commentary = post.body || post.caption || '';

        const payload = {
          author: authorUrn,
          commentary: commentary,
          visibility: 'PUBLIC',
          distribution: {
            feedDistribution: 'MAIN_FEED',
            targetEntities: [],
            thirdPartyDistributionChannels: [],
          },
          lifecycleState: 'PUBLISHED',
          isReshareDisabledByAuthor: false,
        };

        // 6. Set specific required headers, including critical versioning tags
        const headers = {
          'Authorization': `Bearer ${accessToken}`,
          'LinkedIn-Version': '202606',
          'X-Restli-Protocol-Version': '2.0.0',
          'Content-Type': 'application/json',
        };

        console.log(`[LinkedIn Worker] Constructing post request to https://api.linkedin.com/rest/posts for Post ID: ${postId}`);

        const response = await axios.post('https://api.linkedin.com/rest/posts', payload, {
          headers,
          timeout: 10000,
        });

        // 7. Successful publish (201 Created)
        if (response.status === 201) {
          // Extract the x-restli-id header (which represents the returned Post URN)
          const postUrn = response.headers['x-restli-id'] || response.headers['X-Restli-Id'] || response.data?.id || `urn:li:share:${Date.now()}`;
          const logMsg = `Successfully published to LinkedIn. Share ID: ${postUrn}`;
          console.log(`[LinkedIn Worker] Success. ${logMsg}`);

          await db.socialPost.update({
            where: { id: postId },
            data: {
              status: 'PUBLISHED',
              errorLog: logMsg,
              updatedAt: new Date(),
            },
          });

          // Broadcast to WebSocket clients
          wsDispatcher.broadcast('SOCIAL_POST_STATUS_UPDATED', {
            postId,
            status: 'PUBLISHED',
            platforms: ['LINKEDIN'],
            logs: logMsg,
            timestamp: new Date().toISOString(),
          });

          return { success: true, postUrn };
        } else {
          throw new Error(`Unexpected non-201 response status from LinkedIn: ${response.status}`);
        }

      } catch (error: any) {
        return await handleLinkedInWorkerError(error, job, postId);
      }
    },
    { connection }
  );

  // Worker Lifecycle Monitoring Logs
  linkedinPostWorker.on('completed', (job) => {
    console.log(`[LinkedIn Worker Success]: Job finished cleanly. ID: ${job.id}`);
  });

  linkedinPostWorker.on('failed', (job, err) => {
    console.error(`[LinkedIn Worker Failure]: Job ID ${job?.id} encountered standard retry termination or hard failure. Error: ${err.message}`);
  });
}

/**
 * Error-handling and circuit-breaker wrapper function for a LinkedIn publishing worker.
 * Handles rate limits (429) by updating job delay and setting status back to SCHEDULED,
 * and handles unrecoverable authorization failures (401/403) by marking state as FAILED
 * and canceling any remaining retries.
 */
export async function handleLinkedInWorkerError(
  error: any,
  job: Job<LinkedInJobData>,
  postId: string
): Promise<any> {
  let statusCode = 500;
  let responseData: any = null;

  if (axios.isAxiosError(error) && error.response) {
    statusCode = error.response.status;
    responseData = error.response.data;

    // --- 429 TOO MANY REQUESTS (RATE LIMITED) ---
    if (statusCode === 429) {
      console.warn(`[LinkedIn Worker] 429 Too Many Requests encountered for Post ID: ${postId}.`);

      let delayMs = 60000; // Default to 60 seconds
      const retryAfterHeader = error.response.headers['retry-after'] || error.response.headers['Retry-After'];
      
      if (retryAfterHeader) {
        const parsedSeconds = parseInt(retryAfterHeader, 10);
        if (!isNaN(parsedSeconds)) {
          delayMs = parsedSeconds * 1000;
          console.log(`[LinkedIn Worker] Parsed Retry-After in seconds: ${parsedSeconds}s (${delayMs}ms)`);
        } else {
          const parsedDate = Date.parse(retryAfterHeader);
          if (!isNaN(parsedDate)) {
            delayMs = Math.max(0, parsedDate - Date.now());
            console.log(`[LinkedIn Worker] Parsed Retry-After as date: ${retryAfterHeader} (${delayMs}ms remaining)`);
          }
        }
      }

      // Update the queue job delay dynamically in BullMQ
      try {
        job.opts.backoff = {
          type: 'fixed',
          delay: delayMs,
        };
        console.log(`[LinkedIn Worker] Dynamically updated job backoff delay to ${delayMs}ms.`);
      } catch (delayErr: any) {
        console.error(`[LinkedIn Worker] Failed to update job delay dynamically: ${delayErr.message}`);
      }

      const logMsg = `Rate limited by LinkedIn (429). Retrying after ${delayMs}ms.`;

      // Change internal post status back to SCHEDULED
      await db.socialPost.update({
        where: { id: postId },
        data: {
          status: 'SCHEDULED',
          errorLog: logMsg,
          updatedAt: new Date(),
        },
      });

      // Broadcast status update back to client
      wsDispatcher.broadcast('SOCIAL_POST_STATUS_UPDATED', {
        postId,
        status: 'SCHEDULED',
        platforms: ['LINKEDIN'],
        logs: logMsg,
        timestamp: new Date().toISOString(),
      });

      // Re-throw to trigger standard retry with the updated job delay
      throw new Error(`LinkedIn API rate limited (429): ${JSON.stringify(responseData || error.message)}`);
    }

    // --- UNRECOVERABLE ERRORS (401 Unauthorized / 403 Forbidden) ---
    if (statusCode === 401 || statusCode === 403) {
      const reason = statusCode === 401 ? 'expired or invalid OAuth token' : 'insufficient account permissions';
      const alertMsg = `CRITICAL: LinkedIn account authentication failed (${reason}). Action required: Please prompt the user to re-authenticate their account in the Settings menu.`;
      const logMsg = `LinkedIn API unrecoverable error (${statusCode}): ${JSON.stringify(responseData || error.message)}. ${alertMsg}`;
      
      console.error(`[LinkedIn Worker] ${alertMsg}`);

      // Immediately mark the database state as FAILED
      await db.socialPost.update({
        where: { id: postId },
        data: {
          status: 'FAILED',
          errorLog: logMsg,
          updatedAt: new Date(),
        },
      });

      // Broadcast status update back to client
      wsDispatcher.broadcast('SOCIAL_POST_STATUS_UPDATED', {
        postId,
        status: 'FAILED',
        platforms: ['LINKEDIN'],
        logs: logMsg,
        timestamp: new Date().toISOString(),
      });

      // Cancel any retries
      try {
        await job.discard();
        console.log(`[LinkedIn Worker] Retries cancelled/discarded for Job ID: ${job.id}`);
      } catch (discardErr: any) {
        console.error(`[LinkedIn Worker] Failed to discard job retries: ${discardErr.message}`);
      }

      return { success: false, error: logMsg, unrecoverable: true };
    }

    // --- OTHER TRANSIENT SERVER ERRORS (5xx) ---
    if (statusCode >= 500 && statusCode < 600) {
      console.warn(`[LinkedIn Worker] Transient LinkedIn server error ${statusCode}. Re-throwing to trigger standard retry...`);
      throw new Error(`LinkedIn API transient error (${statusCode}): ${JSON.stringify(responseData || error.message)}`);
    }

    // --- OTHER 4xx ERRORS (E.g. Bad Request 400 - Permanent failure) ---
    const logMsg = `LinkedIn API rejection (${statusCode}): ${JSON.stringify(responseData || error.message)}`;
    console.error(`[LinkedIn Worker] Permanent error: ${logMsg}`);
    
    await db.socialPost.update({
      where: { id: postId },
      data: {
        status: 'FAILED',
        errorLog: logMsg,
        updatedAt: new Date(),
      },
    });

    wsDispatcher.broadcast('SOCIAL_POST_STATUS_UPDATED', {
      postId,
      status: 'FAILED',
      platforms: ['LINKEDIN'],
      logs: logMsg,
      timestamp: new Date().toISOString(),
    });

    // Cancel retries for other permanent 4xx errors as well
    try {
      await job.discard();
    } catch (err) {}

    return { success: false, error: logMsg };

  } else {
    // Local network issues or timeouts: consider as transient errors, re-throw to trigger retry
    const errMessage = error.message || 'Unknown network error';
    console.warn(`[LinkedIn Worker] Local transient exception: ${errMessage}. Re-throwing to trigger retry...`);
    throw new Error(`Transient exception: ${errMessage}`);
  }
}
