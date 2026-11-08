/**
 * Per-user Google OAuth tokens, encrypted at rest.
 *
 *   organizations/{orgId}/users/{userId}/integrations/google
 *     { email, scope, expiryDate, connectedAt, updatedAt, keyVersion,
 *       accessToken: { iv, tag, data }, refreshToken: { iv, tag, data } }   ← AES-256-GCM
 *
 * Key: GOOGLE_TOKEN_ENCRYPTION_KEY (preferred) or ENCRYPTION_KEY, run through HKDF-SHA256 with a fixed
 * label, so the same master secret never encrypts two kinds of data with the same key. In production a
 * missing key is a startup error; there is no hardcoded fallback.
 *
 * OAuth state: random nonce stored server-side (crm_oauth_states/{nonce}, single use, 10 minutes) binding
 * the browser redirect back to the org + user who started it.
 */
import crypto from 'node:crypto';
import { assertId, getDocStore } from '../data/docStore';

export interface GoogleTokenSet {
  accessToken: string;
  refreshToken?: string;
  /** epoch ms */
  expiryDate?: number;
  scope?: string;
  email?: string;
}
interface Sealed { iv: string; tag: string; data: string }

const KEY_VERSION = 1;
let cachedKey: Buffer | null = null;
function encryptionKey(): Buffer {
  if (cachedKey) return cachedKey;
  const secret = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY || process.env.ENCRYPTION_KEY || '';
  if (secret.length < 32) {
    if (process.env.NODE_ENV === 'production') throw new Error('GOOGLE_TOKEN_ENCRYPTION_KEY (or ENCRYPTION_KEY, 32+ chars) must be set.');
    console.warn('[google] No GOOGLE_TOKEN_ENCRYPTION_KEY set: using a random per-process key (development only; tokens won’t survive a restart).');
    cachedKey = crypto.randomBytes(32);
    return cachedKey;
  }
  cachedKey = Buffer.from(crypto.hkdfSync('sha256', Buffer.from(secret, 'utf8'), Buffer.alloc(0), Buffer.from('crm:google-oauth-tokens:v1'), 32));
  return cachedKey;
}

export function seal(plain: string): Sealed {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}
export function unseal(s: Sealed): string {
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(s.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(s.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(s.data, 'base64')), decipher.final()]).toString('utf8');
}

const docPath = (orgId: string, userId: string) => `organizations/${assertId(orgId)}/users/${assertId(userId)}/integrations/google`;

export async function saveGoogleTokens(orgId: string, userId: string, t: GoogleTokenSet): Promise<void> {
  const st = await getDocStore();
  const path = docPath(orgId, userId);
  const now = new Date().toISOString();
  const existing = await st.get(path);
  // Google only returns a refresh token on first consent: keep the stored one if this response has none.
  const refresh = t.refreshToken ? seal(t.refreshToken) : existing?.refreshToken ?? null;
  await st.set(path, {
    accessToken: seal(t.accessToken), refreshToken: refresh,
    expiryDate: t.expiryDate ?? null, scope: t.scope ?? existing?.scope ?? null, email: t.email ?? existing?.email ?? null,
    connectedAt: existing?.connectedAt ?? now, updatedAt: now, keyVersion: KEY_VERSION,
  });
}

export async function getGoogleTokens(orgId: string, userId: string): Promise<(GoogleTokenSet & { connectedAt: string }) | null> {
  const doc = await (await getDocStore()).get(docPath(orgId, userId));
  if (!doc?.accessToken) return null;
  try {
    return {
      accessToken: unseal(doc.accessToken), refreshToken: doc.refreshToken ? unseal(doc.refreshToken) : undefined,
      expiryDate: doc.expiryDate ?? undefined, scope: doc.scope ?? undefined, email: doc.email ?? undefined, connectedAt: doc.connectedAt,
    };
  } catch {
    // Wrong/rotated key or tampered record: treat as disconnected rather than crash.
    console.error(`[google] could not decrypt tokens for ${orgId}/${userId}; the user must reconnect.`);
    return null;
  }
}

/** Public status only: never tokens. */
export async function getGoogleConnection(orgId: string, userId: string) {
  const doc = await (await getDocStore()).get(docPath(orgId, userId));
  return doc?.accessToken ? { connected: true, email: doc.email ?? null, scope: doc.scope ?? null, connectedAt: doc.connectedAt, hasRefreshToken: !!doc.refreshToken } : { connected: false };
}

export async function deleteGoogleTokens(orgId: string, userId: string): Promise<GoogleTokenSet | null> {
  const t = await getGoogleTokens(orgId, userId);
  await (await getDocStore()).deleteRecursive(docPath(orgId, userId));
  return t;
}

// ---------------------------------------------------------------------------
// OAuth state (server-side, single use)
// ---------------------------------------------------------------------------
const STATE_TTL_MS = 10 * 60_000;
export async function createOAuthState(orgId: string, userId: string, purpose: string): Promise<string> {
  const nonce = crypto.randomBytes(24).toString('base64url');
  await (await getDocStore()).set(`crm_oauth_states/${nonce}`, { orgId: assertId(orgId), userId: assertId(userId), purpose, expiresAt: Date.now() + STATE_TTL_MS });
  return nonce;
}
/** Returns the org/user that started the flow, or null if the state is unknown, used, expired or for another purpose. */
export async function consumeOAuthState(nonce: unknown, purpose: string): Promise<{ orgId: string; userId: string } | null> {
  if (typeof nonce !== 'string' || !/^[A-Za-z0-9_-]{20,64}$/.test(nonce)) return null;
  const st = await getDocStore();
  return st.transaction(async (tx) => {
    const rec = await tx.get(`crm_oauth_states/${nonce}`);
    if (!rec) return null;
    tx.delete(`crm_oauth_states/${nonce}`);
    if (rec.purpose !== purpose || rec.expiresAt < Date.now()) return null;
    return { orgId: rec.orgId as string, userId: rec.userId as string };
  });
}

// ---------------------------------------------------------------------------
// Push-notification channels: channelId → owner, with a per-channel secret token
// ---------------------------------------------------------------------------
export function channelToken(channelId: string): string {
  return crypto.createHmac('sha256', encryptionKey()).update(`gcal-channel:${channelId}`).digest('base64url');
}
export function verifyChannelToken(channelId: string, token: unknown): boolean {
  if (typeof token !== 'string') return false;
  const a = Buffer.from(channelToken(channelId)), b = Buffer.from(token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
