/**
 * The HTTP layer every API request passes through (wired in server.ts):
 *
 *   requestContext      request id (X-Request-Id: accepted if well-formed, otherwise generated), echoed back
 *   requestLogger       one log line per API request: method, route path (no query string), status, duration
 *   apiRateLimit        per-IP ceiling on /api (routers keep their own stricter limits)
 *   validateBody(zod)   400 invalid_input with the failing field, before the handler runs
 *   notFoundHandler     JSON 404 for unknown /api paths
 *   errorHandler        last: every thrown/forwarded error becomes a safe JSON response (see errors.ts)
 *   installAsyncErrorForwarding  Express 4 doesn't catch rejected promises from async handlers; this makes
 *                       route handlers forward them to errorHandler instead of leaving the request hanging.
 */
import crypto from 'crypto';
import { createRequire } from 'module';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import rateLimit from 'express-rate-limit';
import type { ZodType } from 'zod';
import { toErrorResponse } from './errors';
import { logger } from './logger';

declare module 'express-serve-static-core' {
  interface Request { id?: string; startedAt?: number }
}

const REQUEST_ID_RE = /^[A-Za-z0-9._:-]{8,128}$/;

export function requestContext(): RequestHandler {
  return (req, res, next) => {
    const incoming = req.get('x-request-id');
    req.id = incoming && REQUEST_ID_RE.test(incoming) ? incoming : crypto.randomUUID();
    req.startedAt = Date.now();
    res.setHeader('X-Request-Id', req.id);
    next();
  };
}

/** Logs API requests only (not static files), without query strings, bodies or headers. */
export function requestLogger(): RequestHandler {
  return (req, res, next) => {
    if (!req.originalUrl.startsWith('/api')) return next();
    res.on('finish', () => {
      const status = res.statusCode;
      const fields = {
        requestId: req.id, method: req.method, path: req.originalUrl.split('?')[0], status,
        ms: req.startedAt ? Date.now() - req.startedAt : undefined,
        user: (req as any).accountUser?.id, org: (req as any).tenant?.orgId,
      };
      if (status >= 500) logger.error('http.request', fields);
      else if (status >= 400) logger.warn('http.request', fields);
      else logger.info('http.request', fields);
    });
    next();
  };
}

/**
 * A generous per-IP ceiling for the whole API (API_RATE_LIMIT_PER_MINUTE, default 600). Provider webhooks
 * and the health check are excluded; sensitive routes (sign-in links, lead capture, AI) have stricter ones.
 */
export function apiRateLimit(opts: { perMinute?: number } = {}): RequestHandler {
  const limit = opts.perMinute ?? (Number(process.env.API_RATE_LIMIT_PER_MINUTE) || 600);
  return rateLimit({
    windowMs: 60_000, limit, standardHeaders: 'draft-7', legacyHeaders: false,
    skip: (req) => req.path === '/health' || req.path.startsWith('/webhooks') || req.path.startsWith('/v1/events'),
    handler: (req, res, _next, options) => {
      logger.warn('http.rate_limited', { requestId: req.id, path: req.originalUrl.split('?')[0], scope: 'api' });
      const retry = Math.ceil(options.windowMs / 1000);
      res.setHeader('Retry-After', String(retry));
      res.status(429).json({ success: false, code: 'rate_limited', error: 'Too many requests. Please wait a moment and try again.', retryAfter: retry, requestId: req.id });
    },
  });
}

type Part = 'body' | 'query' | 'params';
/** Validates and replaces req[part] with the parsed value. Errors go to errorHandler (400 invalid_input). */
export function validate<T>(schema: ZodType<T>, part: Part = 'body'): RequestHandler {
  return (req, _res, next) => {
    const r = schema.safeParse((req as any)[part]);
    if (!r.success) return next(r.error);
    if (part === 'query') Object.defineProperty(req, 'query', { value: r.data, writable: true, configurable: true });
    else (req as any)[part] = r.data;
    next();
  };
}
export const validateBody = <T>(schema: ZodType<T>) => validate(schema, 'body');

export function notFoundHandler(): RequestHandler {
  return (req, res) => { res.status(404).json({ success: false, code: 'not_found', error: 'No such API route.', requestId: req.id }); };
}

/** Last middleware. Safe body for the client; full detail (stack included) only in the server log. */
export function errorHandler() {
  return (err: unknown, req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) { logger.error('http.error_after_headers', { requestId: req.id, path: req.originalUrl.split('?')[0], error: err }); return next(err); }
    const r = toErrorResponse(err);
    if (r.unexpected) logger.error('http.unhandled_error', { requestId: req.id, method: req.method, path: req.originalUrl.split('?')[0], error: err });
    else if (r.status >= 500) logger.warn('http.service_error', { requestId: req.id, path: req.originalUrl.split('?')[0], code: r.body.code });
    for (const [k, v] of Object.entries(r.headers ?? {})) res.setHeader(k, v);
    res.status(r.status).json({ ...r.body, requestId: req.id });
  };
}

let asyncPatched = false;
/**
 * Route handlers (router.get/post/… and app.get/post/…) that return a rejected promise now call next(err).
 * Error-handling functions (4 parameters) and router.use() middleware are left untouched. Idempotent.
 */
export function installAsyncErrorForwarding() {
  if (asyncPatched) return;
  asyncPatched = true;
  // The production server is bundled to CommonJS (esbuild), where `require` exists; under tsx (ESM) it doesn't.
  const load: NodeRequire = typeof require === 'function' ? require : createRequire(import.meta.url);
  const Route = load('express/lib/router/route.js');
  const methods: string[] = load('methods');
  const wrap = (fn: unknown) => {
    if (typeof fn !== 'function' || fn.length > 3) return fn;
    const handler = fn as (req: Request, res: Response, next: NextFunction) => unknown;
    const wrapped = function (this: unknown, req: Request, res: Response, next: NextFunction) {
      try {
        const out = handler.call(this, req, res, next) as any;
        if (out && typeof out.then === 'function') out.then(undefined, (e: unknown) => next(e ?? new Error('Rejected without a reason')));
      } catch (e) { next(e); }
    };
    Object.defineProperty(wrapped, 'name', { value: handler.name || 'asyncHandler' });
    return wrapped;
  };
  for (const m of [...methods, 'all']) {
    const original = Route.prototype[m];
    if (typeof original !== 'function') continue;
    Route.prototype[m] = function (this: unknown, ...handlers: unknown[]) {
      return original.apply(this, handlers.flat(Infinity).map(wrap));
    };
  }
}

/** Wraps one async handler so a rejection goes to next(err), independent of installAsyncErrorForwarding. */
export const asyncHandler = <T extends (req: Request, res: Response, next: NextFunction) => Promise<unknown>>(fn: T): RequestHandler =>
  (req, res, next) => { fn(req, res, next).catch(next); };

/** Process-level safety net: log (never crash silently on) stray rejections. */
export function installProcessErrorLogging() {
  process.on('unhandledRejection', (reason) => logger.error('process.unhandled_rejection', { error: reason }));
}
