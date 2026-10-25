/**
 * Validation rules shared by the browser (inline messages) and the server
 * (authoritative checks). Errors are keyed by field path so the UI can place
 * each message next to its input, e.g. "items.<id>.quantity".
 */
import { calculateInvoice } from './calc';
import { QTY_SCALE, RATE_SCALE, currencyInfo, fractionDigits, parseScaled, toMinor } from './money';
import { isValidISODate } from './status';
import type { BillToSnapshot, Client, Invoice, Payment } from './types';

export type FieldErrors = Record<string, string>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const isValidEmail = (v: string) => EMAIL_RE.test(v.trim());

const MAX_RATE = 100n * 10n ** BigInt(RATE_SCALE);
const MAX_QTY = 1_000_000n * 10n ** BigInt(QTY_SCALE);

export function validateClient(c: Pick<Client, 'name' | 'email' | 'phone' | 'address' | 'taxId' | 'company'>): FieldErrors {
  const e: FieldErrors = {};
  if (!c.name.trim()) e.name = 'Enter the client’s name.';
  else if (c.name.trim().length > 120) e.name = 'Keep the name under 120 characters.';
  if (!c.email.trim()) e.email = 'Enter an email address to send invoices to.';
  else if (!isValidEmail(c.email)) e.email = 'Enter a valid email, like name@company.com.';
  if (c.phone.trim() && !/^[+()\d\s.-]{6,24}$/.test(c.phone.trim())) {
    e.phone = 'Use digits, spaces, and + ( ) - only.';
  }
  if (c.taxId.trim() && !/^[A-Za-z0-9 .\-/]{3,32}$/.test(c.taxId.trim())) {
    e.taxId = 'Tax IDs use 3–32 letters, digits, spaces, or - . /';
  }
  return e;
}

function validateBillTo(b: BillToSnapshot, strict: boolean): FieldErrors {
  const e: FieldErrors = {};
  if (strict && !b.name.trim()) e['billTo.name'] = 'Choose a client or enter who you’re billing.';
  if (strict && !b.email.trim()) e['billTo.email'] = 'Add the recipient’s email address.';
  if (b.email.trim() && !isValidEmail(b.email)) e['billTo.email'] = 'Enter a valid email, like name@company.com.';
  if (strict && !b.address.line1.trim()) e['billTo.address.line1'] = 'Add a billing address.';
  return e;
}

export interface InvoiceValidationContext {
  /** Invoice numbers already used by other invoices (case-insensitive). */
  takenNumbers: string[];
  /** 'draft' checks only what would corrupt data; 'send' checks everything required to bill. */
  mode: 'draft' | 'send';
}

