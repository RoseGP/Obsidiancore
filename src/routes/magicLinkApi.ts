/**
 * /api/auth/magic-link: passwordless sign-in (see src/server/auth/magicLink.ts for the security design).
 *
 *   GET  /status    { enabled, reason? }  whether this server can send sign-in links (no account data)
 *   POST /request   { email }  → 202 with the same message for every valid address (429 per IP when abused)
 *   POST /verify    { token }  → { customToken } once; 400 invalid_or_expired_link otherwise
 *
 * Public by design (mounted with guard(PUBLIC.magicLink)): these run before the person is signed in.
 */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { magicLinkStatus, requestMagicLink, verifyMagicLink } from '../server/auth/magicLink';
import { asyncHandler, validateBody } from '../server/http/middleware';
import { recordAuthFailure } from '../server/security/loginMonitor';

const router = Router();

const limited = (name: string, limit: number) => rateLimit({
  windowMs: 15 * 60_000, limit, standardHeaders: 'draft-7', legacyHeaders: false,
  handler: (req, res, _next, options) => {
    const retry = Math.ceil(options.windowMs / 1000);
    res.setHeader('Retry-After', String(retry));
    res.status(429).json({ success: false, code: 'rate_limited', error: name === 'request' ? 'Too many sign-in link requests from this network. Try again in a few minutes.' : 'Too many attempts. Try again in a few minutes.', retryAfter: retry, requestId: req.id });
  },
});
const requestLimiter = limited('request', Number(process.env.MAGIC_LINK_IP_LIMIT) || 10);
const verifyLimiter = limited('verify', 30);

router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

router.get('/status', (_req, res) => {
  const s = magicLinkStatus();
  res.json({ success: true, enabled: s.enabled, ...(s.reason ? { reason: s.reason } : {}) });
});

router.post('/request', requestLimiter, validateBody(z.object({ email: z.string().max(320) })), asyncHandler(async (req, res) => {
  const { message, delivery } = await requestMagicLink(req.body.email);
  // Not awaited: the response time must not depend on whether an email is actually sent.
  delivery.catch(() => undefined);
  res.status(202).json({ success: true, message });
}));

router.post('/verify', verifyLimiter, validateBody(z.object({ token: z.string().max(200) })), asyncHandler(async (req, res) => {
  try {
    res.json({ success: true, ...(await verifyMagicLink(req.body.token)) });
  } catch (e) {
    if ((e as { code?: string })?.code === 'invalid_or_expired_link') recordAuthFailure(req.ip || 'unknown');
    throw e;
  }
}));

export default router;
