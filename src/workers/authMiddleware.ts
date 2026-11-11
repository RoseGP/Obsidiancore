/**
 * Master API key authentication for Cloudflare Workers (no dependencies).
 *
 *   export default { fetch: withApiKey(async (request, env, ctx) => new Response('ok')) };
 *
 * - Key from `x-api-key: <key>` or `Authorization: Bearer <key>`.
 * - Compared in constant time on SHA-256 digests (no length or prefix leaks), using Cloudflare's
 *   crypto.subtle.timingSafeEqual when available.
 * - Secrets: MASTER_API_KEY (wrangler secret), plus MASTER_API_KEY_PREVIOUS during a rotation.
 *   API_KEY is still read for older deployments.
 * - Fails closed: if no key is configured, every request gets 503 (and the reason is logged, never the key).
 * - 401 body: { error: { code: "missing_api_key" | "invalid_api_key", message } } with WWW-Authenticate.
 * - CORS: none by default (server-to-server). Set ALLOWED_ORIGINS="https://a.com,https://b.com" to allow browsers,
 *   but remember a key used from a browser is visible to anyone who opens dev tools.
 */

export interface AuthEnv {
  MASTER_API_KEY?: string;
  MASTER_API_KEY_PREVIOUS?: string;
  /** Legacy name, still accepted. */
  API_KEY?: string;
  ALLOWED_ORIGINS?: string;
}

export type ApiErrorCode = 'missing_api_key' | 'invalid_api_key' | 'server_misconfigured';

const encoder = new TextEncoder();

async function sha256(s: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(s)));
}

/** Constant-time equality of two strings (compares fixed-length digests). */
export async function timingSafeEqualStrings(a: string, b: string): Promise<boolean> {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const [x, y] = await Promise.all([sha256(a), sha256(b)]);
  const subtle = crypto.subtle as SubtleCrypto & { timingSafeEqual?: (a: ArrayBufferView, b: ArrayBufferView) => boolean };
  if (typeof subtle.timingSafeEqual === 'function') return subtle.timingSafeEqual(x, y);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

/** `x-api-key` first, then `Authorization: Bearer`. Returns null when neither is present. */
export function extractAuthToken(request: Request): string | null {
  const header = request.headers.get('x-api-key');
  if (header && header.trim()) return header.trim();
  const m = /^Bearer\s+(\S+)\s*$/i.exec(request.headers.get('authorization') || '');
  return m ? m[1] : null;
}

function corsHeaders(request: Request, env: AuthEnv): Record<string, string> {
  const origin = request.headers.get('origin');
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean);
  if (!origin || !allowed.includes(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

export function jsonError(status: number, code: ApiErrorCode, message: string, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
  });
}

/**
 * Returns null when the request is authorized, otherwise the error Response to send.
 * OPTIONS preflights pass only for allowed origins (they carry no credentials by design).
 */
export async function validateApiAuth(request: Request, env: AuthEnv): Promise<Response | null> {
  const cors = corsHeaders(request, env);
  if (request.method === 'OPTIONS') return new Response(null, { status: cors['Access-Control-Allow-Origin'] ? 204 : 403, headers: cors });

  const keys = [env.MASTER_API_KEY, env.MASTER_API_KEY_PREVIOUS, env.API_KEY].map((k) => (k || '').trim()).filter(Boolean);
  if (!keys.length) {
    console.error('[auth] MASTER_API_KEY is not set: run `wrangler secret put MASTER_API_KEY`. Refusing all requests.');
    return jsonError(503, 'server_misconfigured', 'The API is not configured yet.', cors);
  }
  const provided = extractAuthToken(request);
  const challenge = { 'WWW-Authenticate': 'Bearer realm="api"', ...cors };
  if (!provided) return jsonError(401, 'missing_api_key', 'Send your API key in the x-api-key header or as Authorization: Bearer <key>.', challenge);
  if (provided.length > 512) return jsonError(401, 'invalid_api_key', 'The API key is invalid.', challenge);

  // Check every configured key (no early exit), so timing doesn't reveal which one matched.
  let ok = false;
  for (const k of keys) ok = (await timingSafeEqualStrings(provided, k)) || ok;
  return ok ? null : jsonError(401, 'invalid_api_key', 'The API key is invalid.', challenge);
}

/** Minimal shape of the Workers ExecutionContext (avoids requiring @cloudflare/workers-types). */
export interface WorkerContext { waitUntil(p: Promise<unknown>): void; passThroughOnException(): void }
type Handler<E> = (request: Request, env: E, ctx: WorkerContext) => Response | Promise<Response>;

/** Wraps a Worker fetch handler: rejects unauthorized requests, adds CORS headers for allowed origins. */
export function withApiKey<E extends AuthEnv>(handler: Handler<E>): Handler<E> {
  return async (request, env, ctx) => {
    const denied = await validateApiAuth(request, env);
    if (denied) return denied;
    const res = await handler(request, env, ctx);
    const cors = corsHeaders(request, env);
    if (!Object.keys(cors).length) return res;
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
    return out;
  };
}
