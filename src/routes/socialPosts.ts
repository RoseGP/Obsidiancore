import { Request, Response } from 'express';
import { Router as ExpressRouter } from 'express';
import { GoogleGenAI } from '@google/genai';
import { queueSocialPost, SocialPostPayload } from '../utils/socialPostEngine';
import { db } from '../utils/db';
import { publishLinkedInPostWithDatabaseSync } from '../utils/linkedinPublisherService';
import { 
  scheduleUserPost, 
  platformRateLimiter, 
  SOCIAL_POSTS_QUEUE_NAME,
  processSocialPostJob 
} from '../jobs/socialPostsQueue';

const router = ExpressRouter();

// Lazy initialization of GoogleGenAI client to avoid crashes if API key is not present on start
let aiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI | null {
  if (!aiClient) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      console.warn('[Social AI Writer] GEMINI_API_KEY is not defined. Falling back to rule-based static suggestions.');
      return null;
    }
    aiClient = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return aiClient;
}

// In-Memory global list of active posts, preseeded with beautiful mock content
const memoryPosts: any[] = [
  {
    id: 'seed-post-1',
    caption: '✨ Upgrade alert: Our standard omnichannel system integrations are now fully active! Multi-channel client pipelines are optimized for WhatsApp, Slack, Telegram, and premium lead notifications.',
    mediaUrls: ['https://images.unsplash.com/photo-1551836022-d5d88e9218df?auto=format&fit=crop&q=80&w=600'],
    platforms: ['INSTAGRAM', 'FACEBOOK'],
    scheduledAt: new Date(Date.now() - 3600000 * 4).toISOString(), // 4 hours ago
    publishedAt: new Date(Date.now() - 3600000 * 4).toISOString(),
    status: 'PUBLISHED',
    errorLog: 'Success: Dispatched perfectly to platforms (Instagram, Facebook).',
    createdAt: new Date(Date.now() - 3600000 * 5).toISOString()
  },
  {
    id: 'seed-post-2',
    caption: '🔒 ISO Security Alignment Complete! We are thrilled to announce that Obsidian Enterprise pipelines now run on double-encrypted, high-trust sovereign TLS tunnels.',
    mediaUrls: ['https://images.unsplash.com/photo-1563986768609-322da13575f3?auto=format&fit=crop&q=80&w=600'],
    platforms: ['LINKEDIN'],
    scheduledAt: new Date(Date.now() - 3600000 * 24).toISOString(), // 1 day ago
    publishedAt: new Date(Date.now() - 3600000 * 24).toISOString(),
    status: 'PUBLISHED',
    errorLog: 'Success: Dispatched perfectly to LinkedIn UGC service. Share ID: urn:li:share:41890251',
    createdAt: new Date(Date.now() - 3600000 * 25).toISOString()
  },
  {
    id: 'seed-post-3',
    caption: '🚀 Obsidian Core Workspace v4.2 preview. Fully integrated lead conversion, glassmorphic analytics boards, and synchronous WebRTC customer consulting. Countdown starts now.',
    mediaUrls: ['https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&q=80&w=600'],
    platforms: ['LINKEDIN', 'INSTAGRAM'],
    scheduledAt: new Date(Date.now() + 3600000 * 18).toISOString(), // 18 hours in the future
    status: 'SCHEDULED',
    errorLog: '',
    createdAt: new Date().toISOString()
  },
  {
    id: 'seed-post-4',
    caption: '📊 Join us this Thursday for an exclusive live demonstration of the luxury Obsidian Analytics cockpit. Real-time response quality analysis and API latency metrics.',
    mediaUrls: ['https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&q=80&w=600'],
    platforms: ['FACEBOOK'],
    scheduledAt: new Date(Date.now() - 3600000 * 48).toISOString(), // 2 days ago
    status: 'FAILED',
    errorLog: 'Meta OAuthException: The attached image format/aspect ratio is currently unsupported by Instagram systems.',
    createdAt: new Date(Date.now() - 3600000 * 50).toISOString()
  },
  {
    id: 'seed-post-5',
    caption: '🔗 Elite Multi-Platform Syndicate pipeline announcement! Connect your CRM directly to LinkedIn and broadcast high-trust enterprise insights seamlessly.',
    mediaUrls: ['https://images.unsplash.com/photo-1522071820081-009f0129c71c?auto=format&fit=crop&q=80&w=600'],
    platforms: ['LINKEDIN'],
    scheduledAt: new Date(Date.now() - 3600000 * 12).toISOString(), // 12 hours ago
    status: 'FAILED',
    errorLog: 'LinkedIn Auth expired: w_member_social scope checks failed for active user credentials. (401 Unauthorized)',
    createdAt: new Date(Date.now() - 3600000 * 13).toISOString(),
    retryCount: 3
  }
];

