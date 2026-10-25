/**
 * Centralized invoice calculation engine.
 *
 * Shared by the browser (live preview, PDF) and the server (authoritative
 * re-calculation on save/send). Pure functions, no I/O.
 *
 * Calculation order — documented in docs/invoicing/CALCULATIONS.md:
 *   1. Line subtotal   = round(quantity × unit price)                [per line]
 *   2. Subtotal        = Σ line subtotals
 *   3. Discount        = percent: round(subtotal × rate) | fixed: amount
 *                        capped at the subtotal; applied BEFORE tax
 *   4. Discount share  = discount allocated to lines in proportion to
 *                        their subtotal (largest remainder, sums exactly)
 *   5. Line tax        = round((line subtotal − share) × line tax rate)
 *   6. Tax             = Σ line tax
 *   7. Fees            = Σ additional fees (not taxed, not discounted)
 *   8. Grand total     = subtotal − discount + tax + fees
 *   9. Amount paid     = Σ CONFIRMED payments
 *  10. Balance due     = grand total − amount paid (never below zero;
 *                        overpayment reported separately as credit)
 * Every rounding is ROUND_HALF_UP to the currency's minor unit.
 */
import {
  QTY_SCALE, RATE_SCALE, allocate, divRoundHalfUp, parseScaled, sumMinor, toMinor,
} from './money';
import type { Discount, Fee, Installment, LineItem, Payment } from './types';

const QTY_DIV = 10n ** BigInt(QTY_SCALE); // 1000
const RATE_DIV = 100n * 10n ** BigInt(RATE_SCALE); // 100 % × 1000

export interface LineResult {
  id: string;
  quantity: bigint; // scaled ×1000
  unitPrice: bigint; // minor
  taxRate: bigint; // scaled ×1000 (percent)
  subtotal: bigint;
  discountShare: bigint;
  taxable: bigint;
  tax: bigint;
  total: bigint; // taxable + tax
  valid: boolean;
}

export interface TaxGroup {
  rate: bigint;
  taxable: bigint;
  tax: bigint;
}

export interface InvoiceTotals {
  currency: string;
  lines: LineResult[];
  subtotal: bigint;
  discount: bigint;
  /** Discount percentage as scaled value, if percent discount. */
  discountRate: bigint | null;
  discountCapped: boolean;
  taxGroups: TaxGroup[];
  tax: bigint;
  fees: { id: string; label: string; amount: bigint }[];
  feesTotal: bigint;
  total: bigint;
  amountPaid: bigint;
  balanceDue: bigint;
  credit: bigint;
  pendingPayments: bigint;
}

export interface CalcInput {
  currency: string;
  items: LineItem[];
  discount: Discount;
  fees: Fee[];
}

/** Lenient parse for live preview: invalid input counts as zero. */
const orZero = (v: bigint | null) => (v === null || v < 0n ? 0n : v);

