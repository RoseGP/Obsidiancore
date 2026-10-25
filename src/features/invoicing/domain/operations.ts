/**
 * Pure state transitions used by BOTH the server route and the prototype
 * store, so business rules live in exactly one place:
 *  - totals are always recomputed here, never trusted from the caller
 *  - sending never marks an invoice paid
 *  - only confirmed payments reduce the balance
 */
import { calculateInvoice } from './calc';
import { minorToDecimalString, toMinor } from './money';
import { buildInvoiceView, todayISO } from './status';
import { uid } from './factories';
import type {
  BillingSnapshot, Client, CurrentUser, DeliveryAttempt, Invoice, Payment,
} from './types';
import { hasErrors, validateClient, validateInvoice, validatePayment, type FieldErrors } from './validation';

export class DomainError extends Error {
  constructor(message: string, public code: 'validation' | 'conflict' | 'not_found' | 'forbidden', public fieldErrors: FieldErrors = {}) {
    super(message);
  }
}

const canWrite = (u: CurrentUser) => u.role !== 'viewer';

function assertWriter(user: CurrentUser) {
  if (!canWrite(user)) throw new DomainError('Your role can view billing but not change it.', 'forbidden');
}

function findInvoice(s: BillingSnapshot, id: string): Invoice {
  const inv = s.invoices.find((i) => i.id === id);
  if (!inv) throw new DomainError('That invoice no longer exists.', 'not_found');
  return inv;
}

const otherNumbers = (s: BillingSnapshot, id: string) => s.invoices.filter((i) => i.id !== id).map((i) => i.number);

export function opSaveInvoice(s: BillingSnapshot, incoming: Invoice, user: CurrentUser, now = new Date()): { snapshot: BillingSnapshot; invoice: Invoice } {
  assertWriter(user);
  const existing = s.invoices.find((i) => i.id === incoming.id);
  if (existing) {
    if (existing.lifecycle === 'void') throw new DomainError('Void invoices can’t be edited.', 'conflict');
    if (existing.version !== incoming.version) {
      throw new DomainError('This invoice was changed elsewhere. Reload it to see the latest version.', 'conflict');
    }
    const view = buildInvoiceView(existing, s.payments, todayISO(now));
    if (view.status === 'paid') throw new DomainError('Paid invoices can’t be edited. Duplicate it instead.', 'conflict');
  }
  const mode = incoming.lifecycle === 'draft' ? 'draft' : 'send';
  const errors = validateInvoice(incoming, { takenNumbers: otherNumbers(s, incoming.id), mode });
  if (hasErrors(errors)) throw new DomainError('Fix the highlighted fields before saving.', 'validation', errors);

  // A saved invoice's total can't drop below what's already been paid.
  const paid = s.payments.filter((p) => p.invoiceId === incoming.id);
  const totals = calculateInvoice(incoming, paid);
  if (totals.credit > 0n) {
    throw new DomainError('The new total is lower than the amount already paid.', 'validation', { total: 'Total can’t be less than the amount already paid.' });
  }

  const at = now.toISOString();
  const saved: Invoice = {
    ...incoming,
    // Server-controlled fields are never taken from the caller.
    lifecycle: existing ? existing.lifecycle : 'draft',
    deliveries: existing ? existing.deliveries : [],
    sentAt: existing?.sentAt ?? null,
    viewedAt: existing?.viewedAt ?? null,
    voidedAt: existing?.voidedAt ?? null,
    createdAt: existing?.createdAt ?? at,
    updatedAt: at,
    version: (existing?.version ?? 0) + 1,
    activity: [
      ...(existing ? existing.activity : incoming.activity),
      { id: uid('act'), at, type: existing ? 'updated' : 'created', message: existing ? `Edited by ${user.name}` : `Created by ${user.name}` },
    ],
  };
  const invoices = existing
    ? s.invoices.map((i) => (i.id === saved.id ? saved : i))
    : [...s.invoices, saved];
  return { snapshot: { ...s, invoices }, invoice: saved };
}

export function opVoidInvoice(s: BillingSnapshot, id: string, user: CurrentUser, now = new Date()) {
  assertWriter(user);
  const inv = findInvoice(s, id);
  if (inv.lifecycle === 'void') return { snapshot: s, invoice: inv };
  if (s.payments.some((p) => p.invoiceId === id && p.status === 'confirmed')) {
    throw new DomainError('This invoice has recorded payments. Refund them before voiding.', 'conflict');
  }
  const at = now.toISOString();
  const invoice: Invoice = {
    ...inv, lifecycle: 'void', voidedAt: at, updatedAt: at, version: inv.version + 1,
    activity: [...inv.activity, { id: uid('act'), at, type: 'voided', message: `Voided by ${user.name}` }],
  };
  return { snapshot: { ...s, invoices: s.invoices.map((i) => (i.id === id ? invoice : i)) }, invoice };
}

