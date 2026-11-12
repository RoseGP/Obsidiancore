/**
 * Security helpers for the LinkedIn / Facebook OAuth callbacks (oauth.ts). Pure: Node crypto only.
 *
 * - OAuth `state` is `<uid>.<expires>.<hmac>` signed with OAUTH_STATE_SECRET. The callbacks used to take
 *   `state` as the raw user id, so anyone could finish an OAuth flow with someone else's id and attach their
 *   own social account to that user (or overwrite theirs), and slashes in it changed the Firestore path.
 *   Whatever starts the flow must issue the state with `signOAuthState` for the signed-in user.
 * - Configuration is required: no built-in fallback keys, client ids or secrets. Missing → the callback
 *   answers 503 and nothing is stored.
 * - Responses are plain text with fixed messages: provider-supplied text (`error_description`) and internal
 *   error messages are never echoed (that was a reflected XSS and an information leak).
 */
import * as crypto from 'crypto';

export const STATE_MAX_TTL_SECONDS = 15 * 60;
const UID_RE = /^[A-Za-z0-9_-]{1,128}$/;

export class OAuthConfigError extends Error {}

/** A required setting from the environment, or OAuthConfigError (no fallbacks). */
export function requiredEnv(name: string, env: NodeJS.ProcessEnv = process.env): string {
  const v = (env[name] || '').trim();
  if (!v) throw new OAuthConfigError(`${name} is not set`);
  return v;
}

function stateKey(env: NodeJS.ProcessEnv): Buffer {
  const secret = requiredEnv('OAUTH_STATE_SECRET', env);
  if (secret.length < 32) throw new OAuthConfigError('OAUTH_STATE_SECRET must be at least 32 characters');
  return crypto.createHash('sha256').update(`functions-oauth-state:${secret}`).digest();
}

const mac = (key: Buffer, body: string) => crypto.createHmac('sha256', key).update(body).digest('base64url');

/** Issues a state for `uid`, valid for at most 15 minutes. */
export function signOAuthState(uid: string, env: NodeJS.ProcessEnv = process.env, ttlSeconds = 600, now = Date.now()): string {
  if (!UID_RE.test(uid)) throw new Error('invalid uid');
  const exp = Math.floor(now / 1000) + Math.min(Math.max(ttlSeconds, 60), STATE_MAX_TTL_SECONDS);
  const body = `${uid}.${exp}`;
  return `${body}.${mac(stateKey(env), body)}`;
}

/** The user id from a valid, unexpired state; null for anything else (tampered, expired, malformed). */
export function verifyOAuthState(state: unknown, env: NodeJS.ProcessEnv = process.env, now = Date.now()): string | null {
  if (typeof state !== 'string' || state.length > 300) return null;
  const parts = state.split('.');
  if (parts.length !== 3) return null;
  const [uid, expStr, sig] = parts;
  if (!UID_RE.test(uid) || !/^\d{1,12}$/.test(expStr) || !/^[A-Za-z0-9_-]{43}$/.test(sig)) return null;
  const expected = Buffer.from(mac(stateKey(env), `${uid}.${expStr}`));
  const got = Buffer.from(sig);
  if (got.length !== expected.length || !crypto.timingSafeEqual(got, expected)) return null;
  const exp = Number(expStr), nowS = Math.floor(now / 1000);
  if (exp < nowS || exp > nowS + STATE_MAX_TTL_SECONDS) return null;
  return uid;
}

/**
 * The token-encryption key (required). Same derivation as before (the setting's bytes, zero-padded to 32) so
 * tokens already stored with a properly configured key still decrypt; only the hard-coded fallback is gone.
 */
export function tokenEncryptionKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  const v = requiredEnv('OAUTH_TOKEN_ENCRYPTION_KEY', env);
  if (Buffer.byteLength(v) < 32) throw new OAuthConfigError('OAUTH_TOKEN_ENCRYPTION_KEY must be at least 32 bytes');
  const key = Buffer.alloc(32);
  Buffer.from(v).copy(key);
  return key;
}

/** Fixed, non-reflective callback answers (plain text). */
export const CALLBACK_MESSAGES = {
  cancelled: (p: string) => `${p} sign-in was cancelled or refused. Close this window and try again from the app.`,
  badRequest: (p: string) => `This ${p} sign-in link is invalid or has expired. Start again from the app.`,
  notConfigured: (p: string) => `${p} connections aren't configured on this server.`,
  failed: (p: string) => `${p} couldn't be connected. Try again later.`,
};
