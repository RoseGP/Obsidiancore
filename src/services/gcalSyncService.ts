/**
 * Google Calendar sync over plain HTTPS (no googleapis SDK).
 *   OAuth 2.0:  accounts.google.com/o/oauth2/v2/auth, oauth2.googleapis.com/token
 *   Calendar:   www.googleapis.com/calendar/v3/calendars/primary/events (list, watch)
 * Failures are reported, never replaced with sample events.
 */
import {
  encryptToken,
  decryptToken,
  gcalDataStore,
  StoredTokens,
  WatchChannelInfo,
  LocalGCalEvent
} from './gcalTokenService';
import { optionalSecret } from '../utils/secrets';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const CLIENT_SECRET = optionalSecret('GOOGLE_CLIENT_SECRET');
const appUrl = (process.env.APP_URL || '').replace(/\/$/, '');
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || (appUrl ? `${appUrl}/api/gcal/oauth2callback` : '');
const CAL = 'https://www.googleapis.com/calendar/v3/calendars/primary';

export const OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/userinfo.email',
];

export class GoogleCalendarError extends Error {
  constructor(message: string, public status = 502) { super(message); }
}

function assertConfigured() {
  if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI) {
    throw new GoogleCalendarError('Google Calendar isn’t configured on the server (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and APP_URL or GOOGLE_REDIRECT_URI).', 503);
  }
}

async function googleJson(url: string, init: RequestInit = {}): Promise<any> {
  let res: Response;
  try { res = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) }); }
  catch { throw new GoogleCalendarError('Google couldn’t be reached.', 502); }
  const text = await res.text();
  let body: any = null; try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) {
    const msg = typeof body?.error === 'object' ? body.error.message : body?.error_description || body?.error || `Google returned ${res.status}.`;
    throw new GoogleCalendarError(String(msg).slice(0, 300), res.status);
  }
  return body;
}

/** Google OAuth authorization URL. */
export function generateAuthUrl(userId: string = 'host_primary', redirectUriUrl?: string): string {
  assertConfigured();
  const q = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: redirectUriUrl || REDIRECT_URI,
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent', // forces a refresh token
    scope: OAUTH_SCOPES.join(' '),
    state: Buffer.from(JSON.stringify({ userId, timestamp: Date.now() })).toString('base64'),
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

async function tokenRequest(params: Record<string, string>) {
  assertConfigured();
  return googleJson('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, ...params }),
  });
}

/** A valid access token for the user, refreshed and re-encrypted when it is about to expire. */
export async function getAccessToken(userId: string = 'host_primary'): Promise<string> {
  const stored = gcalDataStore.getTokens(userId);
  if (!stored) throw new GoogleCalendarError(`Google Calendar isn’t connected for this account.`, 409);
  if (stored.expiryDate - Date.now() > 60_000) return decryptToken(stored.accessTokenEncrypted);
  const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: decryptToken(stored.refreshTokenEncrypted) });
  const updated: StoredTokens = {
    ...stored,
    accessTokenEncrypted: encryptToken(t.access_token),
    refreshTokenEncrypted: t.refresh_token ? encryptToken(t.refresh_token) : stored.refreshTokenEncrypted,
    expiryDate: Date.now() + (Number(t.expires_in) || 3600) * 1000,
    scope: t.scope || stored.scope,
    updatedAt: new Date().toISOString(),
  };
  gcalDataStore.saveTokens(userId, updated);
  return t.access_token;
}

/** Exchange the authorization code for tokens and store them encrypted. */
export async function handleOAuthCallback(code: string, userId: string = 'host_primary') {
  const t = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI });
  if (!t?.access_token) throw new GoogleCalendarError('Google didn’t return an access token.');
  if (!t.refresh_token) throw new GoogleCalendarError('Google didn’t return a refresh token. Remove the app’s access in your Google account and connect again.');
  const storedTokens: StoredTokens = {
    userId,
    accessTokenEncrypted: encryptToken(t.access_token),
    refreshTokenEncrypted: encryptToken(t.refresh_token),
    expiryDate: Date.now() + (Number(t.expires_in) || 3600) * 1000,
    scope: t.scope || OAUTH_SCOPES.join(' '),
    updatedAt: new Date().toISOString(),
  };
  gcalDataStore.saveTokens(userId, storedTokens);
  return { userId, expiryDate: storedTokens.expiryDate };
}

