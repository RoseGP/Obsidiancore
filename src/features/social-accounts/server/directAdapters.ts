/**
 * Direct provider connections (no Postiz). Implement DirectAdapter to add a
 * provider's own OAuth or credential flow; register it in DIRECT_ADAPTERS
 * and mark the platform `method: 'direct'` in shared/types.ts.
 */
import type { AccountPlatform } from '../shared/types';

export interface DirectField { key: string; label: string; type: 'text' | 'password' | 'url'; placeholder?: string; help?: string }

export interface VerifiedAccount {
  externalId: string;
  name: string;
  handle?: string;
  pictureUrl?: string;
  /** Credential to store encrypted (never returned to the browser). */
  secret: string;
  meta?: Record<string, string>;
}

export class DirectAdapterError extends Error {
  constructor(message: string, public kind: 'invalid_credentials' | 'invalid_input' | 'unavailable', public field?: string) {
    super(message);
  }
}

export interface DirectAdapter {
  platform: AccountPlatform;
  fields: DirectField[];
  /** Validates input against the provider and returns the account. Throws DirectAdapterError. */
  connect(input: Record<string, string>): Promise<VerifiedAccount>;
  /** Re-checks a stored credential. Returns null when still valid, or a problem. */
  verify(secret: string, meta: Record<string, string>): Promise<{ status: 'expired' | 'needs_attention'; detail: string } | null>;
}

// ---------- Bluesky (AT Protocol, official XRPC endpoints) ----------

const allowedBlueskyServices = () =>
  (process.env.BLUESKY_ALLOWED_SERVICES || 'https://bsky.social').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);

async function xrpc(url: string, init: RequestInit): Promise<{ status: number; body: any }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    let body: any = null;
    try { body = await res.json(); } catch { /* */ }
    return { status: res.status, body };
  } catch {
    throw new DirectAdapterError('Bluesky couldn’t be reached. Try again in a moment.', 'unavailable');
  } finally { clearTimeout(t); }
}

export const blueskyAdapter: DirectAdapter = {
  platform: 'bluesky',
  fields: [
    { key: 'identifier', label: 'Handle or email', type: 'text', placeholder: 'yourname.bsky.social' },
    { key: 'appPassword', label: 'App password', type: 'password', placeholder: 'xxxx-xxxx-xxxx-xxxx', help: 'Create one in Bluesky under Settings → Privacy and security → App passwords. Don’t use your main password.' },
  ],
  async connect(input) {
    const identifier = String(input.identifier || '').trim().replace(/^@/, '');
    const password = String(input.appPassword || '').trim();
    if (!identifier) throw new DirectAdapterError('Enter your Bluesky handle or email.', 'invalid_input', 'identifier');
    if (!/^[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/i.test(password)) {
      throw new DirectAdapterError('Use an app password in the format xxxx-xxxx-xxxx-xxxx.', 'invalid_input', 'appPassword');
    }
    const service = allowedBlueskyServices()[0];
    const session = await xrpc(`${service}/xrpc/com.atproto.server.createSession`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, password }),
    });
    if (session.status === 401 || session.status === 400) throw new DirectAdapterError('Bluesky didn’t accept that handle and app password.', 'invalid_credentials', 'appPassword');
    if (session.status !== 200 || !session.body?.did) throw new DirectAdapterError('Bluesky returned an unexpected response.', 'unavailable');
    const { did, handle, accessJwt } = session.body;
    let name = String(handle || identifier);
    let pictureUrl: string | undefined;
    const profile = await xrpc(`${service}/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(did)}`, { headers: { Authorization: `Bearer ${accessJwt}` } }).catch(() => null);
    if (profile?.status === 200) {
      if (profile.body?.displayName) name = String(profile.body.displayName);
      if (typeof profile.body?.avatar === 'string' && profile.body.avatar.startsWith('https://')) pictureUrl = profile.body.avatar;
    }
    return { externalId: String(did), name, handle: `@${handle}`, pictureUrl, secret: JSON.stringify({ identifier, password }), meta: { service } };
  },
  async verify(secret, meta) {
    const { identifier, password } = JSON.parse(secret);
    const service = allowedBlueskyServices().includes(meta.service) ? meta.service : allowedBlueskyServices()[0];
    const r = await xrpc(`${service}/xrpc/com.atproto.server.createSession`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, password }),
    });
    if (r.status === 200) return null;
    if (r.status === 401 || r.status === 400) return { status: 'expired', detail: 'The app password was revoked or changed. Reconnect with a new one.' };
    return { status: 'needs_attention', detail: 'Bluesky couldn’t verify this account right now.' };
  },
};

export const DIRECT_ADAPTERS: Partial<Record<AccountPlatform, DirectAdapter>> = {
  bluesky: blueskyAdapter,
};
