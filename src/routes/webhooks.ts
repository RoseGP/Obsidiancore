import { Router, Request, Response } from 'express';
import Stripe from 'stripe';
import * as d1Db from '../payments/d1Database';
import { optionalSecret } from '../utils/secrets';

const router = Router();

/**
 * POST /api/webhooks/stripe
 * Stripe Webhook Handler for Cloudflare Workers / Express
 * Validates HMAC signature, enforces idempotency via webhook_events table,
 * and updates D1 local invoice payment status.
 */
router.post('/stripe', async (req: Request, res: Response) => {
  const sig = req.headers['stripe-signature'] as string;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event: Stripe.Event;

  // 1. Verify Webhook Signature if STRIPE_WEBHOOK_SECRET is configured
  // Never accept unsigned webhooks in production (forged payment events). TO COMPLETE: set STRIPE_WEBHOOK_SECRET.
  if (process.env.NODE_ENV === 'production' && (!webhookSecret || !sig)) {
    return res.status(400).json({ error: 'Webhook signature verification is required.' });
  }
  if (webhookSecret && sig) {
    try {
      const stripe = new Stripe(optionalSecret('STRIPE_SECRET_KEY') || 'sk_not_configured', {
        apiVersion: '2023-10-16' as any
      });
      const rawBody = (req as any).rawBody || JSON.stringify(req.body);
      event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
    } catch (err: any) {
      console.error('[Stripe Webhook Error] Signature verification failed:', err.message);
      return res.status(400).json({ error: `Webhook Signature Verification Failed: ${err.message}` });
    }
  } else {
    // In test sandbox / local tests when signature verification is simulated
    event = req.body as Stripe.Event;
  }

  if (!event || !event.id) {
    return res.status(400).json({ error: 'Invalid webhook payload structure: missing event id' });
  }

  const eventId = event.id;
  const eventType = event.type;

  // 2. Webhook Idempotency Check: check if event has already been processed in D1
  const isAlreadyProcessed = await d1Db.isWebhookEventProcessed('stripe', eventId);
  if (isAlreadyProcessed) {
    console.log(`[Stripe Webhook] Event ${eventId} already processed. Skipping duplicate processing.`);
    return res.status(200).json({ received: true, duplicate: true, eventId });
  }

  // 3. Mark event in webhook_events table immediately before processing
  await d1Db.markWebhookEventProcessed('stripe', eventId);
  console.log(`[Stripe Webhook] Processing event: ${eventType} (${eventId})`);

  try {
    switch (eventType) {
      case 'invoice.paid':
      case 'invoice.payment_succeeded': {
        const stripeInvoice = event.data?.object as any;
        const providerInvoiceId = stripeInvoice?.id;

        if (providerInvoiceId) {
          const localInvoice = await d1Db.getInvoiceByProviderInvoiceId('stripe', providerInvoiceId);
          if (localInvoice) {
            const now = new Date().toISOString();
            await d1Db.updateInvoicePaymentDetails(localInvoice.id, {
              payment_status: 'paid',
              status: 'paid',
              paid_at: now,
              payment_url: stripeInvoice.hosted_invoice_url || localInvoice.payment_url || undefined
            });
            console.log(`[Stripe Webhook] Marked local invoice ${localInvoice.id} (${localInvoice.invoice_number}) as PAID.`);
          } else {
            console.warn(`[Stripe Webhook] No local D1 invoice found matching provider_invoice_id: ${providerInvoiceId}`);
          }
        }
        break;
      }

      case 'invoice.payment_failed': {
        const stripeInvoice = event.data?.object as any;
        const providerInvoiceId = stripeInvoice?.id;

        if (providerInvoiceId) {
          const localInvoice = await d1Db.getInvoiceByProviderInvoiceId('stripe', providerInvoiceId);
          if (localInvoice) {
            await d1Db.updateInvoicePaymentDetails(localInvoice.id, {
              payment_status: 'failed'
            });
            console.log(`[Stripe Webhook] Marked local invoice ${localInvoice.id} payment_status as FAILED.`);
          }
        }
        break;
      }

      case 'invoice.voided': {
        const stripeInvoice = event.data?.object as any;
        const providerInvoiceId = stripeInvoice?.id;

        if (providerInvoiceId) {
          const localInvoice = await d1Db.getInvoiceByProviderInvoiceId('stripe', providerInvoiceId);
          if (localInvoice) {
            await d1Db.updateInvoicePaymentDetails(localInvoice.id, {
              status: 'void',
              payment_status: 'void'
            });
            console.log(`[Stripe Webhook] Marked local invoice ${localInvoice.id} as VOID.`);
          }
        }
        break;
      }

      default:
        console.log(`[Stripe Webhook] Unhandled event type: ${eventType}`);
    }

    return res.status(200).json({ received: true, eventId, type: eventType });
  } catch (err: any) {
    console.error(`[Stripe Webhook] Error processing event ${eventId}:`, err);
    return res.status(500).json({ error: 'Webhook processing error' });
  }
});

export default router;
