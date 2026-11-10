/**
 * What happens when a provider confirms a payment: the provider invoice (paymentDb) is marked paid and, when
 * it collects an Invoicing invoice, that invoice gets a confirmed card payment (so it shows as Paid).
 * Both steps are idempotent, so webhook retries and replays are safe.
 */
import * as paymentDb from './paymentDb';
import { recordProviderPayment } from '../../features/invoicing/server/providerPayments';
import type { Invoice, PaymentProviderType } from './types';

export async function settleProviderInvoice(p: PaymentProviderType, local: Invoice, extra?: Partial<Invoice>) {
  const orgId = local.user_id;
  const updated = local.status === 'paid' ? local : await paymentDb.updateInvoiceStatus(orgId, local.id, 'paid', extra);
  let billing: Awaited<ReturnType<typeof recordProviderPayment>> | null = null;
  if (local.billing_invoice_id) {
    billing = await recordProviderPayment(orgId, {
      billingInvoiceId: local.billing_invoice_id,
      provider: p,
      providerReference: local.provider_invoice_id,
      amount: local.total,
      currency: local.currency,
    });
  }
  return { invoice: updated || local, billing };
}
