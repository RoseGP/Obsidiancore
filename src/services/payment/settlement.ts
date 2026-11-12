/**
 * What happens when a provider confirms a payment: the provider invoice (paymentDb) is marked paid and, when
 * it collects an Invoicing invoice, that invoice gets a confirmed card payment (so it shows as Paid).
 * Both steps are idempotent, so webhook retries and replays are safe.
 */
import * as paymentDb from './paymentDb';
import { markBillingInvoiceSentByProvider, recordProviderPayment } from '../../features/invoicing/server/providerPayments';
import type { Invoice, PaymentProviderType } from './types';
import { minorToDecimalString } from '../../features/invoicing/domain/money';

export async function settleProviderInvoice(p: PaymentProviderType, local: Invoice, extra?: Partial<Invoice>) {
  const orgId = local.user_id;
  const updated = local.status === 'paid' ? local : await paymentDb.updateInvoiceStatus(orgId, local.id, 'paid', extra);
  let billing: Awaited<ReturnType<typeof recordProviderPayment>> | null = null;
  if (local.billing_invoice_id) {
    // A provider-confirmed payment means the invoice reached the customer (e.g. paid through a link without our
    // email): a CRM invoice still in draft counts as sent, otherwise the payment couldn't be recorded on it.
    await markBillingInvoiceSentByProvider(orgId, local.billing_invoice_id, { provider: p, providerReference: local.provider_invoice_id, actorName: p === 'stripe' ? 'Stripe' : 'Square' });
    billing = await recordProviderPayment(orgId, {
      billingInvoiceId: local.billing_invoice_id,
      provider: p,
      providerReference: local.provider_invoice_id,
      // What the provider actually collected (minor units) when known, else the invoice total.
      amount: typeof local.amount_paid_minor === 'number' && local.amount_paid_minor > 0 ? minorToDecimalString(BigInt(local.amount_paid_minor), String(local.currency).toUpperCase()) : local.total,
      currency: local.currency,
    });
  }
  return { invoice: updated || local, billing };
}
