/**
 * Public Stripe Connect endpoints for billing — /api/billing-stripe
 * Called by Stripe or by the browser returning from Stripe, so there is no CRM
 * session here: the OAuth callback trusts only the signed, single-use state,
 * and the webhook trusts only a valid Stripe signature.
 */
import { Router, type Request, type Response } from 'express';
import * as stripeConnect from '../features/invoicing/server/stripeConnect';

const router = Router();
const origin = (req: Request) => `${req.headers['x-forwarded-proto'] || req.protocol}://${req.get('host')}`;

router.get('/oauth/callback', async (req: Request, res: Response) => {
  const { code, state, error, error_description } = req.query as Record<string, string | undefined>;
  if (error) {
    const reason = error === 'access_denied' ? 'denied' : 'error';
    console.warn('[billing-stripe] OAuth returned an error:', error, error_description);
    return res.redirect(stripeConnect.appReturnUrl(origin(req), reason));
  }
  try {
    await stripeConnect.completeOAuth(String(code || ''), String(state || ''));
    res.redirect(stripeConnect.appReturnUrl(origin(req), 'connected'));
  } catch (err: any) {
    console.warn('[billing-stripe] OAuth callback failed:', err?.message);
    const reason = err?.code === 'conflict' ? 'in-use' : err?.code === 'validation' ? 'expired' : 'error';
    res.redirect(stripeConnect.appReturnUrl(origin(req), reason));
  }
});

router.post('/webhook', async (req: Request, res: Response) => {
  try {
    const raw = (req as any).rawBody ?? (Buffer.isBuffer(req.body) ? req.body : JSON.stringify(req.body ?? {}));
    const event = stripeConnect.constructEvent(raw, req.header('stripe-signature'));
    const out = await stripeConnect.handleEvent(event);
    res.status(out.status).json({ received: true, handled: out.handled, ...(out.reason ? { reason: out.reason } : {}) });
  } catch (err: any) {
    const status = err instanceof stripeConnect.StripeConnectError ? err.status : 500;
    if (status >= 500) console.error('[billing-stripe] webhook error:', err);
    res.status(status).json({ received: false, error: err?.message ?? 'Webhook failed' });
  }
});

export default router;
