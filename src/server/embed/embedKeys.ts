/**
 * Credentials for the embeddable calendar widget.
 *
 *   Publishable key  pk_…  Safe to put in a website's HTML. Only works from the website origins the owner
 *                          listed, and only with the scopes the owner granted (read-only by default).
 *   Secret key       sk_…  Server-to-server only (never in HTML). Used by the host website's backend to mint
 *                          short-lived embed tokens for its signed-in staff, so they can manage events.
 *   Embed token      et_…  HMAC-signed, expires in ≤ 1 hour, bound to org + scopes + origins.
 *
 * Why not a write-capable key in HTML: anything in a page's source is public. A publishable key with
 * events:write lets *any visitor* create events, so the owner must opt in explicitly (e.g. public booking
 * requests), and it stays origin-locked and rate-limited.
 *
 * Storage (server-only collections):
 *   organizations/{orgId}/embed_keys/{keyId}  { id, kind, label, prefix, scopes, allowedOrigins, createdAt, createdBy, revokedAt }
 *   crm_embed_keys/{sha256(key)}               { orgId, keyId }
 */
import crypto from 'node:crypto';
import { assertId, getDocStore, newId } from '../data/docStore';
import { TenancyError } from '../tenancy/orgs';

export const EMBED_SCOPES = ['events:read', 'events:write'] as const;
export type EmbedScope = typeof EMBED_SCOPES[number];
export type EmbedKeyKind = 'publishable' | 'secret';

export interface EmbedKeyRecord {
  id: string; kind: EmbedKeyKind; label: string; prefix: string; scopes: EmbedScope[]; allowedOrigins: string[];
  createdAt: string; createdBy: string; revokedAt: string | null;
}
export interface EmbedPrincipal { orgId: string; scopes: EmbedScope[]; allowedOrigins: string[]; via: 'publishable' | 'token' | 'secret'; keyId: string; subject?: string }

const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

/** Normalizes "https://www.example.com/path" → "https://www.example.com". Only http(s); http only for localhost. */
export function normalizeOrigin(raw: string): string | null {
  try {
    const u = new URL(String(raw).trim());
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && /^(localhost|127\.0\.0\.1)$/.test(u.hostname))) return null;
    return u.origin;
  } catch { return null; }
}

export async function createEmbedKey(orgId: string, actorId: string, input: { kind: EmbedKeyKind; label?: string; scopes?: string[]; allowedOrigins?: string[] }) {
  const kind: EmbedKeyKind = input.kind === 'secret' ? 'secret' : 'publishable';
  const scopes = [...new Set((input.scopes ?? ['events:read']).filter((s): s is EmbedScope => (EMBED_SCOPES as readonly string[]).includes(s)))];
  if (!scopes.length) throw new TenancyError(400, 'invalid_scopes', 'Choose at least one permission.');
  const origins = [...new Set((input.allowedOrigins ?? []).map(normalizeOrigin))];
  if (origins.some((o) => !o)) throw new TenancyError(400, 'invalid_origin', 'Website addresses must be full https:// URLs (http:// only for localhost).');
  if (kind === 'publishable' && !origins.length) throw new TenancyError(400, 'origin_required', 'List the website address(es) where the calendar will be embedded.');
  if (origins.length > 20) throw new TenancyError(400, 'too_many_origins', 'At most 20 website addresses per key.');

  const id = newId('ek');
  const secret = `${kind === 'secret' ? 'sk' : 'pk'}_${crypto.randomBytes(24).toString('base64url')}`;
  const rec: EmbedKeyRecord = {
    id, kind, label: String(input.label || (kind === 'secret' ? 'Server key' : 'Website calendar')).trim().slice(0, 80),
    prefix: secret.slice(0, 10), scopes, allowedOrigins: origins as string[], createdAt: new Date().toISOString(), createdBy: actorId, revokedAt: null,
  };
  const st = await getDocStore();
  await st.transaction(async (tx) => {
    tx.set(`organizations/${assertId(orgId)}/embed_keys/${id}`, rec);
    tx.set(`crm_embed_keys/${sha(secret)}`, { orgId, keyId: id });
  });
  return { key: rec, secret }; // the secret is returned once and only its hash is stored
}

export async function listEmbedKeys(orgId: string): Promise<EmbedKeyRecord[]> {
  return (await getDocStore()).list(`organizations/${assertId(orgId)}/embed_keys`, { orderBy: 'createdAt', direction: 'desc' });
}