/** Register a push-notification channel (events.watch) on the primary calendar. Needs a public HTTPS APP_URL. */
export async function registerWatchChannel(userId: string = 'host_primary', webhookBaseUrl?: string): Promise<WatchChannelInfo> {
  const base = (webhookBaseUrl || appUrl).replace(/\/$/, '');
  if (!base.startsWith('https://')) throw new GoogleCalendarError('Calendar push notifications need a public https APP_URL.', 400);
  const token = await getAccessToken(userId);
  const channelId = `crm_channel_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const w = await googleJson(`${CAL}/events/watch`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: channelId, type: 'web_hook', address: `${base}/api/webhooks/gcal`, token: `user:${userId}`, expiration: String(Date.now() + 7 * 24 * 3600 * 1000) }),
  });
  const info: WatchChannelInfo = {
    channelId,
    resourceId: String(w?.resourceId ?? ''),
    expiration: Number(w?.expiration) || Date.now() + 7 * 24 * 3600 * 1000,
    createdAt: new Date().toISOString(),
  };
  gcalDataStore.saveWatchChannel(channelId, info);
  return info;
}

async function listEvents(token: string, params: Record<string, string>) {
  const items: any[] = [];
  let pageToken = ''; let nextSyncToken: string | undefined;
  do {
    const q = new URLSearchParams({ ...params, maxResults: '250', ...(pageToken ? { pageToken } : {}) });
    const b = await googleJson(`${CAL}/events?${q}`, { headers: { Authorization: `Bearer ${token}` } });
    items.push(...(b?.items ?? []));
    pageToken = b?.nextPageToken || '';
    nextSyncToken = b?.nextSyncToken || nextSyncToken;
  } while (pageToken && items.length < 2500);
  return { items, nextSyncToken };
}

/** Sync events: incremental with a sync token, else the last 30 / next 60 days. */
export async function syncGoogleCalendarEvents(userId: string = 'host_primary', channelId?: string): Promise<{ syncedCount: number; events: LocalGCalEvent[] }> {
  const token = await getAccessToken(userId);
  const activeChannel = channelId ? gcalDataStore.getWatchChannel(channelId) : gcalDataStore.getAllWatchChannels()[0];
  const window = { timeMin: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString(), timeMax: new Date(Date.now() + 60 * 24 * 3600 * 1000).toISOString(), singleEvents: 'true' };
  let result;
  if (activeChannel?.nextSyncToken) {
    try { result = await listEvents(token, { syncToken: activeChannel.nextSyncToken }); }
    catch (e) { if ((e as GoogleCalendarError).status === 410) result = await listEvents(token, window); else throw e; }
  } else {
    result = await listEvents(token, window);
  }
  const updated: LocalGCalEvent[] = [];
  for (const item of result.items) {
    if (!item?.id) continue;
    const ev: LocalGCalEvent = {
      id: String(item.id),
      summary: item.summary || 'Busy',
      startISO: item.start?.dateTime || item.start?.date || '',
      endISO: item.end?.dateTime || item.end?.date || '',
      status: item.status === 'cancelled' ? 'cancelled' : 'confirmed',
      updatedAt: item.updated || new Date().toISOString(),
    };
    gcalDataStore.upsertEvent(ev);
    updated.push(ev);
  }
  if (result.nextSyncToken && activeChannel) gcalDataStore.setSyncToken(activeChannel.channelId, result.nextSyncToken);
  return { syncedCount: updated.length, events: gcalDataStore.getSyncedEvents() };
}
