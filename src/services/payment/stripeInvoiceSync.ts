/**
 * Applies what Stripe says about an invoice to the CRM's record (webhooks, the "Refresh" action and the
 * responses of create / finalize / send all go through here).
 *
 * Status moves forward only (Stripe's own lifecycle): draft → open → paid | void | uncollectible,
 * uncollectible → paid | void; paid and void are final. An older event arriving late can't undo a newer state.
 * A paid invoice settles the linked Invoicing invoice (idempotent, see settlement.ts).
 */
import type Stripe from 'stripe';
import * as paymentDb from './paymentDb';
import { settleProviderInvoice } from './settlement';
import type { Invoice, InvoiceStatus } from './types';

const NEXT: Record<InvoiceStatus, InvoiceStatus[]> = {
  draft: ['open', 'paid', 'void', 'uncollectible'],
  open: ['paid', 'void', 'uncollectible'],
  uncollectible: ['paid', 'void'],
  paid: [],
  void: [],
};
export const canMove = (from: InvoiceStatus, to: InvoiceStatus) => from === to || NEXT[from]?.includes(to);

const STATUSES: InvoiceStatus[] = ['draft', 'open', 'paid', 'uncollectible', 'void'];
const asStatus = (v: unknown): InvoiceStatus | null => (STATUSES.includes(v as InvoiceStatus) ? (v as InvoiceStatus) : null);
const iso = (unix?: number | null) => (typeof unix === 'number' && unix > 0 ? new Date(unix * 1000).toISOString() : undefined);

export interface SyncExtras {
  /** When the change happened (event.created for webhooks). */
  at?: string;
  /**
   * Set for webhook events: their time is recorded, and an event older than the last applied one can still move
   * the status forward but can't set flags (a stale "payment failed" after newer events). API responses are
   * current by definition and don't take part in the ordering.
   */
  fromWebhook?: boolean;
  failure?: { message: string; code?: string } | null;
  actionRequired?: boolean;
  sent?: boolean;
}

/** What the CRM keeps from a Stripe invoice object. */
export function snapshotOf(si: Partial<Stripe.Invoice>): Partial<Invoice> {
  const t = (si as any).status_transitions || {};
  return {
    ...(si.hosted_invoice_url ? { hosted_invoice_url: si.hosted_invoice_url } : {}),
    ...(si.invoice_pdf ? { invoice_pdf_url: si.invoice_pdf } : {}),
    ...(typeof si.amount_due === 'number' ? { amount_due_minor: si.amount_due } : {}),
    ...(typeof si.amount_paid === 'number' ? { amount_paid_minor: si.amount_paid } : {}),
    ...(typeof si.customer === 'string' ? { provider_customer_id: si.customer } : {}),
    ...(iso(t.finalized_at) ? { finalized_at: iso(t.finalized_at) } : {}),
    ...(iso(t.paid_at) ? { paid_at: iso(t.paid_at) } : {}),
    ...(iso(t.voided_at) ? { voided_at: iso(t.voided_at) } : {}),
  };
}

/** Updates the local invoice from a Stripe invoice object; settles it when it became paid. */
export async function applyStripeInvoice(local: Invoice, si: Partial<Stripe.Invoice>, extras: SyncExtras = {}): Promise<Invoice> {
  const orgId = local.user_id;
  let becamePaid = false;
  const updated = await paymentDb.patchInvoice(orgId, local.id, (cur) => {
    const older = !!(extras.fromWebhook && extras.at && cur.last_event_at && extras.at < cur.last_event_at);
    const target = asStatus(si.status) ?? cur.status;
    // Forward-only status: always safe to apply, whatever the order of arrival.
    const status = canMove(cur.status, target) ? target : cur.status;
    const snap = snapshotOf(si);
    // A status that couldn't be applied (e.g. "open" after "paid") also means its amounts are stale.
    if (status !== target) { delete snap.amount_due_minor; delete snap.amount_paid_minor; }
    const patch: Partial<Invoice> = { ...snap, status };
    if (extras.fromWebhook && extras.at && !older) patch.last_event_at = extras.at;
    if (status === 'paid') { patch.payment_failure = null; patch.action_required = false; }
    else if (!older && extras.failure !== undefined) patch.payment_failure = extras.failure ? { ...extras.failure, at: extras.at || new Date().toISOString() } : null;
    if (!older && extras.actionRequired !== undefined && status !== 'paid') patch.action_required = extras.actionRequired;
    // An explicit send always updates the time; a webhook only fills it in when we didn't record it ourselves.
    if (extras.sent && (!extras.fromWebhook || !cur.sent_at)) patch.sent_at = extras.at || new Date().toISOString();
    becamePaid = status === 'paid' && cur.status !== 'paid';
    return patch;
  });
  if (!updated) return local;
  if (becamePaid || updated.status === 'paid') {
    // Idempotent: a replay finds the Invoicing payment already recorded (reference = provider invoice id).
    await settleProviderInvoice('stripe', updated);
  }
  return updated;
}