export function validateInvoice(inv: Invoice, ctx: InvoiceValidationContext): FieldErrors {
  const strict = ctx.mode === 'send';
  const e: FieldErrors = {};
  const decimals = currencyInfo(inv.currency).decimals;

  // Number
  const num = inv.number.trim();
  if (!num) e.number = 'Enter an invoice number.';
  else if (!/^[A-Za-z0-9][A-Za-z0-9\-_/.]{0,31}$/.test(num)) e.number = 'Use up to 32 letters, digits, and - _ / .';
  else if (ctx.takenNumbers.some((n) => n.trim().toLowerCase() === num.toLowerCase())) {
    e.number = `${num} is already used by another invoice.`;
  }

  // Dates
  if (!isValidISODate(inv.issueDate)) e.issueDate = 'Choose an issue date.';
  if (!isValidISODate(inv.dueDate)) e.dueDate = 'Choose a due date.';
  if (!e.issueDate && !e.dueDate && inv.dueDate < inv.issueDate) {
    e.dueDate = 'The due date can’t be before the issue date.';
  }

  // Issuer
  if (strict && !inv.issuer.name.trim()) e['issuer.name'] = 'Add your business name in the From section.';
  if (inv.issuer.email.trim() && !isValidEmail(inv.issuer.email)) e['issuer.email'] = 'Enter a valid email.';

  Object.assign(e, validateBillTo(inv.billTo, strict));

  // Items
  if (strict && inv.items.length === 0) e.items = 'Add at least one item.';
  for (const item of inv.items) {
    const p = `items.${item.id}`;
    const blank = !item.name.trim() && !item.quantity.trim() && !item.unitPrice.trim();
    if (!strict && blank) continue;
    if (strict && !item.name.trim()) e[`${p}.name`] = 'Name this item.';

    const q = parseScaled(item.quantity, QTY_SCALE);
    if (!item.quantity.trim()) e[`${p}.quantity`] = 'Enter a quantity.';
    else if (q === null) e[`${p}.quantity`] = fractionDigits(item.quantity) > QTY_SCALE ? 'Use up to 3 decimal places.' : 'Enter a number.';
    else if (q <= 0n) e[`${p}.quantity`] = 'Quantity must be greater than 0.';
    else if (q > MAX_QTY) e[`${p}.quantity`] = 'Quantity is too large.';

    const price = toMinor(item.unitPrice, inv.currency);
    if (!item.unitPrice.trim()) e[`${p}.unitPrice`] = 'Enter a unit price.';
    else if (price === null) {
      e[`${p}.unitPrice`] = fractionDigits(item.unitPrice) > decimals
        ? (decimals === 0 ? `${inv.currency} has no decimal places.` : `Use up to ${decimals} decimal places.`)
        : 'Enter a price, like 120.00.';
    } else if (price < 0n) e[`${p}.unitPrice`] = 'Price can’t be negative.';

    if (item.taxRate.trim()) {
      const r = parseScaled(item.taxRate, RATE_SCALE);
      if (r === null) e[`${p}.taxRate`] = 'Enter a rate like 7.5.';
      else if (r < 0n || r > MAX_RATE) e[`${p}.taxRate`] = 'Tax rate must be between 0 and 100%.';
    }
  }

  // Discount
  if (inv.discount.value.trim()) {
    if (inv.discount.type === 'percent') {
      const r = parseScaled(inv.discount.value, RATE_SCALE);
      if (r === null) e['discount.value'] = 'Enter a percentage like 10.';
      else if (r < 0n || r > MAX_RATE) e['discount.value'] = 'Discount must be between 0 and 100%.';
    } else {
      const a = toMinor(inv.discount.value, inv.currency);
      const totals = calculateInvoice({ ...inv, discount: { type: 'fixed', value: '' } });
      if (a === null) e['discount.value'] = 'Enter an amount like 50.00.';
      else if (a < 0n) e['discount.value'] = 'Discount can’t be negative.';
      else if (a > totals.subtotal) e['discount.value'] = 'Discount can’t exceed the subtotal.';
    }
  }

  // Fees
  for (const f of inv.fees) {
    if (!f.label.trim() && !f.amount.trim()) continue;
    if (!f.label.trim()) e[`fees.${f.id}.label`] = 'Name this fee.';
    const a = toMinor(f.amount, inv.currency);
    if (a === null || a < 0n) e[`fees.${f.id}.amount`] = 'Enter a positive amount.';
  }

  // Split
  if (inv.kind === 'split') {
    if (inv.installments.length < 2) e.installments = 'A split invoice needs at least two installments.';
    let sum = 0n;
    for (const ins of inv.installments) {
      const r = parseScaled(ins.percent, RATE_SCALE);
      if (r === null || r <= 0n) e[`installments.${ins.id}.percent`] = 'Enter a share above 0%.';
      else sum += r;
      if (!isValidISODate(ins.dueDate)) e[`installments.${ins.id}.dueDate`] = 'Choose a due date.';
      else if (isValidISODate(inv.issueDate) && ins.dueDate < inv.issueDate) {
        e[`installments.${ins.id}.dueDate`] = 'Can’t be before the issue date.';
      }
    }
    if (!e.installments && sum !== MAX_RATE) e.installments = 'Installment shares must add up to 100%.';
  }

  // Recurring
  if (inv.kind === 'recurring' && inv.recurring) {
    const r = inv.recurring;
    if (!isValidISODate(r.startDate)) e['recurring.startDate'] = 'Choose when the schedule starts.';
    const due = Number(r.dueInDays);
    if (!/^\d{1,3}$/.test(r.dueInDays) || due > 365) e['recurring.dueInDays'] = 'Enter 0–365 days.';
    if (r.endType === 'after' && (!/^\d{1,3}$/.test(r.occurrences) || Number(r.occurrences) < 1)) {
      e['recurring.occurrences'] = 'Enter how many invoices to create.';
    }
    if (r.endType === 'on') {
      if (!isValidISODate(r.endDate)) e['recurring.endDate'] = 'Choose an end date.';
      else if (isValidISODate(r.startDate) && r.endDate <= r.startDate) e['recurring.endDate'] = 'End date must be after the start date.';
    }
  }

  // Totals sanity
  if (strict && Object.keys(e).length === 0) {
    const totals = calculateInvoice(inv);
    if (totals.total <= 0n) e.total = 'The invoice total must be greater than zero.';
  }

  if (inv.signature.enabled && strict && !inv.signature.name.trim() && !inv.signature.imageDataUrl) {
    e['signature.name'] = 'Add a signer name or turn the signature off.';
  }
  return e;
}

export function validatePayment(
  p: Pick<Payment, 'amount' | 'date' | 'method' | 'currency'>,
  ctx: { balanceDue: bigint; issueDate: string; today: string },
): FieldErrors {
  const e: FieldErrors = {};
  const minor = toMinor(p.amount, p.currency);
  if (!p.amount.trim()) e.amount = 'Enter the amount received.';
  else if (minor === null) e.amount = 'Enter an amount like 250.00.';
  else if (minor <= 0n) e.amount = 'Amount must be greater than 0.';
  else if (minor > ctx.balanceDue) e.amount = 'Amount is more than the balance due.';
  if (!isValidISODate(p.date)) e.date = 'Choose the payment date.';
  else if (p.date > ctx.today) e.date = 'Payment date can’t be in the future.';
  else if (p.date < ctx.issueDate) e.date = 'Payment date can’t be before the invoice was issued.';
  if (!p.method) e.method = 'Choose how it was paid.';
  return e;
}

export const hasErrors = (e: FieldErrors) => Object.keys(e).length > 0;