/** Prepares an invoice for sending: strict validation. Returns the invoice or throws. */
export function opAssertSendable(s: BillingSnapshot, id: string, to: string) {
  const inv = findInvoice(s, id);
  if (inv.lifecycle === 'void') throw new DomainError('Void invoices can’t be sent.', 'conflict');
  const errors = validateInvoice(inv, { takenNumbers: otherNumbers(s, id), mode: 'send' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(to.trim())) errors.to = 'Enter a valid recipient email.';
  if (hasErrors(errors)) throw new DomainError('This invoice is missing details required to send it.', 'validation', errors);
  return inv;
}

/** Records a delivery attempt. Only a delivered attempt moves a draft to "sent". */
export function opRecordDelivery(s: BillingSnapshot, id: string, attempt: Omit<DeliveryAttempt, 'id'>, user: CurrentUser) {
  const inv = findInvoice(s, id);
  const delivery: DeliveryAttempt = { ...attempt, id: uid('dl') };
  const delivered = delivery.result === 'delivered';
  const invoice: Invoice = {
    ...inv,
    lifecycle: delivered && inv.lifecycle === 'draft' ? 'sent' : inv.lifecycle,
    sentAt: delivered ? (inv.sentAt ?? delivery.at) : inv.sentAt,
    deliveries: [...inv.deliveries, delivery],
    updatedAt: delivery.at,
    version: inv.version + 1,
    activity: [...inv.activity, {
      id: uid('act'), at: delivery.at,
      type: delivered ? 'sent' : 'delivery_failed',
      message: delivered ? `Emailed to ${delivery.to} by ${user.name}` : `Email to ${delivery.to} not sent: ${delivery.detail}`,
    }],
  };
  return { snapshot: { ...s, invoices: s.invoices.map((i) => (i.id === id ? invoice : i)) }, invoice, delivery };
}

/** User confirms they delivered the invoice themselves (e.g. downloaded PDF and emailed it). */
export function opMarkSent(s: BillingSnapshot, id: string, user: CurrentUser, now = new Date()) {
  assertWriter(user);
  const inv = opAssertSendable(s, id, findInvoice(s, id).billTo.email);
  if (inv.lifecycle !== 'draft') return { snapshot: s, invoice: inv };
  const at = now.toISOString();
  const invoice: Invoice = {
    ...inv, lifecycle: 'sent', sentAt: at, updatedAt: at, version: inv.version + 1,
    activity: [...inv.activity, { id: uid('act'), at, type: 'marked_sent', message: `Marked as sent by ${user.name} (delivered outside the app)` }],
  };
  return { snapshot: { ...s, invoices: s.invoices.map((i) => (i.id === id ? invoice : i)) }, invoice };
}

export function opRecordPayment(
  s: BillingSnapshot,
  input: Omit<Payment, 'id' | 'receiptNumber' | 'createdAt' | 'recordedBy' | 'source'>,
  user: CurrentUser,
  now = new Date(),
) {
  assertWriter(user);
  const inv = findInvoice(s, input.invoiceId);
  if (inv.lifecycle === 'draft') throw new DomainError('Send the invoice (or mark it sent) before recording payments.', 'conflict');
  if (inv.lifecycle === 'void') throw new DomainError('Payments can’t be recorded on a void invoice.', 'conflict');
  if (input.currency !== inv.currency) throw new DomainError(`Payments must be in ${inv.currency}.`, 'validation', { amount: `Use ${inv.currency}.` });
  const view = buildInvoiceView(inv, s.payments, todayISO(now));
  const errors = validatePayment(input, { balanceDue: view.totals.balanceDue, issueDate: inv.issueDate, today: todayISO(now) });
  if (!['confirmed', 'pending'].includes(input.status)) errors.status = 'Choose confirmed or pending.';
  if (hasErrors(errors)) throw new DomainError('Check the payment details.', 'validation', errors);

  const minor = toMinor(input.amount, inv.currency)!;
  const at = now.toISOString();
  const nextReceipt = 5001 + s.payments.length;
  const payment: Payment = {
    ...input,
    amount: minorToDecimalString(minor, inv.currency), // canonical form
    id: uid('pay'),
    receiptNumber: `RCT-${nextReceipt}`,
    source: 'manual',
    recordedBy: user.name,
    createdAt: at,
  };
  const invoice: Invoice = {
    ...inv, updatedAt: at, version: inv.version + 1,
    activity: [...inv.activity, {
      id: uid('act'), at, type: 'payment_recorded',
      message: `${payment.status === 'confirmed' ? 'Payment' : 'Pending payment'} of ${payment.amount} ${payment.currency} recorded by ${user.name}`,
    }],
  };
  return {
    snapshot: { ...s, payments: [...s.payments, payment], invoices: s.invoices.map((i) => (i.id === inv.id ? invoice : i)) },
    payment, invoice,
  };
}

export function opSaveClient(s: BillingSnapshot, client: Client, user: CurrentUser, now = new Date()) {
  assertWriter(user);
  const errors = validateClient(client);
  const dup = s.clients.find((c) => c.id !== client.id && !c.archived && c.email.trim().toLowerCase() === client.email.trim().toLowerCase());
  if (dup && !errors.email) errors.email = `${dup.name} already uses this email.`;
  if (hasErrors(errors)) throw new DomainError('Fix the highlighted fields.', 'validation', errors);
  const at = now.toISOString();
  const existing = s.clients.find((c) => c.id === client.id);
  const saved: Client = { ...client, createdAt: existing?.createdAt ?? at, updatedAt: at };
  const clients = existing ? s.clients.map((c) => (c.id === saved.id ? saved : c)) : [...s.clients, saved];
  return { snapshot: { ...s, clients }, client: saved };
}

export function opArchiveClient(s: BillingSnapshot, id: string, archived: boolean, user: CurrentUser) {
  assertWriter(user);
  const c = s.clients.find((x) => x.id === id);
  if (!c) throw new DomainError('That client no longer exists.', 'not_found');
  const client = { ...c, archived, updatedAt: new Date().toISOString() };
  return { snapshot: { ...s, clients: s.clients.map((x) => (x.id === id ? client : x)) }, client };
}