/**
 * PATH: GET /api/social-posts
 * Gathers all social posts from both the active Prisma DB and our preseeded in-memory fallbacks
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    let dbPosts: any[] = [];
    try {
      dbPosts = await db.socialPost.findMany({
        orderBy: { scheduledAt: 'desc' }
      });
    } catch {
      // Prisma deactivated or tables unaligned
    }

    // Merge and filter out duplicates by id
    const allPostsMap = new Map();
    memoryPosts.forEach(p => allPostsMap.set(p.id, p));
    dbPosts.forEach(p => {
      allPostsMap.set(p.id, {
        id: p.id,
        caption: p.caption || p.body || 'No text content provided.',
        mediaUrls: p.mediaUrls || p.mediaAttachments || [],
        platforms: p.platforms || [],
        scheduledAt: p.scheduledAt,
        publishedAt: p.publishedAt,
        status: p.status,
        errorLog: p.errorLog || '',
        createdAt: p.createdAt
      });
    });

    const mergedPosts = Array.from(allPostsMap.values()).sort((a, b) => {
      return new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime();
    });

    res.status(200).json(mergedPosts);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to query active scheduled posts list.' });
  }
});

/**
 * PATH: POST /api/social-posts/generate-caption
 * Generates or improves social media captions using Gemini 3.5 Flash server-side
 */
router.post('/generate-caption', async (req: Request, res: Response) => {
  const { prompt, tone, platform } = req.body;
  if (!prompt) {
    res.status(400).json({ error: 'Prompt description is required to generate social content.' });
    return;
  }

  const selectedTone = tone || 'Professional';
  const selectedPlatform = platform || 'LinkedIn';

  const gemini = getGeminiClient();
  if (!gemini) {
    // Static rule-based quality fallback
    const mockCaptions: Record<string, string[]> = {
      Professional: [
        `📊 Obsidian Workspace Excellence: Elevate your team communications with high-fidelity analytics and unified omnichannel lead routing. Secure. Compliant. Fast. #${selectedPlatform} #ObsidianCRM`,
        `🚀 Streamline customer relations with luxury glassmorphic layouts and instantaneous communication. Here is how we redefine enterprise software standards: #${selectedPlatform} #SaaS #Obsidian`
      ],
      Creative: [
        `✨ Pure visual luxury meets high-performance CRM engineering. Introducing the Obsidian unified dashboard — because your premium lead pipeline deserves better code. 💎 #${selectedPlatform} #Innovation`,
        `💡 Tired of clunky CRMs? Switch to an aesthetic Workspace built for elite performance, built-in WebRTC calls, and multi-channel synchronization. 🌊 #${selectedPlatform} #TechStyle`
      ],
      Casual: [
        `Wave goodbye to scattered tabs! 👋 Our Obsidian workspace consolidates WhatsApp, Telegram, calendar events, and deep analytics in one gorgeous application. Check it out! 😎 #Workflow #CRM`,
        `Just launched: a brand new social media calendar inside our Obsidian dashboard. Now you can draft, schedule, and view posts in real time without leaving your CRM hub! 📅🚀 #ObsidianCore`
      ]
    };

    const choices = mockCaptions[selectedTone] || mockCaptions['Professional'];
    const selectedText = choices[Math.floor(Math.random() * choices.length)];
    res.status(200).json({ text: `[Rule-based Suggestion] ${selectedText}` });
    return;
  }

  try {
    const aiSystemInstruction = `You are a professional social media marketing copywriter and content strategist for Obsidian, a premium high-trust omnichannel CRM enterprise platform.
Your task is to write high-engagement social media content copy.
Tone of voice: ${selectedTone}.
Target channel: ${selectedPlatform}.
Structure: Start with an attention-grabbing hook, keep paragraphs short, include bullet points if appropriate, and conclude with 3-4 professional hashtags. Avoid generic AI introductory fluff. Ensure the caption is ready to be posted.`;

    const modelName = 'gemini-2.5-flash';
    const response = await gemini.models.generateContent({
      model: modelName,
      contents: `Draft a high-conversion social post based on this brief: "${prompt}". Make sure it aligns with our target channel ${selectedPlatform} and tone ${selectedTone}.`,
      config: {
        systemInstruction: aiSystemInstruction,
        temperature: 0.8,
        maxOutputTokens: 600,
      }
    });

    const responseText = response.text || '';
    res.status(200).json({ text: responseText.trim() });
  } catch (error: any) {
    console.error('[Gemini Caption Generator Error]', error);
    res.status(500).json({ error: `AI generation failed: ${error.message}` });
  }
});

