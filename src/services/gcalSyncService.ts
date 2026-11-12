/**
 * Google Calendar sync, per user and organization.
 *
 *   Tokens   organizations/{orgId}/users/{userId}/integrations/google      (encrypted, server/integrations/googleTokens.ts)
 *   Events   organizations/{orgId}/users/{userId}/gcal_events/{eventId}     (busy blocks used by availability)
 *   Sync     organizations/{orgId}/users/{userId}/integrations/google_sync  ({ syncToken, channelId, resourceId, expiration })
 *   Channels crm_gcal_channels/{channelId} → { orgId, userId }             (push notifications → owner)
 *
 * Requires GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and APP_URL. Nothing is simulated: without them the
 * routes report "not configured", and failures are returned as errors.
 */
import { randomUUID } from 'node:crypto';
import { google } from '../server/integrations/googleClients';
import { assertId, getDocStore } from '../server/data/docStore';
import { channelToken, getGoogleTokens, saveGoogleTokens } from '../server/integrations/googleTokens';

export const OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
];

export interface LocalGCalEvent { id: string; summary: string; startISO: string; endISO: string; status: 'confirmed' | 'cancelled'; updatedAt: string }

export class GoogleNotConfiguredError extends Error {
  status = 503; code = 'google_not_configured';
  constructor() { super('Google Calendar isn’t configured on the server (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, APP_URL).'); }
}
export class GoogleNotConnectedError extends Error {
  status = 409; code = 'google_not_connected';
  constructor() { super('Connect your Google Calendar first.'); }
}

export function googleConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID || '';
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
  const appUrl = (process.env.APP_URL || '').replace(/\/+$/, '');
  return { configured: !!(clientId && clientSecret && appUrl), clientId, clientSecret, appUrl, redirectUri: `${appUrl}/api/gcal/oauth2callback` };
}

export function createOAuth2Client() {
  const c = googleConfig();
  if (!c.configured) throw new GoogleNotConfiguredError();
  return new google.auth.OAuth2(c.clientId, c.clientSecret, c.redirectUri);
}

export function generateAuthUrl(state: string): string {
  return createOAuth2Client().generateAuthUrl({ access_type: 'offline', scope: OAUTH_SCOPES, prompt: 'consent', include_granted_scopes: true, state });
}

const userBase = (orgId: string, userId: string) => `organizations/${assertId(orgId)}/users/${assertId(userId)}`;

/** OAuth2 client for this user; refreshed tokens are written back (encrypted). */
export async function getAuthenticatedClient(orgId: string, userId: string) {
  const t = await getGoogleTokens(orgId, userId);
  if (!t) throw new GoogleNotConnectedError();
  const client = createOAuth2Client();
  client.setCredentials({ access_token: t.accessToken, refresh_token: t.refreshToken, expiry_date: t.expiryDate });
  client.on('tokens', (nt) => {
    if (nt.access_token) {
      saveGoogleTokens(orgId, userId, { accessToken: nt.access_token, refreshToken: nt.refresh_token ?? undefined, expiryDate: nt.expiry_date ?? undefined, scope: nt.scope ?? undefined })
        .catch((e) => console.error('[gcal] could not store refreshed token:', e?.message));
    }
  });
  return client;
}

export async function handleOAuthCallback(orgId: string, userId: string, code: string) {
  const client = createOAuth2Client();
  const { tokens } = await client.getToken(code);
  if (!tokens.access_token) throw new Error('Google didn’t return an access token.');
  client.setCredentials(tokens);
  let email: string | undefined;
  try { email = (await google.oauth2({ version: 'v2', auth: client }).userinfo.get()).data.email ?? undefined; } catch { /* optional */ }
  await saveGoogleTokens(orgId, userId, { accessToken: tokens.access_token, refreshToken: tokens.refresh_token ?? undefined, expiryDate: tokens.expiry_date ?? undefined, scope: tokens.scope ?? undefined, email });
  return { email };
}

