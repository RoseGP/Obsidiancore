import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import Stripe from 'stripe';
import * as paymentDb from '../services/payment/paymentDb';
import { optionalSecret } from '../utils/secrets';
import { unsignedWebhooksAllowed } from '../server/runtimeEnv';
import { settleProviderInvoice } from '../services/payment/settlement';
import { applyStripeInvoice, type SyncExtras } from '../services/payment/stripeInvoiceSync';
import { markBillingInvoiceSentByProvider } from '../features/invoicing/server/providerPayments';

/** Constant-time comparison of two signature strings. */
function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

const router = Router();

/**
 * -------------------------------------------------------------
 * 1. STRIPE WEBHOOKS
 * POST /api/webhooks/stripe
 * -------------------------------------------------------------
 */
router.post('/stripe', async (req: Request, res: Response) => {
  const sig = req.headers['stripe-signature'] as string;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event: any;

  // Never accept unsigned webhooks in production (forged payment events): STRIPE_WEBHOOK_SECRET is required.
  // Unsigned events are accepted only in explicit development/test mode with ALLOW_UNSIGNED_WEBHOOKS=true.
  if ((!webhookSecret || !sig) && !unsignedWebhooksAllowed()) {
    console.error('[Stripe Webhook] Rejected: ' + (!webhookSecret ? 'STRIPE_WEBHOOK_SECRET is not configured.' : 'missing Stripe-Signature header.'));
    return res.status(400).json({ error: 'Webhook signature verification is required.' });
  }

  if (webhookSecret && sig) {
    try {
      const stripe = new Stripe(optionalSecret('STRIPE_SECRET_KEY') || 'sk_not_configured', {
        apiVersion: '2023-10-16' as any
      });
      // Verify raw body with signature
      const rawBody = (req as any).rawBody || JSON.stringify(req.body);
      event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
    } catch (err: any) {
      console.error('[Stripe Webhook] Signature verification failed:', err?.type || 'error');
      return res.status(400).json({ error: 'Webhook signature verification failed.' });
    }
  } else {
    // In sandbox test environments without active webhook signing secret
    event = req.body;
  }

  if (!event || !event.id) {
    return res.status(400).json({ error: 'Invalid webhook payload structure' });
  }

  // Idempotency: claim the event id atomically (persisted, so replays after a restart are ignored too).
  if (!(await paymentDb.claimWebhookEvent('stripe', String(event.id)))) {
    return res.status(200).json({ received: true, duplicate: true });
  }

  console.log(`[Stripe Webhook] Processing event: ${event.type} (${event.id})`);

  try {
    const result = await handleStripeEvent(event);
    return res.status(200).json({ received: true, eventId: event.id, ...(result ? { result } : {}) });
  } catch (err: any) {
    console.error('[Stripe Webhook] Event processing error:', err?.code || err?.name || 'error');
    await paymentDb.releaseWebhookEvent('stripe', String(event.id)).catch(() => undefined); // let Stripe retry
    return res.status(500).json({ error: 'Webhook processing encountered an error' });
  }
});

const INVOICE_EVENTS = new Set([
  'invoice.finalized', 'invoice.sent', 'invoice.updated', 'invoice.paid', 'invoice.payment_succeeded',
  'invoice.payment_failed', 'invoice.payment_action_required', 'invoice.voided', 'invoice.marked_uncollectible', 'invoice.deleted',
]);

/**
 * Applies one verified, not-yet-processed Stripe event. Invoice events change only the organization that owns
 * the invoice AND whose connected account sent the event (Connect events carry `account`). Status changes go
 * through applyStripeInvoice (forward-only, settlement on paid).
 */
export async function handleStripeEvent(event: any): Promise<string | null> {
  const at = typeof event.created === 'number' ? new Date(event.created * 1000).toISOString() : new Date().toISOString();

  if (event.type === 'account.application.deauthorized') {
    const acct = typeof event.account === 'string' ? event.account : '';
    if (acct) await paymentDb.disconnectAccountByProviderAccountId('stripe', acct);
    console.log('[Stripe Webhook] A connected account deauthorized the platform.');
    return 'disconnected';
  }
  if (!INVOICE_EVENTS.has(event.type)) {
    console.log(`[Stripe Webhook] Unhandled event type: ${event.type}`);
    return null;
  }

  const si = event.data?.object;
  if (!si?.id || typeof si.id !== 'string') return 'ignored';
  const local = await paymentDb.getInvoiceByProviderInvoiceId('stripe', si.id);
  if (!local) return 'unknown_invoice';

  // The event must come from the connected account that owns this invoice's organization.
  const acct = typeof event.account === 'string' ? event.account : '';
  const owner = acct ? await paymentDb.orgForProviderAccount('stripe', acct) : null;
  if ((local.provider_account_id && acct !== local.provider_account_id) || (acct && owner !== local.user_id)) {
    console.warn(`[Stripe Webhook] ${event.type} for an invoice of another account was ignored.`);
    return 'account_mismatch';
  }

  if (event.type === 'invoice.deleted') {
    await paymentDb.patchInvoice(local.user_id, local.id, (cur) => (cur.status === 'draft' ? { status: 'void', voided_at: at, last_event_at: at } : null));
    return 'deleted';
  }

  const extras: SyncExtras = { at, fromWebhook: true };
  if (event.type === 'invoice.payment_failed') {
    extras.failure = { message: 'A payment attempt failed. The customer can try again from the invoice link; Stripe may also retry.', code: si.last_finalization_error?.code || 'payment_failed' };
  }
  if (event.type === 'invoice.payment_action_required') extras.actionRequired = true;
  if (event.type === 'invoice.sent') extras.sent = true;

  // The event type is authoritative for the state it announces (the object normally carries the same status).
  const IMPLIED: Record<string, string> = { 'invoice.paid': 'paid', 'invoice.payment_succeeded': 'paid', 'invoice.voided': 'void', 'invoice.marked_uncollectible': 'uncollectible', 'invoice.finalized': 'open', 'invoice.sent': 'open' };
  const object = IMPLIED[event.type] && !si.status ? { ...si, status: IMPLIED[event.type] } : si;
  const updated = await applyStripeInvoice(local, object, extras);
  // Sent from the Stripe dashboard: the CRM invoice it collects counts as sent too.
  if (event.type === 'invoice.sent' && updated.billing_invoice_id) {
    await markBillingInvoiceSentByProvider(updated.user_id, updated.billing_invoice_id, { provider: 'stripe', providerReference: si.id, actorName: 'Stripe' });
  }
  console.log(`[Stripe Webhook] ${event.type}: invoice ${local.id} is ${updated.status}.`);
  return updated.status;
}

