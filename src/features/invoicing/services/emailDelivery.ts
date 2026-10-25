/**
 * Email delivery (client side). Composes the message and hands the PDF to the
 * server, which owns SMTP credentials. Delivery is never simulated: when the
 * server has no mail transport the attempt is recorded as "not configured".
 */
import { formatMoney } from '../domain/money';
import { formatDate } from '../domain/status';
import type { InvoiceTotals } from '../domain/calc';
import type { Invoice } from '../domain/types';
import { buildInvoiceDocument } from './invoiceDocument';
import { invoicePdfBase64, invoicePdfFilename } from './pdf';
import type { BillingRepository, SendRequest } from './repository';

export function defaultEmail(inv: Invoice, totals: InvoiceTotals) {
  const amount = formatMoney(totals.balanceDue, inv.currency);
  const greeting = inv.billTo.name ? `Hi ${inv.billTo.name.split(' ')[0]},` : 'Hello,';
  return {
    subject: `Invoice ${inv.number} from ${inv.issuer.name}`,
    message: `${greeting}\n\nPlease find attached invoice ${inv.number} for ${amount}, due ${formatDate(inv.dueDate)}.\n\nPayment details are included on the invoice. Let me know if you have any questions.\n\nThanks,\n${inv.issuer.name}`,
  };
}

export function sendInvoiceEmail(
  repo: BillingRepository,
  inv: Invoice,
  totals: InvoiceTotals,
  fields: Pick<SendRequest, 'to' | 'cc' | 'subject' | 'message'>,
  idempotencyKey: string,
) {
  const doc = buildInvoiceDocument(inv, totals);
  return repo.sendInvoice(inv.id, {
    ...fields,
    pdfBase64: invoicePdfBase64(doc),
    pdfFilename: invoicePdfFilename(doc),
  }, { idempotencyKey });
}