/** Push notifications for this user's primary calendar. Google requires a public HTTPS address (APP_URL). */
export async function registerWatchChannel(orgId: string, userId: string) {
  const { appUrl } = googleConfig();
  if (!appUrl.startsWith('https://')) throw Object.assign(new Error('Push notifications need a public https APP_URL.'), { status: 400, code: 'https_required' });
  const client = await getAuthenticatedClient(orgId, userId);
  const channelId = `crm_${randomUUID()}`;
  const res = await google.calendar({ version: 'v3', auth: client }).events.watch({
    calendarId: 'primary',
    requestBody: { id: channelId, type: 'web_hook', address: `${appUrl}/api/gcal/webhook`, token: channelToken(channelId), expiration: String(Date.now() + 7 * 86_400_000) },
  });
  const st = await getDocStore();
  const info = { channelId, resourceId: res.data.resourceId || '', expiration: Number(res.data.expiration) || Date.now() + 7 * 86_400_000, createdAt: new Date().toISOString() };
  await st.set(`crm_gcal_channels/${channelId}`, { orgId, userId, ...info });
  const syncPath = `${userBase(orgId, userId)}/integrations/google_sync`;
  await st.set(syncPath, { ...((await st.get(syncPath)) || {}), ...info });
  return info;
}

/** Full sync (30 days back, 60 ahead) on first run or when Google expires the sync token (410); incremental after. */
export async function syncGoogleCalendarEvents(orgId: string, userId: string): Promise<{ syncedCount: number }> {
  const client = await getAuthenticatedClient(orgId, userId);
  const calendar = google.calendar({ version: 'v3', auth: client });
  const st = await getDocStore();
  const syncPath = `${userBase(orgId, userId)}/integrations/google_sync`;
  const sync = (await st.get(syncPath)) || {};
  const full = () => calendar.events.list({ calendarId: 'primary', singleEvents: true, maxResults: 2500, timeMin: new Date(Date.now() - 30 * 86_400_000).toISOString(), timeMax: new Date(Date.now() + 60 * 86_400_000).toISOString() });

  let synced = 0, pageToken: string | undefined, nextSyncToken: string | undefined;
  let incremental = !!sync.syncToken;
  do {
    let res;
    try {
      res = incremental ? await calendar.events.list({ calendarId: 'primary', syncToken: sync.syncToken, pageToken }) : pageToken ? await calendar.events.list({ calendarId: 'primary', singleEvents: true, pageToken }) : await full();
    } catch (err: any) {
      if (err?.code === 410 && incremental) { incremental = false; pageToken = undefined; continue; }
      throw err;
    }
    for (const item of res.data.items || []) {
      if (!item.id || !/^[A-Za-z0-9_-]{1,128}$/.test(item.id)) continue;
      const path = `${userBase(orgId, userId)}/gcal_events/${item.id}`;
      if (item.status === 'cancelled') { await st.deleteRecursive(path); continue; }
      await st.set(path, {
        id: item.id, summary: 'Busy', // titles stay in Google: availability only needs busy blocks
        startISO: item.start?.dateTime || item.start?.date || '', endISO: item.end?.dateTime || item.end?.date || '',
        status: 'confirmed', updatedAt: item.updated || new Date().toISOString(),
      } satisfies LocalGCalEvent);
      synced++;
    }
    pageToken = res.data.nextPageToken ?? undefined;
    nextSyncToken = res.data.nextSyncToken ?? nextSyncToken;
  } while (pageToken);
  await st.set(syncPath, { ...sync, syncToken: nextSyncToken ?? sync.syncToken ?? null, lastSyncedAt: new Date().toISOString() });
  return { syncedCount: synced };
}

export async function getSyncedEvents(orgId: string, userId: string): Promise<LocalGCalEvent[]> {
  return (await getDocStore()).list(`${userBase(orgId, userId)}/gcal_events`);
}

/** Stops push notifications and forgets synced data (tokens are deleted by the caller). */
export async function stopSync(orgId: string, userId: string) {
  const st = await getDocStore();
  const sync = await st.get(`${userBase(orgId, userId)}/integrations/google_sync`);
  if (sync?.channelId) {
    try { await google.calendar({ version: 'v3', auth: await getAuthenticatedClient(orgId, userId) }).channels.stop({ requestBody: { id: sync.channelId, resourceId: sync.resourceId } }); } catch { /* channel may already be gone */ }
    await st.deleteRecursive(`crm_gcal_channels/${sync.channelId}`);
  }
  await st.deleteRecursive(`${userBase(orgId, userId)}/integrations/google_sync`);
  for (const e of await getSyncedEvents(orgId, userId)) await st.deleteRecursive(`${userBase(orgId, userId)}/gcal_events/${e.id}`);
}