/**
 * -------------------------------------------------------------
 * 2. SQUARE WEBHOOKS
 * POST /api/webhooks/square
 * -------------------------------------------------------------
 */
router.post('/square', async (req: Request, res: Response) => {
  const signature = req.headers['x-square-hmacsha256-signature'] as string;
  const signatureKey = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
  // Must equal the notification URL registered on the Square webhook subscription (Square signs it).
  const notificationUrl = process.env.SQUARE_WEBHOOK_NOTIFICATION_URL
    || (process.env.APP_URL ? `${process.env.APP_URL.replace(/\/+$/, '')}/api/webhooks/square` : '');

  if (!signatureKey || !signature || !notificationUrl) {
    if (!unsignedWebhooksAllowed()) {
      console.error('[Square Webhook] Rejected: ' + (!signatureKey ? 'SQUARE_WEBHOOK_SIGNATURE_KEY is not configured.' : !signature ? 'missing signature header.' : 'APP_URL / SQUARE_WEBHOOK_NOTIFICATION_URL is not configured.'));
      return res.status(400).json({ error: 'Webhook signature verification is required.' });
    }
  } else {
    const rawBody: string | undefined = (req as any).rawBody;
    if (typeof rawBody !== 'string') return res.status(400).json({ error: 'Invalid Square webhook payload' });
    const expectedSignature = crypto.createHmac('sha256', signatureKey).update(notificationUrl + rawBody).digest('base64');
    if (!safeEqual(signature, expectedSignature)) {
      console.error('[Square Webhook] Signature mismatch.');
      return res.status(400).json({ error: 'Invalid Square webhook signature' });
    }
  }

  const payload = req.body;
  const eventId = payload.event_id || payload.id;
  const eventType = payload.type || payload.event_type;

  if (!eventId) {
    return res.status(400).json({ error: 'Missing Square event_id' });
  }

  // Idempotency: claim the event id atomically (persisted).
  if (!(await paymentDb.claimWebhookEvent('square', String(eventId)))) {
    return res.status(200).json({ received: true, duplicate: true });
  }

  console.log(`[Square Webhook] Processing event: ${eventType} (${eventId})`);

  try {
    switch (eventType) {
      case 'invoice.payment_made':
      case 'invoice.status_changed': {
        const sqInvoice = payload.data?.object?.invoice;
        if (sqInvoice?.id) {
          const localInvoice = await paymentDb.getInvoiceByProviderInvoiceId('square', sqInvoice.id);
          if (localInvoice) {
            if (sqInvoice.status === 'PAID') {
              await settleProviderInvoice('square', localInvoice);
              console.log(`[Square Webhook] Marked invoice ${localInvoice.id} as PAID.`);
            } else if (sqInvoice.status === 'CANCELED') {
              await paymentDb.updateInvoiceStatus(localInvoice.user_id, localInvoice.id, 'void');
              console.log(`[Square Webhook] Marked invoice ${localInvoice.id} as VOID.`);
            }
          }
        }
        break;
      }

      case 'invoice.scheduled_charge_failed': {
        const sqInvoice = payload.data?.object?.invoice;
        console.warn(`[Square Webhook] Scheduled charge failed on invoice ${sqInvoice?.id}`);
        break;
      }

      case 'invoice.canceled': {
        const sqInvoice = payload.data?.object?.invoice;
        if (sqInvoice?.id) {
          const localInvoice = await paymentDb.getInvoiceByProviderInvoiceId('square', sqInvoice.id);
          if (localInvoice) {
            await paymentDb.updateInvoiceStatus(localInvoice.user_id, localInvoice.id, 'void');
            console.log(`[Square Webhook] Marked invoice ${localInvoice.id} as VOID.`);
          }
        }
        break;
      }

      case 'oauth.revoked': {
        const merchantId = payload.merchant_id;
        if (merchantId) {
          await paymentDb.disconnectAccountByProviderAccountId('square', merchantId);
        }
        console.log(`[Square Webhook] Merchant ${merchantId} revoked application OAuth access.`);
        break;
      }

      default:
        console.log(`[Square Webhook] Unhandled event: ${eventType}`);
    }

    return res.status(200).json({ received: true, eventId });
  } catch (err: any) {
    console.error('[Square Webhook] Error processing event:', err?.code || err?.name || 'error');
    await paymentDb.releaseWebhookEvent('square', String(eventId)).catch(() => undefined);
    return res.status(500).json({ error: 'Square webhook error' });
  }
});

export default router;
