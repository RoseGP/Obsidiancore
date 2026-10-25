/**
 * Social accounts server configuration. Everything comes from environment
 * variables; there are no credential fallbacks in code.
 *
 *   POSTIZ_API_URL            Postiz backend, e.g. https://api.postiz.com (no /public/v1)
 *   POSTIZ_FRONTEND_URL       Postiz web app hosting /oauth/authorize, e.g. https://platform.postiz.com
 *   POSTIZ_CLIENT_ID          Postiz OAuth app client id (pca_…)   ┐ OAuth mode: each user
 *   POSTIZ_CLIENT_SECRET      Postiz OAuth app client secret (pcs_…)┘ authorizes their workspace
 *   POSTIZ_REDIRECT_URI       Must equal the redirect URL saved on the Postiz OAuth app,
 *                             and point to  <APP_URL>/api/social-accounts/postiz/callback
 *   POSTIZ_API_KEY            API-key mode: one shared workspace (used if no client id)
 *   POSTIZ_ENTERPRISE_JWT_SECRET  Self-hosted only: your Postiz JWT_SECRET. Enables the
 *                             /enterprise/url flow that returns users to this app.
 *   APP_URL                   Public URL of this app, e.g. https://crm.example.com
 *   SOCIAL_ACCOUNTS_ENCRYPTION_KEY (or ENCRYPTION_KEY)  32+ chars, required in production
 *   SOCIAL_ACCOUNTS_STATE_SECRET   HMAC key for OAuth state (defaults to a key derived from the encryption key)
 *   SOCIAL_ACCOUNTS_STORE          firestore | file | auto (default auto: Firestore when credentials resolve)
 *   SOCIAL_ACCOUNTS_DATA_DIR       file store location (default data/social-accounts)
 *   SOCIAL_ACCOUNTS_RETURN_PATH    where users land after authorizing (default "/" + ?view=social_planner)
 */
import crypto from 'node:crypto';
import type { PostizMode } from '../shared/types';

const trimSlash = (s: string) => s.replace(/\/+$/, '');

export interface SocialAccountsConfig {
  postizMode: PostizMode;
  postizApiUrl: string;
  postizFrontendUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  apiKey: string;
  enterpriseSecret: string;
  appUrl: string;
  encryptionKey: Buffer | null;
  stateKey: Buffer | null;
  dataDir: string;
  storeMode: 'auto' | 'firestore' | 'file';
  returnPath: string;
  isProduction: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): SocialAccountsConfig {
  const isProduction = env.NODE_ENV === 'production';
  const clientId = env.POSTIZ_CLIENT_ID?.trim() || '';
  const clientSecret = env.POSTIZ_CLIENT_SECRET?.trim() || '';
  const apiKey = env.POSTIZ_API_KEY?.trim() || '';
  const postizMode: PostizMode = clientId && clientSecret ? 'oauth' : apiKey ? 'api_key' : 'none';

  const rawKey = env.SOCIAL_ACCOUNTS_ENCRYPTION_KEY || env.ENCRYPTION_KEY || '';
  let encryptionKey: Buffer | null = null;
  if (rawKey.length >= 32) encryptionKey = crypto.createHash('sha256').update(rawKey).digest();
  else if (!isProduction) {
    // Development only: a per-process random key. Stored tokens won't survive a restart.
    encryptionKey = crypto.randomBytes(32);
  }
  const rawState = env.SOCIAL_ACCOUNTS_STATE_SECRET || '';
  const stateKey = rawState.length >= 32
    ? crypto.createHash('sha256').update(rawState).digest()
    : encryptionKey ? crypto.createHmac('sha256', encryptionKey).update('social-accounts-state').digest() : null;

  const baseUrl = trimSlash(env.POSTIZ_URL || env.POSTIZ_BASE_URL || '');
  const appUrl = trimSlash(env.APP_URL || '');

  return {
    postizMode,
    postizApiUrl: trimSlash(env.POSTIZ_API_URL || baseUrl || 'https://api.postiz.com'),
    postizFrontendUrl: trimSlash(env.POSTIZ_FRONTEND_URL || baseUrl || 'https://platform.postiz.com'),
    clientId,
    clientSecret,
    redirectUri: env.POSTIZ_REDIRECT_URI?.trim() || (appUrl ? `${appUrl}/api/accounts/callback` : ''),
    apiKey,
    enterpriseSecret: env.POSTIZ_ENTERPRISE_JWT_SECRET?.trim() || '',
    appUrl,
    encryptionKey,
    stateKey,
    dataDir: env.SOCIAL_ACCOUNTS_DATA_DIR || 'data/social-accounts',
    storeMode: (['firestore', 'file'].includes(env.SOCIAL_ACCOUNTS_STORE || '') ? env.SOCIAL_ACCOUNTS_STORE : 'auto') as 'auto' | 'firestore' | 'file',
    // Only same-site paths: never redirect to another host from the callback.
    returnPath: /^\/(?!\/)[^\s]*$/.test(env.SOCIAL_ACCOUNTS_RETURN_PATH || '') ? env.SOCIAL_ACCOUNTS_RETURN_PATH! : '/',
    isProduction,
  };
}

// ---------- Encryption (AES-256-GCM) ----------

export interface Sealed { v: 1; iv: string; tag: string; data: string }

export function seal(plain: string, key: Buffer): Sealed {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return { v: 1, iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') };
}

export function unseal(s: Sealed, key: Buffer): string {
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(s.iv, 'base64'));
  d.setAuthTag(Buffer.from(s.tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(s.data, 'base64')), d.final()]).toString('utf8');
}

// ---------- Signed, expiring OAuth state ----------

const b64u = (b: Buffer) => b.toString('base64url');

export interface StatePayload { u: string; a: string; k: 'workspace' | 'channel'; exp: number }

export function signState(p: StatePayload, key: Buffer): string {
  const body = b64u(Buffer.from(JSON.stringify(p)));
  const mac = b64u(crypto.createHmac('sha256', key).update(body).digest());
  return `${body}.${mac}`;
}

export function verifyState(state: string, key: Buffer, now = Date.now()): StatePayload | null {
  const [body, mac] = String(state || '').split('.');
  if (!body || !mac) return null;
  const expected = crypto.createHmac('sha256', key).update(body).digest();
  const given = Buffer.from(mac, 'base64url');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as StatePayload;
    if (typeof p.exp !== 'number' || p.exp < now || !p.u || !p.a) return null;
    return p;
  } catch {
    return null;
  }
}

export const randomId = (prefix: string) => `${prefix}_${crypto.randomBytes(12).toString('base64url')}`;
