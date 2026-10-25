import { calculateInvoice, type InvoiceTotals } from './calc';
import type { Invoice, InvoiceStatus, Payment, PaymentState, ISODate } from './types';

// ---------- Dates (timezone-safe: we only deal in local calendar dates) ----------

export function todayISO(now: Date = new Date()): ISODate {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidISODate(value: string): boolean {
  if (!ISO_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

export function parseISODate(value: ISODate): Date {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(value: ISODate, days: number): ISODate {
  const dt = parseISODate(value);
  dt.setDate(dt.getDate() + days);
  return todayISO(dt);
}

export function addMonths(value: ISODate, months: number): ISODate {
  const dt = parseISODate(value);
  const day = dt.getDate();
  dt.setDate(1);
  dt.setMonth(dt.getMonth() + months);
  const lastDay = new Date(dt.getFullYear(), dt.getMonth() + 1, 0).getDate();
  dt.setDate(Math.min(day, lastDay));
  return todayISO(dt);
}

export function daysBetween(from: ISODate, to: ISODate): number {
  const ms = parseISODate(to).getTime() - parseISODate(from).getTime();
  return Math.round(ms / 86_400_000);
}

const dateFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
export function formatDate(value: ISODate | null | undefined): string {
  if (!value || !isValidISODate(value)) return '—';
  return dateFmt.format(parseISODate(value));
}

const dateTimeFmt = new Intl.DateTimeFormat('en-US', {
  month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
});
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : dateTimeFmt.format(d);
}

// ---------- Status derivation ----------

export interface InvoiceView {
  invoice: Invoice;
  totals: InvoiceTotals;
  status: InvoiceStatus;
  paymentState: PaymentState;
  payments: Payment[];
  daysOverdue: number;
}

/**
 * Display status precedence:
 *   void → draft → paid → overdue → partially paid → viewed → sent
 * Overdue = due date before today AND balance outstanding, unless paid or void.
 */
export function deriveStatus(invoice: Invoice, totals: InvoiceTotals, today: ISODate): InvoiceStatus {
  if (invoice.lifecycle === 'void') return 'void';
  if (invoice.lifecycle === 'draft') return 'draft';
  if (totals.total > 0n && totals.balanceDue === 0n) return 'paid';
  if (totals.balanceDue > 0n && invoice.dueDate < today) return 'overdue';
  if (totals.amountPaid > 0n) return 'partially_paid';
  return invoice.lifecycle === 'viewed' ? 'viewed' : 'sent';
}

export function derivePaymentState(totals: InvoiceTotals): PaymentState {
  if (totals.total > 0n && totals.balanceDue === 0n) return 'paid';
  if (totals.amountPaid > 0n) return 'partial';
  return 'unpaid';
}

export function buildInvoiceView(invoice: Invoice, allPayments: Payment[], today: ISODate): InvoiceView {
  const payments = allPayments.filter((p) => p.invoiceId === invoice.id);
  const totals = calculateInvoice(invoice, payments);
  const status = deriveStatus(invoice, totals, today);
  return {
    invoice, totals, status, payments,
    paymentState: derivePaymentState(totals),
    daysOverdue: status === 'overdue' ? daysBetween(invoice.dueDate, today) : 0,
  };
}

export const STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  viewed: 'Viewed',
  partially_paid: 'Partially paid',
  paid: 'Paid',
  overdue: 'Overdue',
  void: 'Void',
};

export const PAYMENT_STATE_LABELS: Record<PaymentState, string> = {
  unpaid: 'Unpaid',
  partial: 'Partial',
  paid: 'Paid',
};

/** Statuses whose balance counts toward receivables. */
export function isReceivable(status: InvoiceStatus): boolean {
  return status === 'sent' || status === 'viewed' || status === 'partially_paid' || status === 'overdue';
}
