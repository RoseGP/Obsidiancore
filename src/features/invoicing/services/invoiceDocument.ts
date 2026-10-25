/**
 * One presentation model, two renderers. The live preview (HTML) and the PDF
 * (jsPDF) both draw from `buildInvoiceDocument`, using the same millimetre
 * layout constants below, so the downloaded PDF matches what users see.
 */
import { calculateInstallments, type InvoiceTotals } from '../domain/calc';
import { formatMoney, formatRate } from '../domain/money';
import { addDays, addMonths, formatDate } from '../domain/status';
import type { Address, Invoice } from '../domain/types';

export const PAGE = {
  widthMm: 210,
  heightMm: 297,
  marginMm: 16,
  accent: '#2F5BEA',
  ink: '#16181D',
  muted: '#6B7280',
  rule: '#E5E7EB',
  soft: '#F5F7FA',
} as const;

/** Column x-offsets (mm from left margin) and widths for the item table. */
export const COLS = {
  item: { x: 0, w: 82 },
  qty: { x: 82, w: 18 },
  price: { x: 100, w: 30 },
  tax: { x: 130, w: 18 },
  amount: { x: 148, w: 30 },
} as const;

export interface DocRow { label: string; value: string; strong?: boolean; muted?: boolean }

export interface InvoiceDocument {
  number: string;
  issueDate: string;
  dueDate: string;
  scheduleNote: string;
  issuer: { name: string; lines: string[]; logo: string };
  billTo: { name: string; lines: string[]; empty: boolean };
  items: { key: string; name: string; description: string; qty: string; unitPrice: string; tax: string; amount: string }[];
  summary: DocRow[];
  balanceLabel: string;
  balanceValue: string;
  installments: { label: string; due: string; amount: string; share: string }[];
  paymentInstructions: string;
  notes: string;
  signature: { name: string; title: string; image: string } | null;
}

export function addressLines(a: Address): string[] {
  const cityLine = [a.city, [a.state, a.postalCode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return [a.line1, a.line2, cityLine, a.country].map((s) => s.trim()).filter(Boolean);
}

const qtyLabel = (raw: string) => {
  const t = raw.trim();
  if (!t) return '—';
  return t.includes('.') ? t.replace(/\.?0+$/, '') : t;
};

const FREQ_LABEL = { weekly: 'weekly', monthly: 'monthly', quarterly: 'quarterly', yearly: 'yearly' } as const;

function nextRunDate(inv: Invoice): string {
  const r = inv.recurring;
  if (!r) return '';
  const step = (d: string) =>
    r.frequency === 'weekly' ? addDays(d, 7)
    : r.frequency === 'monthly' ? addMonths(d, 1)
    : r.frequency === 'quarterly' ? addMonths(d, 3)
    : addMonths(d, 12);
  return step(r.startDate || inv.issueDate);
}

export function buildInvoiceDocument(inv: Invoice, totals: InvoiceTotals): InvoiceDocument {
  const m = (v: bigint) => formatMoney(v, inv.currency);
  const summary: DocRow[] = [{ label: 'Subtotal', value: m(totals.subtotal) }];

  if (totals.discount > 0n) {
    const label = totals.discountRate !== null ? `Discount (${formatRate(totals.discountRate)}%)` : 'Discount';
    summary.push({ label, value: `−${m(totals.discount)}` });
  }
  if (totals.taxGroups.length === 0) {
    summary.push({ label: 'Tax', value: m(0n), muted: true });
  }
  for (const g of totals.taxGroups) {
    summary.push({ label: `Tax ${formatRate(g.rate)}% on ${m(g.taxable)}`, value: m(g.tax) });
  }
  for (const f of totals.fees) {
    summary.push({ label: f.label || 'Fee', value: m(f.amount) });
  }
  summary.push({ label: 'Total', value: m(totals.total), strong: true });
  if (totals.amountPaid > 0n) summary.push({ label: 'Amount paid', value: `−${m(totals.amountPaid)}` });

  let scheduleNote = '';
  if (inv.kind === 'recurring' && inv.recurring) {
    const r = inv.recurring;
    const end = r.endType === 'after' ? `, ${r.occurrences} invoices`
      : r.endType === 'on' && r.endDate ? `, until ${formatDate(r.endDate)}` : '';
    scheduleNote = `Recurring ${FREQ_LABEL[r.frequency]}${end}. Next invoice ${formatDate(nextRunDate(inv))}.`;
  }

  const installments = inv.kind === 'split'
    ? calculateInstallments(totals.total, inv.installments).map((i) => ({
      label: i.label || 'Installment', due: formatDate(i.dueDate), amount: m(i.amount), share: `${formatRate(i.percent)}%`,
    }))
    : [];

  const issuerLines = [
    ...addressLines(inv.issuer.address),
    [inv.issuer.email, inv.issuer.phone].filter(Boolean).join('  ·  '),
    inv.issuer.website,
    inv.issuer.taxId ? `${inv.issuer.taxIdLabel || 'Tax ID'} ${inv.issuer.taxId}` : '',
  ].filter(Boolean);

  const b = inv.billTo;
  const billLines = [
    b.company && b.company !== b.name ? b.company : '',
    ...addressLines(b.address),
    b.email,
    b.phone,
    b.taxId ? `${b.taxIdLabel || 'Tax ID'} ${b.taxId}` : '',
  ].filter(Boolean);

  return {
    number: inv.number || 'Draft',
    issueDate: formatDate(inv.issueDate),
    dueDate: formatDate(inv.dueDate),
    scheduleNote,
    issuer: { name: inv.issuer.name || 'Your business', lines: issuerLines, logo: inv.issuer.logoDataUrl },
    billTo: { name: b.name || 'Client name', lines: billLines, empty: !b.name && billLines.length === 0 },
    items: inv.items.map((it, idx) => {
      const line = totals.lines[idx];
      return {
        key: it.id,
        name: it.name || 'Untitled item',
        description: it.description,
        qty: qtyLabel(it.quantity),
        unitPrice: m(line?.unitPrice ?? 0n),
        tax: line && line.taxRate > 0n ? `${formatRate(line.taxRate)}%` : '—',
        amount: m(line?.subtotal ?? 0n),
      };
    }),
    summary,
    balanceLabel: totals.amountPaid > 0n ? 'Balance due' : 'Amount due',
    balanceValue: m(totals.balanceDue),
    installments,
    paymentInstructions: inv.paymentInstructions.trim(),
    notes: inv.notes.trim(),
    signature: inv.signature.enabled && (inv.signature.name || inv.signature.imageDataUrl)
      ? { name: inv.signature.name, title: inv.signature.title, image: inv.signature.imageDataUrl }
      : null,
  };
}