/**
 * PATH: POST /api/social-posts/schedule
 * Body expects:
 * - text / caption: string
 * - imageUrl / mediaUrls: string or string[]
 * - platformTargets / platforms: string[] (e.g. ['INSTAGRAM', 'LINKEDIN'])
 * - executionTimestamp / scheduledAt: string (ISO Date)
 */
router.post('/schedule', async (req: Request, res: Response) => {
  try {
    const { text, caption, imageUrl, mediaUrls, platformTargets, platforms, executionTimestamp, scheduledAt } = req.body;

    // Gracefully resolve alternative naming keys to guarantee fully polished coverage
    const postCaption = text || caption;
    const finalMediaUrls: string[] = Array.isArray(mediaUrls) 
      ? mediaUrls 
      : (mediaUrls ? [mediaUrls] : (imageUrl ? [imageUrl] : []));
    const targetPlatforms: string[] = platforms || platformTargets || ['LINKEDIN'];
    const runDate = scheduledAt || executionTimestamp || new Date(Date.now() + 5000).toISOString();

    if (!postCaption) {
      res.status(400).json({ error: 'Validation Fault: caption/text content cannot be empty.' });
      return;
    }

    // Attempt to store in DB under schema models if user user is registered or workspace presents.
    // If not, we will proceed with a lightweight memory execution
    let dbRecordId: string | undefined;

    try {
      // Find or seed a basic User so foreign key createdById constraint is fully satisfied
      let demoUser = await db.user.findFirst();
      if (!demoUser) {
        demoUser = await db.user.create({
          data: {
            email: 'representative@obsidian.crm',
            name: 'Lead Representative Marketing Manager',
            role: 'MARKETEER'
          }
        });
      }

      const postRecord = await db.socialPost.create({
        data: {
          caption: postCaption,
          body: postCaption,
          mediaUrls: finalMediaUrls,
          mediaAttachments: finalMediaUrls,
          platforms: targetPlatforms,
          scheduledAt: new Date(runDate),
          status: 'SCHEDULED',
          createdById: demoUser.id
        }
      });
      dbRecordId = postRecord.id;
      console.log(`[Social Scheduler Route] Saved schedule record under DB index ID ${dbRecordId}`);
    } catch (e: any) {
      console.warn(`[Social Scheduler Route] Database indexing bypassed or mock database utilized: ${e.message}`);
    }

    // Capture post globally in our memoryPosts tracker so the client dashboard updates instantly
    const scheduledPostObj = {
      id: dbRecordId || `direct-post-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      caption: postCaption,
      mediaUrls: finalMediaUrls,
      platforms: targetPlatforms,
      scheduledAt: runDate,
      status: 'SCHEDULED',
      errorLog: '',
      createdAt: new Date().toISOString()
    };
    memoryPosts.unshift(scheduledPostObj);

    // Call our Background Engine Queue function
    const queueResult = await queueSocialPost({
      id: scheduledPostObj.id,
      caption: postCaption,
      mediaUrls: finalMediaUrls,
      platforms: targetPlatforms,
      scheduledAt: runDate
    });

    res.status(200).json({
      message: 'Social post queued successfully.',
      jobId: queueResult.jobId,
      queueType: queueResult.queueType,
      postId: scheduledPostObj.id,
      scheduledAt: queueResult.scheduledAt,
      platforms: targetPlatforms,
      post: scheduledPostObj
    });
  } catch (error: any) {
    console.error('[Social Post Scheduler API Controller Exception]:', error.message);
    res.status(500).json({ error: 'Failed to schedule post due to internal system fault.' });
  }
});

/**
 * PATH: GET /api/social-posts/status/:id
 * Fetches status profile of queued action
 */
router.get('/status/:id', async (req: Request, res: Response) => {
  try {
    const postId = req.params.id;

    if (postId.startsWith('direct-post') || postId.startsWith('seed-post')) {
      const match = memoryPosts.find(p => p.id === postId);
      if (match) {
        res.status(200).json(match);
      } else {
        res.status(200).json({
          id: postId,
          status: 'In-Memory Staged',
          note: 'Memory Task is operating under active Event Dispatches'
        });
      }
      return;
    }

    try {
      const post = await db.socialPost.findUnique({ where: { id: postId } });
      if (post) {
        res.status(200).json(post);
        return;
      }
    } catch {
      // skip
    }

    // fallback to memory check
    const match = memoryPosts.find(p => p.id === postId);
    if (match) {
      res.status(200).json(match);
      return;
    }

    res.status(404).json({ error: 'Queued item not found.' });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to resolve entity status.' });
  }
});

// Expose memory posts reference internally if background worker updates status
export function updateMemoryPostStatus(id: string, status: string, logs: string) {
  const index = memoryPosts.findIndex(p => p.id === id);
  if (index > -1) {
    memoryPosts[index].status = status;
    memoryPosts[index].errorLog = logs;
    if (status === 'PUBLISHED') {
      memoryPosts[index].publishedAt = new Date().toISOString();
    }
    console.log(`[socialPosts API Store] Synchronized Memory Post ID ${id} with status: ${status}`);
  }
}

/**
 * PATH: POST /api/social-posts/publish-linkedin
 * Triggers actual or sandboxed LinkedIn UGC Post publication with database status sync.
 */
router.post('/publish-linkedin', async (req: Request, res: Response) => {
  try {
    const { postId, textContent, authorUrn, accessToken, mediaUrls } = req.body;

    if (!postId || !textContent) {
      res.status(400).json({
        error: 'Validation Fault: Both "postId" and "textContent" are required to invoke LinkedIn publishing.'
      });
      return;
    }

    const result = await publishLinkedInPostWithDatabaseSync(
      postId,
      textContent,
      authorUrn || 'urn:li:person:demo_profile',
      accessToken,
      mediaUrls || []
    );

    res.status(200).json({
      success: result.success,
      postId: result.postId,
      error: result.error,
      tokenExpired: result.tokenExpired,
      message: result.success 
        ? 'LinkedIn publication dispatched and synchronized with the database successfully.'
        : 'LinkedIn publication failed. Database status has been updated to FAILED.'
    });
  } catch (error: any) {
    console.error('[API Manual Publish Error]', error);
    res.status(500).json({ error: 'Failed to process manual LinkedIn publication.' });
  }
});

/**
 * PATH: POST /api/social-posts/retry/:id
 * Moves a failed post back to PROCESSING and resets retry count, then schedules or publishes immediately.
 */
router.post('/retry/:id', async (req: Request, res: Response) => {
  try {
    const postId = req.params.id;
    console.log(`[API Retry Post] Received request to retry post ID ${postId}`);

    // Find the post in memory list or DB
    let foundPost = memoryPosts.find(p => p.id === postId);
    
    // Reset retryCount and set status to PROCESSING
    if (foundPost) {
      foundPost.status = 'PROCESSING';
      foundPost.retryCount = 0;
      foundPost.errorLog = '';
    }

    try {
      // If db exists, update it as well.
      // Since 'PROCESSING' is not in the db enum (enum has DRAFT, SCHEDULED, PUBLISHED, FAILED), 
      // we can set it to 'SCHEDULED' on db, or we can catch and log.
      await db.socialPost.update({
        where: { id: postId },
        data: {
          status: 'SCHEDULED', // Map to database valid enum
          errorLog: 'Retrying publication - reset retry count to 0.'
        }
      });
    } catch (e: any) {
      console.warn(`[API Retry Post] Database update bypassed or unaligned: ${e.message}`);
    }

    // Return success to client immediately so they see the PROCESSING spinner
    res.status(200).json({
      success: true,
      message: 'Post status moved back to PROCESSING. Retry count has been reset.',
      postId
    });

    // Run the actual/mock publication asynchronously after a small delay (to let client see the PROCESSING state)
    setTimeout(async () => {
      try {
        console.log(`[API Retry Post] Asynchronously executing publication for Post ID ${postId}`);
        const textToPublish = foundPost?.caption || 'Obsidian CRM publication retry dispatch.';
        const attachments = foundPost?.mediaUrls || [];
        const platforms = foundPost?.platforms || ['LINKEDIN'];

        // Trigger manual/mock publish
        if (platforms.map((p: string) => p.toUpperCase()).includes('LINKEDIN')) {
          await publishLinkedInPostWithDatabaseSync(
            postId,
            textToPublish,
            'urn:li:person:demo_profile',
            'mock_linkedin_token_xyz',
            attachments
          );
        } else {
          // General mock publish
          const { processSocialPublishTask } = require('../utils/socialPostEngine');
          await processSocialPublishTask(postId, {
            id: postId,
            caption: textToPublish,
            mediaUrls: attachments,
            platforms: platforms
          });
        }
      } catch (publishErr: any) {
        console.error(`[API Retry Post] Async publishing failed:`, publishErr.message);
      }
    }, 1500);

  } catch (error: any) {
    console.error('[Social Post Retry Error]:', error.message);
    res.status(500).json({ error: 'Failed to trigger retry for the scheduled post.' });
  }
});

/**
 * PATH: DELETE /api/social-posts/:id
 * Cancels/removes a scheduled or failed post from both DB and memory
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const postId = req.params.id;

    // 1. Delete from memoryPosts if exists
    const index = memoryPosts.findIndex(p => p.id === postId);
    if (index > -1) {
      memoryPosts.splice(index, 1);
    }

    // 2. Delete from DB if database is connected
    try {
      await db.socialPost.delete({
        where: { id: postId }
      });
    } catch (dbErr: any) {
      console.warn(`[Social Scheduler Route] Database delete bypassed: ${dbErr.message}`);
    }

    res.status(200).json({ success: true, message: 'Scheduled post successfully removed.' });
  } catch (error: any) {
    console.error('[Social Post Delete Error]:', error.message);
    res.status(500).json({ error: 'Failed to delete the scheduled post.' });
  }
});

/**
 * ============================================================================
 * BULLMQ REDIS SCHEDULER & RATE-LIMITING CONTROLLER ROUTES
 * ============================================================================
 */

/**
 * POST /api/social-posts/bullmq/schedule
 * Schedules a post using BullMQ queue and Redis delayed jobs
 */
router.post('/bullmq/schedule', async (req: Request, res: Response) => {
  try {
    const { 
      postId, 
      targetTimestamp, 
      scheduledAt,
      platforms, 
      content, 
      mediaUrls,
      userId 
    } = req.body;

    const resolvedPostId = postId || `post_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const finalTimestamp = targetTimestamp || scheduledAt || (Date.now() + 60000);
    const targetPlatforms: string[] = Array.isArray(platforms) && platforms.length > 0 
      ? platforms 
      : ['twitter', 'linkedin'];

    if (content) {
      // Upsert post in DB
      try {
        await db.post.create({
          data: {
            id: resolvedPostId,
            content,
            status: 'SCHEDULED',
            scheduledAt: new Date(typeof finalTimestamp === 'number' ? finalTimestamp : new Date(finalTimestamp).getTime()),
            createdById: userId || 'demo-user-123'
          }
        });
      } catch (dbErr) {}
    }

    const scheduleResult = await scheduleUserPost(
      resolvedPostId,
      finalTimestamp,
      targetPlatforms,
      {
        userId: userId || 'demo-user-123',
        customData: {
          content: content || 'Scheduled omnichannel publication',
          mediaUrls: mediaUrls || []
        }
      }
    );

    return res.status(200).json({
      success: true,
      message: `Post ${resolvedPostId} scheduled successfully via BullMQ queue '${SOCIAL_POSTS_QUEUE_NAME}'.`,
      scheduleResult
    });
  } catch (error: any) {
    console.error('[BullMQ Route Error]', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to schedule post via BullMQ.'
    });
  }
});

