/**
 * Postiz Express Router
 * Mounts at /api/postiz
 */

import { Router, Request, Response } from 'express';
import multer from 'multer';
import { PostizService } from '../services/postizService';
import { PostizStore } from '../db/postizStore';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 } // 25MB max
});

// Helper to extract or resolve current userId
function resolveUserId(req: Request): string {
  const fromHeader = req.headers['x-user-id'] as string;
  const fromQuery = req.query.userId as string;
  const fromBody = req.body?.userId;
  return fromHeader || fromQuery || fromBody || 'default_admin_crm_user';
}

/**
 * GET /api/postiz/status
 * Returns connection state and authorization status for current user
 */
router.get('/status', async (req: Request, res: Response) => {
  try {
    const userId = resolveUserId(req);
    const record = await PostizStore.getRecord(userId);

    if (!record || record.status === 'disconnected') {
      return res.json({
        connected: false,
        status: 'disconnected'
      });
    }

    const isExpired = record.expiresAt ? Date.now() > record.expiresAt : false;
    const effectiveStatus = isExpired ? 'expired' : record.status;

    return res.json({
      connected: effectiveStatus === 'active',
      status: effectiveStatus,
      authType: record.authType,
      userEmail: record.userEmail,
      workspaceId: record.workspaceId,
      connectedAt: record.connectedAt,
      reconnectReason: record.reconnectReason
    });
  } catch (err: any) {
    console.error('[Postiz API] /status error:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/postiz/auth/url, GET /api/social/postiz/connect, GET /connect
 * Initiates OAuth flow by generating redirect URL or directly redirecting
 */
router.get(['/auth/url', '/connect'], (req: Request, res: Response) => {
  try {
    const userId = resolveUserId(req);
    const customRedirect = req.query.redirectUri as string | undefined;

    // Use current request origin if no custom redirect provided
    const proto = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const dynamicRedirectUri = customRedirect || `${proto}://${host}/api/social/postiz/callback`;

    const { url, state } = PostizService.generateOAuthUrl(userId, dynamicRedirectUri);

    // If browser navigates directly via browser URL bar or link, redirect directly to Postiz
    if (req.headers.accept?.includes('text/html') && !req.xhr && !req.headers['x-requested-with']) {
      return res.redirect(url);
    }

    return res.json({
      url,
      state,
      redirectUri: dynamicRedirectUri
    });
  } catch (err: any) {
    console.error('[Postiz API] /auth/url error:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/postiz/callback
 * Handles OAuth 2.0 authorization code return from Postiz
 */
router.get('/callback', async (req: Request, res: Response) => {
  const { code, state, error, error_description } = req.query;

  if (error) {
    console.error('[Postiz API] OAuth returned error:', error, error_description);
    return res.send(`
      <!DOCTYPE html>
      <html>
        <head><title>Postiz Authorization Failed</title></head>
        <body style="font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; background: #0f172a; color: #f8fafc;">
          <div style="text-align: center; max-width: 480px; padding: 2rem; background: #1e293b; border-radius: 1rem; border: 1px solid #ef4444;">
            <h2 style="color: #ef4444; margin-bottom: 0.5rem;">Authorization Cancelled</h2>
            <p style="color: #94a3b8; font-size: 0.875rem;">${error_description || error}</p>
            <button onclick="window.close()" style="margin-top: 1rem; padding: 0.5rem 1.5rem; background: #334155; color: white; border: none; border-radius: 0.5rem; cursor: pointer;">Close Window</button>
          </div>
        </body>
      </html>
    `);
  }

  if (!code || !state) {
    return res.status(400).send('Missing required authorization parameters (code or state).');
  }

  try {
    const record = await PostizService.exchangeCodeForToken(code as string, state as string);

    // Return an HTML page that notifies the opener window and cleanly closes
    return res.send(`
      <!DOCTYPE html>
      <html>
        <head><title>Postiz Connected</title></head>
        <body style="font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; background: #0f172a; color: #f8fafc;">
          <div style="text-align: center; max-width: 480px; padding: 2.5rem; background: #1e293b; border-radius: 1rem; border: 1px solid #3b82f6;">
            <div style="width: 48px; height: 48px; border-radius: 50%; background: #10b981; color: white; display: flex; align-items: center; justify-content: center; font-size: 24px; margin: 0 auto 1rem;">✓</div>
            <h2 style="color: #ffffff; margin-bottom: 0.5rem;">Postiz Connected!</h2>
            <p style="color: #94a3b8; font-size: 0.875rem;">Authorization successful. Redirecting back to your Social Media Planner...</p>
            <script>
              try {
                if (window.opener) {
                  window.opener.postMessage({ type: 'POSTIZ_AUTH_SUCCESS', userId: '${record.userId}' }, '*');
                  setTimeout(() => window.close(), 1000);
                } else {
                  window.location.href = '/?tab=social_planner&postiz_connected=true';
                }
              } catch (e) {
                window.location.href = '/?tab=social_planner&postiz_connected=true';
              }
            </script>
          </div>
        </body>
      </html>
    `);
  } catch (err: any) {
    console.error('[Postiz API] Callback exchange error:', err);
    return res.status(500).send(`
      <!DOCTYPE html>
      <html>
        <head><title>Postiz Authorization Error</title></head>
        <body style="font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; background: #0f172a; color: #f8fafc;">
          <div style="text-align: center; max-width: 480px; padding: 2rem; background: #1e293b; border-radius: 1rem; border: 1px solid #ef4444;">
            <h2 style="color: #ef4444;">Authentication Error</h2>
            <p style="color: #94a3b8; font-size: 0.875rem;">${err.message}</p>
            <button onclick="window.close()" style="margin-top: 1rem; padding: 0.5rem 1.5rem; background: #334155; color: white; border: none; border-radius: 0.5rem; cursor: pointer;">Close Window</button>
          </div>
        </body>
      </html>
    `);
  }
});

/**
 * POST /api/postiz/connect-direct
 * Allows connecting with a Postiz API key directly
 */
router.post('/connect-direct', async (req: Request, res: Response) => {
  try {
    const userId = resolveUserId(req);
    const { apiKey, workspaceName } = req.body;

    if (!apiKey) {
      return res.status(400).json({ error: 'Postiz API Key is required' });
    }

    const record = await PostizService.connectDirectApiKey(userId, apiKey, workspaceName);

    return res.json({
      success: true,
      status: 'active',
      authType: 'api_key',
      workspaceId: record.workspaceId
    });
  } catch (err: any) {
    console.error('[Postiz API] /connect-direct error:', err);
    return res.status(400).json({ error: err.message });
  }
});

/**
 * POST /api/postiz/disconnect
 * Disconnects Postiz credentials for user
 */
router.post('/disconnect', async (req: Request, res: Response) => {
  try {
    const userId = resolveUserId(req);
    await PostizStore.disconnect(userId);
    return res.json({ success: true, message: 'Disconnected from Postiz' });
  } catch (err: any) {
    console.error('[Postiz API] /disconnect error:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/postiz/integrations
 * Discovers connected social accounts / channels from Postiz
 */
router.get('/integrations', async (req: Request, res: Response) => {
  try {
    const userId = resolveUserId(req);
    const integrations = await PostizService.getIntegrations(userId);
    return res.json({
      success: true,
      integrations,
      count: integrations.length
    });
  } catch (err: any) {
    const status = err.statusCode || 500;
    return res.status(status).json({
      error: err.message,
      revoked: err.code === 'POSTIZ_REVOKED',
      details: err.details
    });
  }
});

/**
 * POST /api/postiz/channels/connect
 * Connects and registers a social media account channel for publishing
 */
router.post('/channels/connect', async (req: Request, res: Response) => {
  try {
    const userId = resolveUserId(req);
    const { platform, handle, name, picture } = req.body;

    if (!platform || !handle) {
      return res.status(400).json({ error: 'Platform and account handle are required' });
    }

    const channel = await PostizService.connectChannel(userId, {
      platform,
      handle,
      name,
      picture
    });

    const allChannels = await PostizService.getIntegrations(userId);

    return res.json({
      success: true,
      channel,
      integrations: allChannels
    });
  } catch (err: any) {
    console.error('[Postiz API] /channels/connect error:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/postiz/channels/:id
 * Disconnects / unlinks a specific channel
 */
router.delete('/channels/:id', async (req: Request, res: Response) => {
  try {
    const userId = resolveUserId(req);
    const channelId = req.params.id;

    await PostizService.disconnectChannel(userId, channelId);
    const allChannels = await PostizService.getIntegrations(userId);

    return res.json({
      success: true,
      message: 'Channel disconnected',
      integrations: allChannels
    });
  } catch (err: any) {
    console.error('[Postiz API] /channels/:id delete error:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/postiz/upload
 * Uploads media file to Postiz using multipart/form-data
 */
router.post('/upload', upload.single('file'), async (req: Request, res: Response) => {
  try {
    const userId = resolveUserId(req);
    if (!req.file) {
      return res.status(400).json({ error: 'No media file provided in "file" field' });
    }

    const media = await PostizService.uploadMedia(
      userId,
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype
    );

    return res.json({
      success: true,
      media
    });
  } catch (err: any) {
    const status = err.statusCode || 500;
    return res.status(status).json({
      error: err.message,
      revoked: err.code === 'POSTIZ_REVOKED'
    });
  }
});

/**
 * POST /api/postiz/upload-from-url
 * Uploads media to Postiz by providing an image/video URL
 */
router.post('/upload-from-url', async (req: Request, res: Response) => {
  try {
    const userId = resolveUserId(req);
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'Media URL is required' });
    }

    const media = await PostizService.uploadMediaFromUrl(userId, url);
    return res.json({
      success: true,
      media
    });
  } catch (err: any) {
    const status = err.statusCode || 500;
    return res.status(status).json({
      error: err.message,
      revoked: err.code === 'POSTIZ_REVOKED'
    });
  }
});

/**
 * POST /api/postiz/generate-ai-content & POST /api/postiz/generate-content
 * Generates platform-specific social post copy based on prompt
 */
router.post(['/generate-ai-content', '/generate-content'], async (req: Request, res: Response) => {
  try {
    const { prompt, platforms, tone, callToAction, adaptPerPlatform } = req.body;

    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'Post prompt description is required' });
    }

    const result = await PostizService.generateAiContent({
      prompt,
      platforms: Array.isArray(platforms) ? platforms : ['linkedin', 'instagram', 'twitter', 'facebook'],
      tone,
      callToAction,
      adaptPerPlatform: adaptPerPlatform !== false
    });

    return res.json({
      success: true,
      posts: result.posts
    });
  } catch (err: any) {
    console.error('[Postiz API] /generate-ai-content error:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/postiz/posts & POST /api/postiz/schedule
 * Creates, schedules, or drafts a post across chosen Postiz channels
 * Supports platform-specific post tailored content
 */
router.post(['/posts', '/schedule'], async (req: Request, res: Response) => {
  try {
    const userId = resolveUserId(req);
    const {
      type,
      date,
      scheduledAt,
      timezone,
      integrationIds,
      content,
      platformSpecificContent,
      posts,
      media,
      settings,
      shortLink,
      tags
    } = req.body;

    const effectiveType = type || (req.path.includes('schedule') ? 'schedule' : 'schedule');
    const effectiveDate = scheduledAt || date;

    if (!['now', 'schedule', 'draft'].includes(effectiveType)) {
      return res.status(400).json({ error: 'Valid post type is required ("now", "schedule", or "draft")' });
    }

    // Determine target integrations from posts array or integrationIds
    const targetIntegrations = (posts && Array.isArray(posts) && posts.length > 0)
      ? posts.map(p => p.integrationId)
      : (integrationIds && Array.isArray(integrationIds) ? integrationIds : []);

    if (targetIntegrations.length === 0) {
      return res.status(400).json({ error: 'At least one social account channel must be selected' });
    }

    const result = await PostizService.createPost(userId, {
      type: effectiveType as any,
      date: effectiveDate,
      integrationIds: targetIntegrations,
      content: content || '',
      platformSpecificContent,
      posts: posts && Array.isArray(posts) ? posts : undefined,
      media,
      settings,
      shortLink,
      tags
    });

    return res.status(201).json({
      success: true,
      post: result
    });
  } catch (err: any) {
    const status = err.statusCode || 500;
    return res.status(status).json({
      error: err.message,
      revoked: err.code === 'POSTIZ_REVOKED',
      details: err.details
    });
  }
});

/**
 * GET /api/postiz/posts
 * Retrieves scheduled, published, and drafted posts from Postiz
 */
router.get('/posts', async (req: Request, res: Response) => {
  try {
    const userId = resolveUserId(req);
    const { startDate, endDate } = req.query;

    const posts = await PostizService.getPosts(userId, {
      startDate: startDate as string,
      endDate: endDate as string
    });

    return res.json({
      success: true,
      posts,
      count: posts.length
    });
  } catch (err: any) {
    const status = err.statusCode || 500;
    return res.status(status).json({
      error: err.message,
      revoked: err.code === 'POSTIZ_REVOKED'
    });
  }
});

/**
 * DELETE /api/postiz/posts/:id
 * Cancels / deletes a scheduled post on Postiz
 */
router.delete('/posts/:id', async (req: Request, res: Response) => {
  try {
    const userId = resolveUserId(req);
    const postId = req.params.id;

    if (!postId) {
      return res.status(400).json({ error: 'Post ID is required' });
    }

    const result = await PostizService.deletePost(userId, postId);
    return res.json(result);
  } catch (err: any) {
    const status = err.statusCode || 500;
    return res.status(status).json({
      error: err.message,
      revoked: err.code === 'POSTIZ_REVOKED'
    });
  }
});

/**
 * POST /api/postiz/posts/:id/retry
 * Retries publishing failed integrations for a post via Postiz
 */
router.post('/posts/:id/retry', async (req: Request, res: Response) => {
  try {
    const userId = resolveUserId(req);
    const postId = req.params.id;
    const { integrationIds } = req.body;

    if (!postId) {
      return res.status(400).json({ error: 'Post ID is required' });
    }

    const retriedPost = await PostizService.retryPost(userId, postId, integrationIds);
    return res.json({
      success: true,
      message: 'Post retried successfully via Postiz',
      post: retriedPost
    });
  } catch (err: any) {
    const status = err.statusCode || 500;
    return res.status(status).json({
      error: err.message,
      revoked: err.code === 'POSTIZ_REVOKED'
    });
  }
});

/**
 * POST /api/postiz/webhook
 * Handles incoming webhooks from Postiz
 */
router.post('/webhook', async (req: Request, res: Response) => {
  const signature = req.headers['x-postiz-signature'] as string;
  const rawBody = (req as any).rawBody || JSON.stringify(req.body);

  const isValid = PostizService.verifyWebhookSignature(rawBody, signature);
  if (!isValid && process.env.NODE_ENV === 'production') {
    return res.status(401).json({ error: 'Invalid Postiz webhook signature' });
  }

  const payload = req.body;
  console.log('[Postiz Webhook] Ingested event:', payload?.event, payload?.data?.postId);

  // Handle channel revocation or disconnection
  if (payload?.event === 'integration.revoked' || payload?.event === 'channel.disconnected') {
    const integrationId = payload.data?.integrationId;
    console.warn('[Postiz Webhook] Integration revoked or channel disconnected:', integrationId);
  }

  return res.json({ received: true, event: payload?.event });
});

export default router;
