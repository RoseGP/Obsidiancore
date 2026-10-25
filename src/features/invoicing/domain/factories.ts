import { addDays, todayISO } from './status';
import type {
  BillToSnapshot, BusinessSettings, Client, Fee, Installment, Invoice, InvoiceKind, LineItem,
  RecurringSchedule,
} from './types';
import { emptyAddress } from './types';

export function uid(prefix = 'id'): string {
  const rand = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
    : Math.random().toString(36).slice(2, 14);
  return `${prefix}_${rand}`;
}

export const emptyBillTo = (): BillToSnapshot => ({
  name: '', company: '', email: '', phone: '', address: emptyAddress(), taxIdLabel: '', taxId: '',
});

export function billToFromClient(c: Client): BillToSnapshot {
  return {
    name: c.name, company: c.company, email: c.email, phone: c.phone,
    address: { ...c.address }, taxIdLabel: c.taxIdLabel, taxId: c.taxId,
  };
}

export const newLineItem = (taxRate = ''): LineItem => ({
  id: uid('li'), name: '', description: '', quantity: '1', unitPrice: '', taxRate,
});

export const newFee = (): Fee => ({ id: uid('fee'), label: '', amount: '' });

export function defaultInstallments(issueDate: string, dueDate: string): Installment[] {
  return [
    { id: uid('ins'), label: 'Deposit', percent: '50', dueDate: issueDate },
    { id: uid('ins'), label: 'Final payment', percent: '50', dueDate },
  ];
}

export function defaultRecurring(issueDate: string, termsDays: number): RecurringSchedule {
  return {
    frequency: 'monthly', startDate: issueDate, endType: 'never', occurrences: '12',
    endDate: '', dueInDays: String(termsDays),
  };
}

/** Next number in the prefix sequence, e.g. INV-2026-0043. */
export function nextInvoiceNumber(prefix: string, existing: string[]): string {
  const re = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)$`, 'i');
  let max = 0;
  let width = 4;
  for (const n of existing) {
    const m = re.exec(n.trim());
    if (m) {
      max = Math.max(max, Number(m[1]));
      width = Math.max(width, m[1].length);
    }
  }
  return `${prefix}${String(max + 1).padStart(width, '0')}`;
}

export function createInvoice(settings: BusinessSettings, existingNumbers: string[], kind: InvoiceKind = 'standard'): Invoice {
  const issueDate = todayISO();
  const dueDate = addDays(issueDate, settings.defaultTermsDays);
  const now = new Date().toISOString();
  return {
    id: uid('inv'),
    number: nextInvoiceNumber(settings.invoicePrefix, existingNumbers),
    kind,
    lifecycle: 'draft',
    clientId: null,
    billTo: emptyBillTo(),
    issuer: { ...settings.issuer, address: { ...settings.issuer.address } },
    issueDate,
    dueDate,
    currency: settings.defaultCurrency,
    items: [newLineItem(settings.defaultTaxRate)],
    discount: { type: 'percent', value: '' },
    fees: [],
    installments: kind === 'split' ? defaultInstallments(issueDate, dueDate) : [],
    recurring: kind === 'recurring' ? defaultRecurring(issueDate, settings.defaultTermsDays) : null,
    paymentInstructions: settings.paymentInstructions,
    notes: settings.defaultNotes,
    signature: { ...settings.signature, enabled: false },
    deliveries: [],
    activity: [],
    createdAt: now,
    updatedAt: now,
    sentAt: null,
    viewedAt: null,
    voidedAt: null,
    version: 0,
  };
}

/** Copy as a new draft: fresh id/number/dates, no payments or delivery history. */
export function duplicateInvoice(source: Invoice, settings: BusinessSettings, existingNumbers: string[]): Invoice {
  const base = createInvoice(settings, existingNumbers, source.kind);
  return {
    ...base,
    clientId: source.clientId,
    billTo: { ...source.billTo, address: { ...source.billTo.address } },
    issuer: { ...source.issuer, address: { ...source.issuer.address } },
    currency: source.currency,
    items: source.items.map((i) => ({ ...i, id: uid('li') })),
    discount: { ...source.discount },
    fees: source.fees.map((f) => ({ ...f, id: uid('fee') })),
    installments: source.kind === 'split'
      ? source.installments.map((i) => ({ ...i, id: uid('ins') }))
      : [],
    recurring: source.recurring ? { ...source.recurring, startDate: base.issueDate } : null,
    paymentInstructions: source.paymentInstructions,
    notes: source.notes,
    signature: { ...source.signature },
    activity: [{ id: uid('act'), at: base.createdAt, type: 'duplicated', message: `Duplicated from ${source.number}` }],
  };
}
