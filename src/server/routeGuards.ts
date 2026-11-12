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
 * Endpoints whose path contains "/simulate" are disabled unless NODE_ENV is explicitly development/test.
 */
import type { NextFunction, Request, Response } from 'express';
import { requireUser } from '../features/social-accounts/server/auth';
import { isExplicitDevOrTest } from './runtimeEnv';

export function bindVerifiedUser(req: Request) {
  const id = (req as any).accountUser?.id as string | undefined;
  if (!id) return;
  (req as any).user = { ...((req as any).user || {}), id, uid: id };
  (req as any).userId = id;
  if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
    req.body.userId = id;
    // Actor fields are always the verified user. `ownerId` (who a CRM record is assigned to) is NOT rewritten:
    // the CRM routes that accept it check it is a member of the organization (assignableOwner). Rewriting it
    // made every assignment silently point at the caller while keeping the chosen person's name.
    for (const k of ['user_id', 'createdById']) if (k in req.body) req.body[k] = id;
  }
  if (req.query && typeof req.query === 'object') for (const k of ['userId', 'user_id']) if (k in req.query) (req.query as any)[k] = id;
}

export function guard(publicPaths: RegExp[] = []) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!isExplicitDevOrTest() && /\/simulate/i.test(req.path)) {
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
  // Passwordless sign-in links: asking for a link and redeeming one happen before sign-in (rate limited, single-use tokens).
  magicLink: [/^\/(status|request|verify)$/],
  // Website form submissions from customers' websites (form id checked, rate limited, validated in the handler).
  webForms: [/^\/f\/[^/]+$/],
  // Public booking page (PublicSchedulingPage): read event types and book a slot.
  availability: [/^\/event-types$/, /^\/[A-Za-z0-9_-]+$/, /^\/book$/],
  salesIntel: [/^\/health$/],
  // Website lead form (anonymous visitors). Rate limited in the handler; tenant mapping comes in Phase 1.
  leads: [/^\/capture$/],
  paymentIntegrations: [/^\/(stripe|square)\/callback$/],
  payments: [/^\/stripe\/callback$/],
  // Google OAuth return (single-use state) and push notifications (per-channel X-Goog-Channel-Token, checked in the handler).
  gcal: [/^\/oauth2callback$/, /^\/webhook$/],
  // Website chat widget used by anonymous site visitors.
  messaging: [/^\/widgets\/[^/]+$/, /^\/visitor-init$/, /^\/visitor-message$/, /^\/visitor-messages\/[^/]+$/, /^\/embed(\/.*)?$/],
  // Provider webhooks (verify each provider's signature inside the handler).
  communication: [/^\/whatsapp-webhook$/, /^\/twilio-sms$/, /^\/incoming-call$/, /^\/twiml-(fallback|voicemail-saved)$/],
  // Social account and Google Business Profile OAuth redirects (state is checked in the handler).
  accounts: [/^\/callback$/, /^\/return\/[^/]+$/],
  localSeo: [/^\/callback$/],
  // Twilio voice webhooks (signature verified by twilioHook in the handler) and the caller OTP check.
  voice: [/^\/(inbound|menu|support|queue-wait|dial-status|status)$/, /^\/otp\/verify$/],
  // Stripe and Square webhooks (signature verified in each handler).
  paymentWebhooks: [/^\/(stripe|square)$/],
  // GREET guest invitation links (signed, expiring tokens checked in the handler) and LiveKit's signed webhook.
  greet: [/^\/invite\/[A-Za-z0-9_.-]{20,600}(\/(join|session|media-token|recording-consent|leave))?$/, /^\/livekit-webhook$/],
  // Customer-facing proposal links: only /share/<token>/… (the token is checked against its stored hash).
  proposals: [/^\/share\/[A-Za-z0-9_-]{20,64}(\/(items\/[A-Za-z0-9_-]+|accept|decline|checkout|document))?$/],
};
