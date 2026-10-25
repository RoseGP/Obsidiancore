/**
 * Dashboard metrics. All sums are in the business's default currency;
 * invoices in other currencies are excluded and reported as a count so the
 * UI can say so (no FX conversion is assumed).
 */
import { sumMinor, toMinor } from './money';
import { addDays, addMonths, parseISODate, todayISO, type InvoiceView } from './status';
import type { Payment } from './types';

export type Period = 'month' | '30d' | 'quarter' | 'year';

export const PERIOD_LABELS: Record<Period, string> = {
  month: 'This month',
  '30d': 'Last 30 days',
  quarter: 'This quarter',
  year: 'This year',
};

export interface Range { start: string; end: string }

export function periodRange(p: Period, today: string): { current: Range; previous: Range; compareLabel: string } {
  const d = parseISODate(today);
  let start: string;
  let compareLabel: string;
  if (p === '30d') {
    start = addDays(today, -29);
    compareLabel = 'vs previous 30 days';
  } else if (p === 'month') {
    start = todayISO(new Date(d.getFullYear(), d.getMonth(), 1));
    compareLabel = 'vs same days last month';
  } else if (p === 'quarter') {
    start = todayISO(new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1));
    compareLabel = 'vs same point last quarter';
  } else {
    start = `${d.getFullYear()}-01-01`;
    compareLabel = 'vs same point last year';
  }
  const shift = p === '30d' ? null : p === 'month' ? 1 : p === 'quarter' ? 3 : 12;
  const previous: Range = shift === null
    ? { start: addDays(start, -30), end: addDays(start, -1) }
    : { start: addMonths(start, -shift), end: addMonths(today, -shift) };
  return { current: { start, end: today }, previous, compareLabel };
}

const inRange = (date: string, r: Range) => date >= r.start && date <= r.end;

function billable(views: InvoiceView[], currency: string) {
  return views.filter((v) => v.invoice.currency === currency && v.status !== 'draft' && v.status !== 'void');
}

export function invoicedIn(views: InvoiceView[], r: Range, currency: string): bigint {
  return sumMinor(billable(views, currency).filter((v) => inRange(v.invoice.issueDate, r)).map((v) => v.totals.total));
}

export function collectedIn(payments: Payment[], views: InvoiceView[], r: Range, currency: string): bigint {
  const valid = new Set(billable(views, currency).map((v) => v.invoice.id));
  return sumMinor(
    payments
      .filter((p) => p.status === 'confirmed' && p.currency === currency && valid.has(p.invoiceId) && inRange(p.date, r))
      .map((p) => toMinor(p.amount, currency) ?? 0n),
  );
}

/** Balance outstanding as of the end of `asOf`, optionally only past-due amounts. */
export function outstandingAt(views: InvoiceView[], asOf: string, currency: string, overdueOnly = false): bigint {
  let total = 0n;
  for (const v of billable(views, currency)) {
    if (v.invoice.issueDate > asOf) continue;
    if (overdueOnly && !(v.invoice.dueDate < asOf)) continue;
    const paid = sumMinor(v.payments.filter((p) => p.status === 'confirmed' && p.date <= asOf).map((p) => toMinor(p.amount, currency) ?? 0n));
    const bal = v.totals.total - paid;
    if (bal > 0n) total += bal;
  }
  return total;
}

export function pctChange(curr: bigint, prev: bigint): number | null {
  if (prev === 0n) return curr === 0n ? 0 : null;
  // Scale to basis points with integer math, then to a float percent for display.
  return Number(((curr - prev) * 10000n) / (prev < 0n ? -prev : prev)) / 100;
}

export interface MonthPoint { key: string; label: string; invoiced: bigint; collected: bigint }

export function monthlySeries(views: InvoiceView[], payments: Payment[], months: number, today: string, currency: string): MonthPoint[] {
  const end = parseISODate(today);
  const fmt = new Intl.DateTimeFormat('en-US', { month: 'short' });
  const fmtY = new Intl.DateTimeFormat('en-US', { month: 'short', year: '2-digit' });
  const points: MonthPoint[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(end.getFullYear(), end.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    points.push({ key, label: d.getMonth() === 0 || i === months - 1 ? fmtY.format(d) : fmt.format(d), invoiced: 0n, collected: 0n });
  }
  const idx = new Map(points.map((p, i) => [p.key, i]));
  const list = billable(views, currency);
  const valid = new Set(list.map((v) => v.invoice.id));
  for (const v of list) {
    const i = idx.get(v.invoice.issueDate.slice(0, 7));
    if (i !== undefined) points[i].invoiced += v.totals.total;
  }
  for (const p of payments) {
    if (p.status !== 'confirmed' || p.currency !== currency || !valid.has(p.invoiceId)) continue;
    const i = idx.get(p.date.slice(0, 7));
    if (i !== undefined) points[i].collected += toMinor(p.amount, currency) ?? 0n;
  }
  return points;
}

export interface AgingBucket { label: string; amount: bigint; count: number }

export function agingBuckets(views: InvoiceView[], today: string, currency: string): AgingBucket[] {
  const buckets: AgingBucket[] = [
    { label: 'Not yet due', amount: 0n, count: 0 },
    { label: '1–30 days', amount: 0n, count: 0 },
    { label: '31–60 days', amount: 0n, count: 0 },
    { label: '61–90 days', amount: 0n, count: 0 },
    { label: 'Over 90 days', amount: 0n, count: 0 },
  ];
  for (const v of billable(views, currency)) {
    if (v.totals.balanceDue === 0n) continue;
    const late = v.invoice.dueDate < today ? Math.round((parseISODate(today).getTime() - parseISODate(v.invoice.dueDate).getTime()) / 86_400_000) : 0;
    const b = late === 0 ? 0 : late <= 30 ? 1 : late <= 60 ? 2 : late <= 90 ? 3 : 4;
    buckets[b].amount += v.totals.balanceDue;
    buckets[b].count += 1;
  }
  return buckets;
}

export function otherCurrencyCount(views: InvoiceView[], currency: string) {
  return views.filter((v) => v.invoice.currency !== currency && v.status !== 'draft' && v.status !== 'void').length;
}
