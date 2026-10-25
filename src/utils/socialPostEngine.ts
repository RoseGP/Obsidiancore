import { Queue, Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import axios from 'axios';
import { db } from './db';
import { wsDispatcher } from './wsDispatcher';
import { initializeLinkedinPostWorker } from '../workers/linkedinPostWorker';
import { initializeMultiPlatformWorkerQueue, processSocialPostJob } from '../workers/multiPlatformPostWorker';

// --- CONFIGURATION ---
const REDIS_HOST = process.env.REDIS_HOST || '127.0.0.1';
const REDIS_PORT = Number(process.env.REDIS_PORT) || 6379;
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;

const APP_PORT = process.env.PORT || '3000';
const BASE_URL = `http://127.0.0.1:${APP_PORT}`;

// Dynamic endpoints so that we hit our mock server locally by default
const META_API_URL = process.env.META_API_URL || `${BASE_URL}/api/mock-platforms/meta`;
const LINKEDIN_API_URL = process.env.LINKEDIN_API_URL || `${BASE_URL}/api/mock-platforms/linkedin`;

const QUEUE_NAME = 'social-post-publishing-queue';

export interface SocialPostPayload {
  id?: string;
  body?: string; // Standard CRM DB field
  caption?: string; // Standard DB field / fallback
  mediaUrls?: string[];
  platforms: string[];
  scheduledAt: string | Date;
}

// Global engine states
let redisConnected = false;
let redisClient: Redis | null = null;
let socialQueue: Queue | null = null;
let socialWorker: Worker | null = null;

// Fallback in-memory task runner
const memoryScheduler: Map<string, NodeJS.Timeout> = new Map();

/**
 * Initializes Redis connection test and mounts BullMQ components or activates safe fallback
 */
export async function initializeSchedulerEngine() {
  console.log('[Scheduler Engine] Initializing database & queues verification sequence...');
  if (!process.env.REDIS_HOST && !process.env.REDIS_URL) {
    console.log('[Scheduler Engine] No external Redis configured. Standard fallback active.');
    return;
  }
  
  // Test Redis connection asynchronously with quick timeout to guarantee no blocking hangs on boot
  try {
    redisClient = new Redis({
      host: REDIS_HOST,
      port: REDIS_PORT,
      password: REDIS_PASSWORD,
      maxRetriesPerRequest: null, // mandatory for BullMQ
      connectTimeout: 1000,
      lazyConnect: true,
      retryStrategy: () => null,
      enableOfflineQueue: false,
    });

    // Handle redis errors gracefully to prevent Unhandled Error Event crashes
    redisClient.on('error', (err: any) => {
      // Catch and log silently/gracefully to prevent crash
    });

    await redisClient.connect();
    redisConnected = true;
    console.log('[Scheduler Engine] Redis service verified. Spawning native BullMQ constructs.');

    // Safely initialize the LinkedIn worker now that Redis is connected
    initializeLinkedinPostWorker();

    // Safely initialize the Multi-Platform Social Media Worker Queue
    await initializeMultiPlatformWorkerQueue();

    const connectionOpts = {
      host: REDIS_HOST,
      port: REDIS_PORT,
      password: REDIS_PASSWORD,
      maxRetriesPerRequest: null,
    };

    // Instantiate Queue
    socialQueue = new Queue(QUEUE_NAME, {
      connection: connectionOpts,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
      }
    });

    // Instantiate Worker
    socialWorker = new Worker(
      QUEUE_NAME,
      async (job: Job) => {
        const { postId, directPayload } = job.data;
        console.log(`[Worker] Executing job ${job.id} for Post ID: ${postId || 'Direct Message'}`);
        return await processSocialPublishTask(postId, directPayload);
      },
      { connection: connectionOpts }
    );

    socialWorker.on('completed', (job) => {
      console.log(`[Worker Job Saved] Finished queue item ID: ${job.id}`);
    });

    socialWorker.on('failed', (job, err) => {
      console.error(`[Worker Job Failed] Item ID: ${job?.id || 'unknown'} encountered error:`, err.message);
    });

  } catch (err: any) {
    redisConnected = false;
    console.warn(`[Scheduler Engine] Redis connectivity offline (Host: ${REDIS_HOST}:${REDIS_PORT}). Graceful transition to High-Performance InMemory Scheduler enabled.`);
  }
}

/**
 * Core function that accepts a post payload, stores/queues it, and dispatches to APIs
 */
export async function queueSocialPost(payload: SocialPostPayload): Promise<{ success: boolean; queueType: 'BULLMQ' | 'MEMORY'; jobId: string; scheduledAt: string }> {
  const targetTime = new Date(payload.scheduledAt);
  const now = new Date();
  const delayMs = Math.max(0, targetTime.getTime() - now.getTime());
  
  // Create / fetch post ID
  const postId = payload.id || `direct-post-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const textCaption = payload.caption || payload.body || 'Obsidian Luxury CRM update dispatch.';
  const attachments = payload.mediaUrls || [];

  console.log(`[Queue System] Staging Social Post [ID: ${postId}] for platforms: ${payload.platforms.join(', ')} with delay ${delayMs}ms`);

  if (redisConnected && socialQueue) {
    try {
      const job = await socialQueue.add(
        'publish-social-post',
        {
          postId,
          directPayload: {
            id: postId,
            caption: textCaption,
            mediaUrls: attachments,
            platforms: payload.platforms,
          },
        },
        { delay: delayMs, jobId: postId }
      );
      
      return {
        success: true,
        queueType: 'BULLMQ',
        jobId: job.id || postId,
        scheduledAt: targetTime.toISOString(),
      };
    } catch (err: any) {
      console.error('[Queue System] BullMQ staging faulted. Escalating to in-memory scheduler.', err.message);
    }
  }

  // Fallback In-Memory scheduling
  if (memoryScheduler.has(postId)) {
    clearTimeout(memoryScheduler.get(postId)!);
  }

  const timeoutToken = setTimeout(async () => {
    try {
      console.log(`[Memory Scheduler] Activating scheduled callback for Post ID: ${postId}`);
      await processSocialPublishTask(postId, {
        id: postId,
        caption: textCaption,
        mediaUrls: attachments,
        platforms: payload.platforms,
      });
    } catch (e: any) {
      console.error('[Memory Scheduler] Execution loop exception:', e.message);
    } finally {
      memoryScheduler.delete(postId);
    }
  }, delayMs);

  memoryScheduler.set(postId, timeoutToken);

  return {
    success: true,
    queueType: 'MEMORY',
    jobId: postId,
    scheduledAt: targetTime.toISOString(),
  };
}

/**
 * Handles the actual external publications using Axios to the simulated or live platform REST APIs
 */
export async function processSocialPublishTask(postId: string, directPayload?: any) {
  const mockJob: any = {
    id: `job-${postId || Date.now()}`,
    attemptsMade: 0,
    data: {
      postId,
      platformIds: directPayload?.platforms || directPayload?.platformIds || ['linkedin', 'twitter', 'facebook'],
      mediaUrls: directPayload?.mediaUrls || [],
      content: directPayload?.caption || directPayload?.body,
      caption: directPayload?.caption,
      body: directPayload?.body
    }
  };
  return await processSocialPostJob(mockJob);
}
