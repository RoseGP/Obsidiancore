/**
 * Mount-level protection for the older routers.
 *
 * guard(publicPaths)  Every request needs a verified user (Firebase ID token, or the
 *                     dev header when SOCIAL_ACCOUNTS_DEV_AUTH=true outside production),
 *                     EXCEPT paths matching publicPaths: OAuth callbacks, signed webhooks,
 *                     the public booking page and the website chat widget, which are
 *                     called by outside services or anonymous visitors.
 *
 * After verification the caller's identity is written over any client-supplied
 * userId (body, query, req.user), so legacy handlers that read `req.body.userId`
 * or fall back to 'demo-user-123' only ever see the verified user.
 *
 * Endpoints whose path contains "/simulate" are disabled in production.
 */
import type { NextFunction, Request, Response } from 'express';
import { requireUser } from '../features/social-accounts/server/auth';

export function bindVerifiedUser(req: Request) {
  const id = (req as any).accountUser?.id as string | undefined;
  if (!id) return;
  (req as any).user = { ...((req as any).user || {}), id, uid: id };
  (req as any).userId = id;
  if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
    req.body.userId = id;
    for (const k of ['user_id', 'ownerId', 'createdById']) if (k in req.body) req.body[k] = id;
  }
  if (req.query && typeof req.query === 'object') for (const k of ['userId', 'user_id']) if (k in req.query) (req.query as any)[k] = id;
}

export function guard(publicPaths: RegExp[] = []) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (process.env.NODE_ENV === 'production' && /\/simulate/i.test(req.path)) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    if (req.method === 'OPTIONS' || publicPaths.some((re) => re.test(req.path))) return next();
    requireUser(req as any, res, (err?: unknown) => {
      if (err) return next(err);
      bindVerifiedUser(req);
      next();
    });
  };
}

/** Public paths per router (relative to its mount point). Keep these minimal. */
export const PUBLIC = {
  none: [] as RegExp[],
  // Public booking page (PublicSchedulingPage): read event types and book a slot.
  availability: [/^\/event-types$/, /^\/[A-Za-z0-9_-]+$/, /^\/book$/],
  salesIntel: [/^\/health$/],
  socialConnection: [/^\/callback$/, /^\/webhook$/],
  socialAuth: [/^\/(linkedin|facebook|twitter)\/callback$/],
  paymentIntegrations: [/^\/(stripe|square)\/callback$/],
  payments: [/^\/stripe\/callback$/],
  // Google push notifications: TO COMPLETE: validate X-Goog-Channel-Token in the handler.
  gcal: [/^\/oauth2callback$/, /^\/gcal$/],
  auth: [/^\/google\/callback$/, /^\/callback$/],
  // Website chat widget used by anonymous site visitors.
  messaging: [/^\/widgets\/[^/]+$/, /^\/visitor-init$/, /^\/visitor-message$/, /^\/visitor-messages\/[^/]+$/, /^\/embed(\/.*)?$/],
  // Provider webhooks (verify each provider's signature inside the handler).
  communication: [/^\/whatsapp-webhook$/, /^\/twilio-sms$/, /^\/incoming-call$/, /^\/twiml-(fallback|voicemail-saved)$/, /^\/twilio-video-token$/],
  postiz: [/^\/(webhook|callback)(\/.*)?$/],
  // Customer-facing proposal links. TO COMPLETE: require a signed share token in these handlers.
  proposals: [/^\/[A-Za-z0-9_-]+$/, /^\/[A-Za-z0-9_-]+\/(sign|render-pdf|stripe-checkout)$/],
};
