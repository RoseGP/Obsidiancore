/**
 * Google Calendar connection, per signed-in user (organizations/{orgId}/users/{userId}/integrations/google).
 *
 *   GET    /api/gcal/status          connection status for the caller (never tokens)
 *   GET    /api/gcal/auth-url        consent URL bound to the caller via single-use server-side state
 *   GET    /api/gcal/oauth2callback  public: Google redirects here; state decides whose tokens these are
 *   POST   /api/gcal/sync            sync now
 *   POST   /api/gcal/register-watch  start push notifications (needs a public https APP_URL)
 *   DELETE /api/gcal/connection      disconnect: revoke at Google, stop the channel, delete tokens and synced data
 *   POST   /api/gcal/webhook         public: Google push notifications, verified by the per-channel token
 */
import { Router, type Request, type Response } from 'express';
import { google } from 'googleapis';
import { getDocStore } from '../server/data/docStore';
import { consumeOAuthState, createOAuthState, deleteGoogleTokens, getGoogleConnection, verifyChannelToken } from '../server/integrations/googleTokens';
import { requireTenant, sendError, tenantOf } from '../server/tenancy/middleware';
import { generateAuthUrl, googleConfig, handleOAuthCallback, registerWatchChannel, stopSync, syncGoogleCalendarEvents } from '../services/gcalSyncService';

const router = Router();

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
/** Small result page for the OAuth pop-up. All dynamic text is escaped. */
function resultPage(res: Response, status: number, ok: boolean, message: string) {
  res.status(status).set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'" }).send(`<!doctype html><html><head><meta charset="utf-8"><title>Google Calendar</title>
<style>body{font:15px system-ui,sans-serif;background:#0f172a;color:#f8fafc;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}main{max-width:420px;padding:28px;text-align:center}h1{font-size:18px;color:${ok ? '#34d399' : '#f87171'}}</style></head>
<body><main><h1>${ok ? 'Google Calendar connected' : 'Couldn’t connect Google Calendar'}</h1><p>${esc(message)}</p><p>You can close this window.</p></main>
<script>try{window.opener&&window.opener.postMessage({type:'gcal-connected',ok:${ok}},location.origin)}catch(e){}setTimeout(function(){window.close()},${ok ? 1500 : 6000})</script></body></html>`);
}

// ---- Public endpoints (no CRM session) ----
router.get('/oauth2callback', async (req: Request, res: Response) => {
  const who = await consumeOAuthState(req.query.state, 'gcal').catch(() => null);
  if (req.query.error) return resultPage(res, 400, false, 'Access wasn’t granted. Try again from the Calendar page.');
  if (!who) return resultPage(res, 400, false, 'This link expired or was already used. Start again from the Calendar page.');
  if (typeof req.query.code !== 'string') return resultPage(res, 400, false, 'Google didn’t return an authorization code.');
  try {
    const { email } = await handleOAuthCallback(who.orgId, who.userId, req.query.code);
    try { await syncGoogleCalendarEvents(who.orgId, who.userId); } catch (e: any) { console.warn('[gcal] first sync failed:', e?.message); }
    if (googleConfig().appUrl.startsWith('https://')) { try { await registerWatchChannel(who.orgId, who.userId); } catch (e: any) { console.warn('[gcal] watch registration failed:', e?.message); } }
    return resultPage(res, 200, true, email ? `Connected as ${email}.` : 'Connected.');
  } catch (err: any) {
    console.error('[gcal] OAuth callback failed:', err?.message);
    return resultPage(res, 502, false, 'Google rejected the request. Try again.');
  }
});

router.post('/webhook', async (req: Request, res: Response) => {
  const channelId = req.get('x-goog-channel-id') || '';
  if (!/^crm_[0-9a-f-]{36}$/.test(channelId) || !verifyChannelToken(channelId, req.get('x-goog-channel-token'))) return res.status(401).end();
  res.status(200).end(); // acknowledge immediately; Google retries slow endpoints
  if (req.get('x-goog-resource-state') === 'sync') return;
  try {
    const ch = await (await getDocStore()).get(`crm_gcal_channels/${channelId}`);
    if (ch) await syncGoogleCalendarEvents(ch.orgId, ch.userId);
  } catch (e: any) { console.warn('[gcal] webhook sync failed:', e?.message); }
});

// ---- Signed-in endpoints ----
router.use(requireTenant);

router.get('/status', async (req, res) => {
  try {
    const t = tenantOf(req);
    const c = googleConfig();
    res.json({ success: true, configured: c.configured, ...(await getGoogleConnection(t.orgId, t.userId)), setup: c.configured ? undefined : 'Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and APP_URL, and add the redirect URI below in Google Cloud.', redirectUri: c.configured ? c.redirectUri : undefined });
  } catch (err) { sendError(res, err, 'gcal.status'); }
});

router.get('/auth-url', async (req, res) => {
  try {
    const t = tenantOf(req);
    if (!googleConfig().configured) return res.status(503).json({ success: false, code: 'google_not_configured', error: 'Google Calendar isn’t configured on the server yet.' });
    const authUrl = generateAuthUrl(await createOAuthState(t.orgId, t.userId, 'gcal'));
    res.json({ success: true, authUrl, redirectUri: googleConfig().redirectUri });
  } catch (err) { sendError(res, err, 'gcal.authUrl'); }
});

router.post('/sync', async (req, res) => {
  try { const t = tenantOf(req); res.json({ success: true, ...(await syncGoogleCalendarEvents(t.orgId, t.userId)) }); }
  catch (err) { sendError(res, err, 'gcal.sync'); }
});

router.post('/register-watch', async (req, res) => {
  try { const t = tenantOf(req); res.json({ success: true, channel: await registerWatchChannel(t.orgId, t.userId) }); }
  catch (err) { sendError(res, err, 'gcal.watch'); }
});

router.delete('/connection', async (req, res) => {
  try {
    const t = tenantOf(req);
    await stopSync(t.orgId, t.userId).catch(() => {});
    const tokens = await deleteGoogleTokens(t.orgId, t.userId);
    const token = tokens?.refreshToken || tokens?.accessToken;
    if (token && googleConfig().configured) { try { await new google.auth.OAuth2().revokeToken(token); } catch { /* already revoked */ } }
    res.json({ success: true });
  } catch (err) { sendError(res, err, 'gcal.disconnect'); }
});

export default router;
