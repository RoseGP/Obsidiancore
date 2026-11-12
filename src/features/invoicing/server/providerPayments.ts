/**
 * Card payments confirmed by a payment provider (Stripe / Square webhook) are recorded on the Invoicing
 * invoice they collect: billing/{orgId}/invoices/{id}. The invoice then shows as Paid (or Partially paid),
 * because status is derived from payments.
 *
 * Idempotent: a payment is keyed by the provider's reference (provider invoice id), so a replayed or
 * duplicated webhook never records it twice. Nothing is recorded for a void or draft invoice.
 */
import { loadSnapshot, withSnapshot } from './store';
import { minorToDecimalString, toMinor } from '../domain/money';
import { buildInvoiceView, todayISO } from '../domain/status';
import { uid } from '../domain/factories';
import type { Invoice, Payment } from '../domain/types';

export type ProviderPaymentResult =
  | { recorded: true; payment: Payment; invoice: Invoice }
  | { recorded: false; reason: 'not_found' | 'duplicate' | 'void' | 'draft' | 'already_paid' | 'currency_mismatch' | 'invalid_amount' };

export async function recordProviderPayment(orgId: string, input: {
  billingInvoiceId: string;
  provider: 'stripe' | 'square';
  providerReference: string;   // provider invoice id (idempotency key)
  amount: number | string;     // major units, e.g. 1240.5
  currency: string;
  now?: Date;
}): Promise<ProviderPaymentResult> {
  const now = input.now ?? new Date();
  const reference = `${input.provider}:${input.providerReference}`;
  // Don't open (and so create) an Invoicing workspace for an invoice that isn't there.
  if (!(await billingInvoiceExists(orgId, input.billingInvoiceId))) return { recorded: false, reason: 'not_found' };
  return withSnapshot<ProviderPaymentResult>(orgId, (s) => {
    const inv = s.invoices.find((i) => i.id === input.billingInvoiceId);
    if (!inv) return { snapshot: s, result: { recorded: false, reason: 'not_found' } };
    if (s.payments.some((p) => p.invoiceId === inv.id && p.reference === reference)) return { snapshot: s, result: { recorded: false, reason: 'duplicate' } };
    if (inv.lifecycle === 'void') return { snapshot: s, result: { recorded: false, reason: 'void' } };
    if (inv.lifecycle === 'draft') return { snapshot: s, result: { recorded: false, reason: 'draft' } };
    if (String(input.currency).toUpperCase() !== String(inv.currency).toUpperCase()) return { snapshot: s, result: { recorded: false, reason: 'currency_mismatch' } };
    const paid = toMinor(input.amount, inv.currency);
    if (paid === null || paid <= 0n) return { snapshot: s, result: { recorded: false, reason: 'invalid_amount' } };
    const view = buildInvoiceView(inv, s.payments, todayISO(now));
    const due = view.totals.balanceDue;
    if (due <= 0n) return { snapshot: s, result: { recorded: false, reason: 'already_paid' } };
    const minor = paid > due ? due : paid;
    const at = now.toISOString();
    const payment: Payment = {
      id: uid('pay'),
      receiptNumber: `RCT-${5001 + s.payments.length}`,
      invoiceId: inv.id,
      amount: minorToDecimalString(minor, inv.currency),
      currency: inv.currency,
      date: todayISO(now),
      method: 'card',
      reference,
      note: `Confirmed by ${input.provider === 'stripe' ? 'Stripe' : 'Square'}`,
      status: 'confirmed',
      source: 'provider',
      recordedBy: input.provider === 'stripe' ? 'Stripe' : 'Square',
      createdAt: at,
    };
    const invoice: Invoice = {
      ...inv, updatedAt: at, version: inv.version + 1,
      activity: [...inv.activity, { id: uid('act'), at, type: 'payment_recorded', message: `Card payment of ${payment.amount} ${payment.currency} confirmed by ${payment.recordedBy}` }],
    };
    return {
      snapshot: { ...s, payments: [...s.payments, payment], invoices: s.invoices.map((i) => (i.id === inv.id ? invoice : i)) },
      result: { recorded: true, payment, invoice },
    };
  });
}

/** True when the organization's Invoicing workspace has this invoice (used to validate links). */
export async function billingInvoiceExists(orgId: string, billingInvoiceId: string): Promise<boolean> {
  return (await loadSnapshot(orgId)).invoices.some((i) => i.id === billingInvoiceId);
}

/**
 * An Invoicing invoice with its authoritative totals (recomputed on the server from the stored invoice and
 * its payments, never taken from the browser), for collecting it through a payment provider.
 */
export async function loadBillingInvoiceForCollection(orgId: string, billingInvoiceId: string) {
  const s = await loadSnapshot(orgId);
  const invoice = s.invoices.find((i) => i.id === billingInvoiceId) ?? null;
  if (!invoice) return null;
  const client = invoice.clientId ? s.clients.find((c) => c.id === invoice.clientId) ?? null : null;
  const view = buildInvoiceView(invoice, s.payments, todayISO());
  return { invoice, client, view };
}

/**
 * The provider emailed the invoice: a draft Invoicing invoice becomes "sent" (so it counts as outstanding and
 * a provider payment can be recorded against it). Idempotent; an invoice that is already sent or void is left as is.
 */
export async function markBillingInvoiceSentByProvider(orgId: string, billingInvoiceId: string, input: {
  provider: 'stripe' | 'square'; providerReference: string; actorName: string; now?: Date;
}): Promise<'marked' | 'unchanged' | 'not_found'> {
  if (!(await billingInvoiceExists(orgId, billingInvoiceId))) return 'not_found';
  const name = input.provider === 'stripe' ? 'Stripe' : 'Square';
  return withSnapshot<'marked' | 'unchanged' | 'not_found'>(orgId, (s) => {
    const inv = s.invoices.find((i) => i.id === billingInvoiceId);
    if (!inv) return { snapshot: s, result: 'not_found' };
    if (inv.lifecycle !== 'draft') return { snapshot: s, result: 'unchanged' };
    const at = (input.now ?? new Date()).toISOString();
    const invoice: Invoice = {
      ...inv, lifecycle: 'sent', sentAt: at, updatedAt: at, version: inv.version + 1,
      activity: [...inv.activity, { id: uid('act'), at, type: 'marked_sent', message: `Sent by ${input.actorName} through ${name} (${input.providerReference})` }],
    };
    return { snapshot: { ...s, invoices: s.invoices.map((i) => (i.id === inv.id ? invoice : i)) }, result: 'marked' };
  });
}
