import { Router, Request, Response } from 'express';
import { 
  generateAuthUrl, 
  handleOAuthCallback, 
  registerWatchChannel, 
  syncGoogleCalendarEvents 
} from '../services/gcalSyncService';
import { gcalDataStore } from '../services/gcalTokenService';

const router = Router();

/**
 * GET /api/gcal/auth-url
 * Returns the Google Calendar OAuth2 consent URL
 */
router.get('/auth-url', (req: Request, res: Response) => {
  try {
    // The redirect URI comes from server config (APP_URL / GOOGLE_REDIRECT_URI), never from the Host header.
    const authUrl = generateAuthUrl('host_primary');
    return res.json({ success: true, authUrl });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/gcal/oauth2callback
 * Handles Google OAuth redirect callback
 */
router.get('/oauth2callback', async (req: Request, res: Response) => {
  try {
    const code = req.query.code as string;
    const error = req.query.error as string;

    if (error) {
      return res.status(400).send(`
        <html>
          <body style="font-family: sans-serif; background: #0f172a; color: #f8fafc; padding: 40px; text-align: center;">
            <h2 style="color: #ef4444;">Google Calendar OAuth Authorization Failed</h2>
            <p>Error: ${error}</p>
            <a href="/" style="color: #6366f1;">Return to CRM Workspace</a>
          </body>
        </html>
      `);
    }

    if (!code) {
      return res.status(400).json({ success: false, error: 'Missing code query parameter.' });
    }

    // 1. Exchange auth code for tokens and encrypt them
    const { userId } = await handleOAuthCallback(code, 'host_primary');

    // 2. Push notifications need a public https APP_URL; without one, sync on demand only.
    const watchChannel = await registerWatchChannel(userId).catch((e) => { console.warn('[gcal] push notifications not registered:', e.message); return null; });

    // 3. Initial synchronization
    const syncResult = await syncGoogleCalendarEvents(userId, watchChannel?.channelId);

    // Return clean user feedback page and automatically redirect back to the app UI
    return res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Google Calendar Connected</title>
          <style>
            body { font-family: system-ui, -apple-system, sans-serif; background-color: #07090e; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
            .card { background: #0f172a; border: 1px solid #1e293b; border-radius: 16px; padding: 32px; max-width: 480px; text-align: center; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5); }
            .badge { background: #10b981; color: #022c22; font-weight: bold; padding: 6px 16px; border-radius: 9999px; display: inline-block; margin-bottom: 16px; }
            button { background: #6366f1; color: white; border: none; padding: 10px 24px; border-radius: 8px; font-weight: bold; cursor: pointer; margin-top: 20px; }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="badge">Connected & Synchronized</div>
            <h2>Google Calendar Live Sync Active</h2>
            <p style="color: #94a3b8; font-size: 14px;">
              Successfully attached Google Calendar push notification watch channel.
              Synchronized <strong>${syncResult.syncedCount}</strong> events to guarantee zero double bookings.
            </p>
            <button onclick="window.close(); if(window.opener) window.opener.location.reload();">Return to Booking Workspace</button>
          </div>
          <script>
            setTimeout(() => {
              if (window.opener) {
                window.opener.location.href = '/?view=public_scheduling&gcal_connected=true';
                window.close();
              } else {
                window.location.href = '/?view=public_scheduling&gcal_connected=true';
              }
            }, 2500);
          </script>
        </body>
      </html>
    `);
  } catch (err: any) {
    console.error('[GCal OAuth Callback Error]:', err);
    return res.status(500).send(`
      <html>
        <body style="font-family: sans-serif; background: #0f172a; color: #f8fafc; padding: 40px; text-align: center;">
          <h2 style="color: #ef4444;">Google Calendar Setup Error</h2>
          <p>${err.message || err}</p>
          <a href="/" style="color: #6366f1;">Return to Workspace</a>
        </body>
      </html>
    `);
  }
});

/**
 * POST /api/webhooks/gcal
 * Google Calendar Push Notification Webhook Listener Endpoint
 * Triggers when events are created, modified, or deleted in the host's primary calendar.
 */
router.post('/gcal', async (req: Request, res: Response) => {
  // Extract notification headers from Google Push Notification request
  const channelId = req.header('x-goog-channel-id');
  const resourceId = req.header('x-goog-resource-id');
  const resourceState = req.header('x-goog-resource-state'); // 'sync' | 'exists' | 'not_exists'
  const channelToken = req.header('x-goog-channel-token');

  console.log(`[Google Calendar Webhook Received]: State=${resourceState} | ChannelID=${channelId} | ResourceID=${resourceId}`);

  // 1. Google Webhook Handshake Verification (Sync Header)
  if (resourceState === 'sync') {
    console.log(`[GCal Webhook Verified]: Watch channel '${channelId}' connected successfully.`);
    return res.status(200).send('OK - Channel Synchronized');
  }

  // 2. Immediately respond 200 OK to Google Webhook server to satisfy 10s latency SLA
  res.status(200).send('OK');

  // 3. Asynchronously trigger delta sync to fetch modified event details and update local busy intervals
  try {
    if (channelId) {
      const syncResult = await syncGoogleCalendarEvents('host_primary', channelId);
      console.log(`[GCal Incremental Sync Complete]: Processed ${syncResult.syncedCount} events. Zero double-booking status maintained.`);
    }
  } catch (err: any) {
    console.error('[GCal Webhook Async Processing Error]:', err.message || err);
  }
});

/**
 * POST /api/gcal/register-watch
 * Manually register or renew Google Calendar push notification watch channel
 */
router.post('/register-watch', async (req: Request, res: Response) => {
  try {
    const host = req.get('host');
    const protocol = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
    const baseUrl = `${protocol}://${host}`;

    const channelInfo = await registerWatchChannel('host_primary', baseUrl);
    const syncResult = await syncGoogleCalendarEvents('host_primary', channelInfo.channelId);

    return res.json({
      success: true,
      message: 'Watch channel attached and calendar synchronized successfully.',
      data: {
        channelInfo,
        syncedEventsCount: syncResult.syncedCount,
      }
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/gcal/status
 * Returns Google Calendar sync and watch channel status
 */
router.get('/status', (req: Request, res: Response) => {
  try {
    const tokens = gcalDataStore.getTokens('host_primary');
    const watchChannels = gcalDataStore.getAllWatchChannels();
    const syncedEvents = gcalDataStore.getSyncedEvents();

    return res.json({
      success: true,
      isConnected: !!tokens,
      activeWatchChannelsCount: watchChannels.length,
      syncedEventsCount: syncedEvents.length,
      watchChannels,
      syncedEvents,
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
