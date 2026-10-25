import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import Stripe from 'stripe';
import * as paymentDb from '../services/payment/paymentDb';
import { optionalSecret } from '../utils/secrets';

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

  // Never accept unsigned webhooks in production (forged payment events). TO COMPLETE: set STRIPE_WEBHOOK_SECRET.

  if (process.env.NODE_ENV === 'production' && (!webhookSecret || !sig)) {

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
      console.error('[Stripe Webhook] Signature verification failed:', err.message);
      return res.status(400).json({ error: `Webhook Error: ${err.message}` });
    }
  } else {
    // In sandbox test environments without active webhook signing secret
    event = req.body;
  }

  if (!event || !event.id) {
    return res.status(400).json({ error: 'Invalid webhook payload structure' });
  }

  // Idempotency check: has this event already been processed?
  const alreadyProcessed = await paymentDb.isWebhookEventProcessed('stripe', event.id);
  if (alreadyProcessed) {
    console.log(`[Stripe Webhook] Event ${event.id} already processed. Skipping duplicate.`);
    return res.status(200).json({ received: true, duplicate: true });
  }

  await paymentDb.markWebhookEventProcessed('stripe', event.id);

  console.log(`[Stripe Webhook] Processing event: ${event.type} (${event.id})`);

  try {
    switch (event.type) {
      case 'invoice.paid': {
        const stripeInvoice = event.data.object;
        const localInvoice = await paymentDb.getInvoiceByProviderInvoiceId('stripe', stripeInvoice.id);
        if (localInvoice) {
          await paymentDb.updateInvoiceStatus(localInvoice.id, 'paid', {
            hosted_invoice_url: stripeInvoice.hosted_invoice_url || localInvoice.hosted_invoice_url
          });
          console.log(`[Stripe Webhook] Marked invoice ${localInvoice.id} as PAID.`);
        }
        break;
      }

      case 'invoice.payment_failed': {
        const stripeInvoice = event.data.object;
        const localInvoice = await paymentDb.getInvoiceByProviderInvoiceId('stripe', stripeInvoice.id);
        if (localInvoice) {
          await paymentDb.updateInvoiceStatus(localInvoice.id, 'open');
          console.log(`[Stripe Webhook] Invoice ${localInvoice.id} payment failed.`);
        }
        break;
      }

      case 'invoice.voided': {
        const stripeInvoice = event.data.object;
        const localInvoice = await paymentDb.getInvoiceByProviderInvoiceId('stripe', stripeInvoice.id);
        if (localInvoice) {
          await paymentDb.updateInvoiceStatus(localInvoice.id, 'void');
          console.log(`[Stripe Webhook] Marked invoice ${localInvoice.id} as VOID.`);
        }
        break;
      }

      case 'account.application.deauthorized': {
        const deauthAccount = event.account;
        if (deauthAccount) {
          await paymentDb.disconnectAccountByProviderAccountId('stripe', deauthAccount);
        }
        console.log(`[Stripe Webhook] Account ${deauthAccount} deauthorized by seller.`);
        break;
      }

      default:
        console.log(`[Stripe Webhook] Unhandled event type: ${event.type}`);
    }

    return res.status(200).json({ received: true, eventId: event.id });
  } catch (err: any) {
    console.error('[Stripe Webhook] Event processing error:', err.message);
    return res.status(500).json({ error: 'Webhook processing encountered an error' });
  }
});

/**
 * -------------------------------------------------------------
 * 2. SQUARE WEBHOOKS
 * POST /api/webhooks/square
 * -------------------------------------------------------------
 */
router.post('/square', async (req: Request, res: Response) => {
  const signature = req.headers['x-square-hmacsha256-signature'] as string;
  const signatureKey = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
  const notificationUrl = (process.env.APP_URL || `${req.protocol}://${req.get('host')}`) + '/api/webhooks/square';

  if (signatureKey && signature) {
    try {
      const rawBody = (req as any).rawBody || JSON.stringify(req.body);
      const combined = notificationUrl + rawBody;
      const expectedSignature = crypto
        .createHmac('sha256', signatureKey)
        .update(combined)
        .digest('base64');

      if (signature !== expectedSignature) {
        console.error('[Square Webhook] Signature mismatch.');
        return res.status(400).json({ error: 'Invalid Square webhook signature' });
      }
    } catch (err: any) {
      console.error('[Square Webhook] Signature verification error:', err.message);
      return res.status(400).json({ error: 'Verification error' });
    }
  }

  const payload = req.body;
  const eventId = payload.event_id || payload.id;
  const eventType = payload.type || payload.event_type;

  if (!eventId) {
    return res.status(400).json({ error: 'Missing Square event_id' });
  }

  // Idempotency check
  const alreadyProcessed = await paymentDb.isWebhookEventProcessed('square', eventId);
  if (alreadyProcessed) {
    console.log(`[Square Webhook] Event ${eventId} already processed. Skipping duplicate.`);
    return res.status(200).json({ received: true, duplicate: true });
  }

  await paymentDb.markWebhookEventProcessed('square', eventId);

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
              await paymentDb.updateInvoiceStatus(localInvoice.id, 'paid');
              console.log(`[Square Webhook] Marked invoice ${localInvoice.id} as PAID.`);
            } else if (sqInvoice.status === 'CANCELED') {
              await paymentDb.updateInvoiceStatus(localInvoice.id, 'void');
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
            await paymentDb.updateInvoiceStatus(localInvoice.id, 'void');
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
    console.error('[Square Webhook] Error processing event:', err.message);
    return res.status(500).json({ error: 'Square webhook error' });
  }
});

export default router;
