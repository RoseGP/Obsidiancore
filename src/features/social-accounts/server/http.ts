/**
 * HTTP hardening shared by /api/accounts, /api/posts and /api/analytics:
 * log redaction, rate limiting, CSRF (origin) checks and safe error responses.
 */
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { AccountsError } from './service';

// ---------- Redaction ----------

const PATTERNS: [RegExp, string][] = [
  [/\bpos_[A-Za-z0-9_-]+/g, 'pos_[REDACTED]'],
  [/\bya29\.[A-Za-z0-9._-]+/g, 'ya29.[REDACTED]'],
  [/\b1\/\/[A-Za-z0-9._-]+/g, '1//[REDACTED]'],
  [/("(?:refresh_token|id_token|code_verifier)"\s*:\s*")[^"]*"/gi, '$1[REDACTED]"'],
  [/\bpc[as]_[A-Za-z0-9_-]+/g, 'pc*_[REDACTED]'],
  [/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[REDACTED]'],
  [/([?&](?:code|state|access_token|token|client_secret)=)[^&\s"]+/gi, '$1[REDACTED]'],
  [/("(?:access_token|client_secret|code|state|token|appPassword|password|apiKey|authorization)"\s*:\s*")[^"]*"/gi, '$1[REDACTED]"'],
  [/\b[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}\b/gi, '[REDACTED-APP-PASSWORD]'],
];

export function redact(value: unknown): string {
  let s = typeof value === 'string' ? value : value instanceof Error ? `${value.name}: ${value.message}` : (() => { try { return JSON.stringify(value); } catch { return String(value); } })();
  for (const [re, rep] of PATTERNS) s = s.replace(re, rep);
  return s.length > 2000 ? `${s.slice(0, 2000)}…` : s;
}

export const log = {
  info: (msg: string, meta?: unknown) => console.log(`[accounts] ${msg}${meta === undefined ? '' : ` ${redact(meta)}`}`),
  warn: (msg: string, meta?: unknown) => console.warn(`[accounts] ${msg}${meta === undefined ? '' : ` ${redact(meta)}`}`),
  error: (msg: string, meta?: unknown) => console.error(`[accounts] ${msg}${meta === undefined ? '' : ` ${redact(meta)}`}`),
};

// ---------- Rate limiting (in-memory, per instance) ----------

export function rateLimit(opts: { name: string; windowMs: number; max: number; key: (req: Request) => string }) {
  const hits = new Map<string, { count: number; reset: number }>();
  setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (v.reset < now) hits.delete(k); }, opts.windowMs).unref?.();
  return (req: Request, res: Response, next: NextFunction) => {
    const k = `${opts.name}:${opts.key(req)}`;
    const now = Date.now();
    const h = hits.get(k);
    if (!h || h.reset < now) { hits.set(k, { count: 1, reset: now + opts.windowMs }); return next(); }
    if (++h.count > opts.max) {
      res.setHeader('Retry-After', String(Math.ceil((h.reset - now) / 1000)));
      res.status(429).json({ code: 'rate_limited', error: 'Too many requests. Wait a moment and try again.' });
      return;
    }
    next();
  };
}

export const userKey = (req: Request) => (req as any).accountUser?.id || req.ip || 'anon';
export const ipKey = (req: Request) => req.ip || 'anon';

// ---------- CSRF ----------

/**
 * State-changing requests must come from this app's origin. Auth uses an
 * Authorization header (never sent automatically by browsers), and this check
 * adds defence in depth for any cookie that might be present.
 */
export function csrfGuard(appUrl: string) {
  const allowed = new Set<string>();
  try { if (appUrl) allowed.add(new URL(appUrl).origin); } catch { /* ignore */ }
  return (req: Request, res: Response, next: NextFunction) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.get('origin') || (() => { try { return new URL(req.get('referer') || '').origin; } catch { return ''; } })();
    const selfOrigin = `${req.protocol}://${req.get('host')}`;
    if (!origin || (origin !== selfOrigin && !allowed.has(origin))) {
      res.status(403).json({ code: 'csrf', error: 'This request didn’t come from the app.' });
      return;
    }
    const hasBody = Number(req.get('content-length') || 0) > 0;
    if (hasBody && !req.is('application/json')) {
      res.status(415).json({ code: 'unsupported_media_type', error: 'Send JSON.' });
      return;
    }
    next();
  };
}

// ---------- Errors ----------

export function sendError(res: Response, err: unknown, context: string) {
  if (err instanceof AccountsError) {
    if (err.status >= 500) log.warn(`${context}: ${err.code}`, err.message);
    return res.status(err.status).json({ code: err.code, error: err.message, field: err.field });
  }
  if (err instanceof z.ZodError) {
    const first = err.issues[0];
    return res.status(400).json({ code: 'invalid_input', error: first?.message || 'Invalid request.', field: first?.path?.join('.') || undefined });
  }
  log.error(`${context} failed`, err);
  return res.status(500).json({ code: 'server', error: 'Something went wrong. Try again.' });
}
