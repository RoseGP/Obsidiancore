import type { CurrencyCode } from './money';

/** ISO calendar date, yyyy-mm-dd. Dates are compared as strings. */
export type ISODate = string;
/** ISO timestamp. */
export type ISODateTime = string;

export interface Address {
  line1: string;
  line2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

export const emptyAddress = (): Address => ({
  line1: '', line2: '', city: '', state: '', postalCode: '', country: '',
});

export interface Client {
  id: string;
  name: string;
  company: string;
  email: string;
  phone: string;
  address: Address;
  taxIdLabel: string; // e.g. "VAT", "EIN", "GSTIN"
  taxId: string;
  notes: string;
  archived: boolean;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

/** Copy of the client's details frozen onto the invoice at the time of billing. */
export interface BillToSnapshot {
  name: string;
  company: string;
  email: string;
  phone: string;
  address: Address;
  taxIdLabel: string;
  taxId: string;
}

export interface IssuerSnapshot {
  name: string;
  email: string;
  phone: string;
  website: string;
  address: Address;
  taxIdLabel: string;
  taxId: string;
  logoDataUrl: string;
}

export interface LineItem {
  id: string;
  name: string;
  description: string;
  /** Decimal string, up to 3 dp. */
  quantity: string;
  /** Decimal string in major units, up to the currency's decimals. */
  unitPrice: string;
  /** Percentage as decimal string, up to 3 dp ("7.5"). */
  taxRate: string;
}

export type DiscountType = 'percent' | 'fixed';

export interface Discount {
  type: DiscountType;
  /** Percentage (up to 3 dp) or fixed amount in major units. Empty = none. */
  value: string;
}

export interface Fee {
  id: string;
  label: string;
  amount: string;
}

export type InvoiceKind = 'standard' | 'split' | 'recurring';

export interface Installment {
  id: string;
  label: string;
  /** Share of grand total in percent (up to 3 dp). */
  percent: string;
  dueDate: ISODate;
}

export type RecurringFrequency = 'weekly' | 'monthly' | 'quarterly' | 'yearly';

export interface RecurringSchedule {
  frequency: RecurringFrequency;
  startDate: ISODate;
  endType: 'never' | 'after' | 'on';
  occurrences: string;
  endDate: ISODate;
  /** Days after each issue date the generated invoice is due. */
  dueInDays: string;
}

export interface Signature {
  enabled: boolean;
  name: string;
  title: string;
  imageDataUrl: string;
}

/**
 * Stored lifecycle. Payment-derived states (partially paid, paid, overdue)
 * are never stored; they are computed from payments and dates.
 */
export type InvoiceLifecycle = 'draft' | 'sent' | 'viewed' | 'void';

/** Status shown to users. */
export type InvoiceStatus =
  | 'draft' | 'sent' | 'viewed' | 'partially_paid' | 'paid' | 'overdue' | 'void';

export type PaymentState = 'unpaid' | 'partial' | 'paid';

export type DeliveryResult = 'delivered' | 'failed' | 'not_configured';

export interface DeliveryAttempt {
  id: string;
  at: ISODateTime;
  to: string;
  cc: string;
  subject: string;
  result: DeliveryResult;
  detail: string;
  provider: string;
}

export interface ActivityEntry {
  id: string;
  at: ISODateTime;
  type:
    | 'created' | 'updated' | 'sent' | 'marked_sent' | 'viewed' | 'payment_recorded'
    | 'delivery_failed' | 'voided' | 'duplicated';
  message: string;
}

export interface Invoice {
  id: string;
  number: string;
  kind: InvoiceKind;
  lifecycle: InvoiceLifecycle;
  clientId: string | null;
  billTo: BillToSnapshot;
  issuer: IssuerSnapshot;
  issueDate: ISODate;
  dueDate: ISODate;
  currency: CurrencyCode;
  items: LineItem[];
  discount: Discount;
  fees: Fee[];
  installments: Installment[];
  recurring: RecurringSchedule | null;
  paymentInstructions: string;
  notes: string;
  signature: Signature;
  deliveries: DeliveryAttempt[];
  activity: ActivityEntry[];
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  sentAt: ISODateTime | null;
  viewedAt: ISODateTime | null;
  voidedAt: ISODateTime | null;
  /** Incremented on every save; used for optimistic concurrency. */
  version: number;
}

export type PaymentMethod = 'bank_transfer' | 'card' | 'cash' | 'check' | 'mobile_money' | 'other';

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  bank_transfer: 'Bank transfer',
  card: 'Card',
  cash: 'Cash',
  check: 'Check',
  mobile_money: 'Mobile money',
  other: 'Other',
};

/**
 * confirmed: an authorized user or the payment provider confirmed the funds.
 * pending:   recorded but awaiting confirmation (e.g. check not yet cleared).
 * failed:    the provider reported a failure.
 * Only confirmed payments reduce the balance.
 */
export type PaymentStatus = 'confirmed' | 'pending' | 'failed';

export interface Payment {
  id: string;
  receiptNumber: string;
  invoiceId: string;
  amount: string; // major units decimal string
  currency: CurrencyCode;
  date: ISODate;
  method: PaymentMethod;
  reference: string;
  note: string;
  status: PaymentStatus;
  source: 'manual' | 'provider';
  recordedBy: string;
  createdAt: ISODateTime;
}

export interface BusinessSettings {
  issuer: IssuerSnapshot;
  invoicePrefix: string;
  defaultCurrency: CurrencyCode;
  defaultTermsDays: number;
  defaultTaxRate: string;
  paymentInstructions: string;
  defaultNotes: string;
  signature: Signature;
}

export interface BillingSnapshot {
  clients: Client[];
  invoices: Invoice[];
  payments: Payment[];
  settings: BusinessSettings;
}

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  role: 'owner' | 'admin' | 'accountant' | 'viewer';
}
