/**
 * Master API key middleware for Express (used by the Firebase HTTPS function in api.ts).
 *
 * - Key from `x-api-key` or `Authorization: Bearer <key>`.
 * - Constant-time comparison of SHA-256 digests (crypto.timingSafeEqual), against every configured key.
 * - Fails closed with 503 if no key is configured; 401 { error: { code, message } } when missing/invalid.
 * - Never logs the key.
 */
import * as crypto from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

export type ApiErrorCode = 'missing_api_key' | 'invalid_api_key' | 'server_misconfigured';
export interface ApiErrorBody { error: { code: ApiErrorCode | string; message: string } }

const digest = (s: string) => crypto.createHash('sha256').update(s, 'utf8').digest();

/** Constant-time: digests have equal length, so timingSafeEqual never throws or leaks the length. */
export function safeEqual(a: string, b: string): boolean {
  return crypto.timingSafeEqual(digest(a), digest(b));
}

export function extractApiKey(req: Pick<Request, 'get'>): string | null {
  const header = req.get('x-api-key');
  if (header && header.trim()) return header.trim();
  const m = /^Bearer\s+(\S+)\s*$/i.exec(req.get('authorization') || '');
  return m ? m[1] : null;
}

function send(res: Response, status: number, code: ApiErrorCode, message: string) {
  res.set('Cache-Control', 'no-store');
  if (status === 401) res.set('WWW-Authenticate', 'Bearer realm="api"');
  res.status(status).json({ error: { code, message } } satisfies ApiErrorBody);
}

/**
 * @param getKeys returns the accepted keys at request time (current first, then a previous one during rotation).
 *                With Firebase secrets, call `.value()` inside it: secrets are only available at runtime.
 */
export function requireApiKey(getKeys: () => Array<string | undefined>): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const keys = getKeys().map((k) => (k || '').trim()).filter(Boolean);
    if (!keys.length) {
      console.error('[auth] MASTER_API_KEY is not configured; refusing all requests.');
      return send(res, 503, 'server_misconfigured', 'The API is not configured yet.');
    }
    const provided = extractApiKey(req);
    if (!provided) return send(res, 401, 'missing_api_key', 'Send your API key in the x-api-key header or as Authorization: Bearer <key>.');
    if (provided.length > 512) return send(res, 401, 'invalid_api_key', 'The API key is invalid.');
    let ok = false;
    for (const k of keys) ok = safeEqual(provided, k) || ok; // no early exit: timing doesn't reveal which key matched
    if (!ok) return send(res, 401, 'invalid_api_key', 'The API key is invalid.');
    next();
  };
}