/**
 * GET /api/social-posts/bullmq/status
 * Returns rate limiter telemetry and queue metrics
 */
router.get('/bullmq/status', (req: Request, res: Response) => {
  const rateLimiterTelemetry = platformRateLimiter.getStatus();
  return res.status(200).json({
    success: true,
    queueName: SOCIAL_POSTS_QUEUE_NAME,
    rateLimiter: {
      strategy: 'Sliding Window Token Bucket with Cooling-Period Backoff',
      maxRequestsPerSecond: 5,
      windowMs: 1000,
      platforms: rateLimiterTelemetry
    }
  });
});

/**
 * POST /api/social-posts/bullmq/process-now
 * Runs the worker processor immediately for a given post
 */
router.post('/bullmq/process-now', async (req: Request, res: Response) => {
  try {
    const { postId, platforms, userId, content } = req.body;
    const resolvedPostId = postId || `test_post_${Date.now()}`;
    const targetPlatforms: string[] = Array.isArray(platforms) && platforms.length > 0
      ? platforms
      : ['twitter', 'linkedin'];

    const result = await processSocialPostJob({
      id: `manual_job_${Date.now()}`,
      data: {
        postId: resolvedPostId,
        targetTimestamp: Date.now(),
        targetDateIso: new Date().toISOString(),
        platforms: targetPlatforms,
        userId: userId || 'demo-user-123',
        scheduledAt: new Date().toISOString(),
        customData: { content: content || 'Immediate test post' }
      },
      attemptsMade: 1
    });

    return res.status(200).json({
      success: true,
      result
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