export async function revokeEmbedKey(orgId: string, keyId: string) {
  const ok = await (await getDocStore()).update(`organizations/${assertId(orgId)}/embed_keys/${assertId(keyId)}`, { revokedAt: new Date().toISOString() });
  if (!ok) throw new TenancyError(404, 'not_found', 'Key not found.');
}

async function lookupKey(secret: string): Promise<{ orgId: string; rec: EmbedKeyRecord } | null> {
  if (!/^(pk|sk)_[A-Za-z0-9_-]{30,40}$/.test(secret)) return null;
  const st = await getDocStore();
  const ref = await st.get(`crm_embed_keys/${sha(secret)}`);
  if (!ref) return null;
  const rec: EmbedKeyRecord | null = await st.get(`organizations/${ref.orgId}/embed_keys/${ref.keyId}`);
  if (!rec || rec.revokedAt) return null;
  return { orgId: ref.orgId, rec };
}

// ---------------------------------------------------------------------------
// Embed tokens: et_<base64url(payload)>.<hmac>
// ---------------------------------------------------------------------------
function tokenSecret(): Buffer {
  const s = process.env.EMBED_TOKEN_SECRET || process.env.JWT_SECRET || '';
  if (s.length >= 16) return crypto.createHash('sha256').update(`embed:${s}`).digest();
  if (process.env.NODE_ENV === 'production') throw new Error('EMBED_TOKEN_SECRET (or JWT_SECRET) must be set.');
  return (globalThis as any).__embedDevSecret ??= crypto.randomBytes(32);
}

export async function mintEmbedToken(secretKey: string, input: { scopes?: string[]; ttlSeconds?: number; subject?: string; origins?: string[] }) {
  const found = await lookupKey(secretKey);
  if (!found || found.rec.kind !== 'secret') throw new TenancyError(401, 'invalid_key', 'A valid secret key is required.');
  const scopes = (input.scopes ?? found.rec.scopes).filter((s) => found.rec.scopes.includes(s as EmbedScope)) as EmbedScope[];
  if (!scopes.length) throw new TenancyError(400, 'invalid_scopes', 'Those permissions aren’t on this key.');
  const origins = (input.origins ?? found.rec.allowedOrigins).map(normalizeOrigin).filter(Boolean) as string[];
  if (!origins.length) throw new TenancyError(400, 'origin_required', 'Give the website origin(s) this token may be used from.');
  const ttl = Math.min(Math.max(Number(input.ttlSeconds) || 900, 60), 3600);
  const payload = { o: found.orgId, k: found.rec.id, s: scopes, a: origins, u: String(input.subject || '').slice(0, 120) || undefined, exp: Math.floor(Date.now() / 1000) + ttl, n: crypto.randomBytes(6).toString('hex') };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', tokenSecret()).update(body).digest('base64url');
  return { token: `et_${body}.${sig}`, expiresAt: new Date(payload.exp * 1000).toISOString(), scopes, origins };
}

async function verifyToken(token: string): Promise<EmbedPrincipal | null> {
  const m = /^et_([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(token);
  if (!m) return null;
  const expect = crypto.createHmac('sha256', tokenSecret()).update(m[1]).digest();
  const got = Buffer.from(m[2], 'base64url');
  if (got.length !== expect.length || !crypto.timingSafeEqual(got, expect)) return null;
  let p: any; try { p = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8')); } catch { return null; }
  if (!p?.o || typeof p.exp !== 'number' || p.exp * 1000 < Date.now()) return null;
  // The issuing secret key must still be active: revoking it ends its tokens too.
  const rec: EmbedKeyRecord | null = await (await getDocStore()).get(`organizations/${assertId(p.o)}/embed_keys/${assertId(p.k)}`);
  if (!rec || rec.revokedAt) return null;
  return { orgId: p.o, scopes: p.s, allowedOrigins: p.a, via: 'token', keyId: p.k, subject: p.u };
}

/** Resolves the caller from `Authorization: Bearer …` or `X-API-Key`. Secret keys are refused here (they're for minting tokens). */
export async function authenticateEmbed(credential: string): Promise<EmbedPrincipal | null> {
  if (!credential) return null;
  if (credential.startsWith('et_')) return verifyToken(credential);
  const found = await lookupKey(credential);
  if (!found || found.rec.kind !== 'publishable') return null;
  return { orgId: found.orgId, scopes: found.rec.scopes, allowedOrigins: found.rec.allowedOrigins, via: 'publishable', keyId: found.rec.id };
}