export function calculateInvoice(input: CalcInput, payments: Payment[] = []): InvoiceTotals {
  const { currency } = input;

  // 1. Line subtotals
  const base = input.items.map((item) => {
    const q = parseScaled(item.quantity, QTY_SCALE);
    const p = toMinor(item.unitPrice, currency);
    const r = parseScaled(item.taxRate === '' ? '0' : item.taxRate, RATE_SCALE);
    const quantity = orZero(q);
    const unitPrice = orZero(p);
    const taxRate = orZero(r);
    const subtotal = divRoundHalfUp(quantity * unitPrice, QTY_DIV);
    return {
      id: item.id, quantity, unitPrice, taxRate, subtotal,
      valid: q !== null && p !== null && r !== null && q > 0n && p >= 0n && r >= 0n,
    };
  });

  // 2. Subtotal
  const subtotal = sumMinor(base.map((l) => l.subtotal));

  // 3. Discount (pre-tax, capped at subtotal)
  let discount = 0n;
  let discountRate: bigint | null = null;
  let discountCapped = false;
  if (input.discount.value.trim() !== '') {
    if (input.discount.type === 'percent') {
      const rate = orZero(parseScaled(input.discount.value, RATE_SCALE));
      const capped = rate > 100n * 10n ** BigInt(RATE_SCALE);
      discountRate = capped ? 100n * 10n ** BigInt(RATE_SCALE) : rate;
      discountCapped = capped;
      discount = divRoundHalfUp(subtotal * discountRate, RATE_DIV);
    } else {
      const amount = orZero(toMinor(input.discount.value, currency));
      discountCapped = amount > subtotal;
      discount = discountCapped ? subtotal : amount;
    }
  }

  // 4. Allocate discount across lines
  const shares = allocate(discount, base.map((l) => l.subtotal));

  // 5. Line tax
  const lines: LineResult[] = base.map((l, i) => {
    const taxable = l.subtotal - shares[i];
    const tax = divRoundHalfUp(taxable * l.taxRate, RATE_DIV);
    return { ...l, discountShare: shares[i], taxable, tax, total: taxable + tax };
  });

  // 6. Tax total + grouping by rate for the summary
  const tax = sumMinor(lines.map((l) => l.tax));
  const groupMap = new Map<string, TaxGroup>();
  for (const l of lines) {
    if (l.taxRate === 0n) continue;
    const key = l.taxRate.toString();
    const g = groupMap.get(key) ?? { rate: l.taxRate, taxable: 0n, tax: 0n };
    g.taxable += l.taxable;
    g.tax += l.tax;
    groupMap.set(key, g);
  }
  const taxGroups = [...groupMap.values()].sort((a, b) => (a.rate < b.rate ? -1 : 1));

  // 7. Fees
  const fees = input.fees
    .filter((f) => f.label.trim() !== '' || f.amount.trim() !== '')
    .map((f) => ({ id: f.id, label: f.label, amount: orZero(toMinor(f.amount, currency)) }));
  const feesTotal = sumMinor(fees.map((f) => f.amount));

  // 8. Grand total
  const total = subtotal - discount + tax + feesTotal;

  // 9–10. Payments
  const relevant = payments.filter((p) => p.currency === currency);
  const amountPaid = sumMinor(
    relevant.filter((p) => p.status === 'confirmed').map((p) => orZero(toMinor(p.amount, currency))),
  );
  const pendingPayments = sumMinor(
    relevant.filter((p) => p.status === 'pending').map((p) => orZero(toMinor(p.amount, currency))),
  );
  const rawBalance = total - amountPaid;

  return {
    currency, lines, subtotal, discount, discountRate, discountCapped, taxGroups, tax,
    fees, feesTotal, total, amountPaid,
    balanceDue: rawBalance > 0n ? rawBalance : 0n,
    credit: rawBalance < 0n ? -rawBalance : 0n,
    pendingPayments,
  };
}

export interface InstallmentResult {
  id: string;
  label: string;
  dueDate: string;
  percent: bigint;
  amount: bigint;
}

/** Splits the grand total across installments; parts always sum to the total. */
export function calculateInstallments(total: bigint, installments: Installment[]): InstallmentResult[] {
  const rates = installments.map((i) => orZero(parseScaled(i.percent, RATE_SCALE)));
  const amounts = allocate(total, rates);
  return installments.map((i, idx) => ({
    id: i.id, label: i.label, dueDate: i.dueDate, percent: rates[idx], amount: amounts[idx],
  }));
}

/** Serializable totals for API payloads (bigint → string). */
export function serializeTotals(t: InvoiceTotals) {
  return {
    currency: t.currency,
    subtotal: t.subtotal.toString(),
    discount: t.discount.toString(),
    tax: t.tax.toString(),
    fees: t.feesTotal.toString(),
    total: t.total.toString(),
    amountPaid: t.amountPaid.toString(),
    balanceDue: t.balanceDue.toString(),
  };
}
