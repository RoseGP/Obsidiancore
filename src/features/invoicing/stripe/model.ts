/**
 * Stripe Connect billing model, shared by server and client. Pure: no Stripe SDK,
 * no I/O. Amounts are integers in the currency's minor unit (cents), as Stripe uses.
 */
import { calculateInvoice } from '../domain/calc';
import { currencyInfo } from '../domain/money';
import type { Invoice } from '../domain/types';

export type ConnectionStatus = 'disconnected' | 'pending_verification' | 'connected' | 'restricted';

export interface StripeAccountInfo {
  accountId: string;
  businessName: string;
  email: string;
  country: string;
  defaultCurrency: string;
  dashboardType: 'standard' | 'express' | 'custom' | 'unknown';
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  /** Requirements Stripe still needs (field names, e.g. "external_account"). */
  requirementsDue: string[];
  disabledReason: string | null;
  livemode: boolean;
}

export interface StripeConnection {
  status: ConnectionStatus;
  account: StripeAccountInfo | null;
  /** How the account was linked. */
  method: 'oauth' | 'onboarding' | null;
  connectedAt: string | null;
  updatedAt: string | null;
  lastSyncAt: string | null;
  lastWebhookAt: string | null;
  disconnectedAt: string | null;
}

export const emptyConnection = (): StripeConnection => ({
  status: 'disconnected', account: null, method: null, connectedAt: null, updatedAt: null,
  lastSyncAt: null, lastWebhookAt: null, disconnectedAt: null,
});

/** Mirrors Stripe's own guidance: details submitted + charges enabled = ready. */
export function deriveConnectionStatus(a: Pick<StripeAccountInfo, 'chargesEnabled' | 'detailsSubmitted' | 'disabledReason' | 'requirementsDue'>): ConnectionStatus {
  if (a.disabledReason && a.disabledReason !== 'requirements.pending_verification' && a.detailsSubmitted) return 'restricted';
  if (!a.detailsSubmitted || !a.chargesEnabled) return 'pending_verification';
  return 'connected';
}

export const CONNECTION_LABEL: Record<ConnectionStatus, string> = {
  disconnected: 'Disconnected',
  pending_verification: 'Pending verification',
  connected: 'Connected',
  restricted: 'Restricted',
};

/** Normalises a Stripe Account object (SDK shape) into what the CRM stores and shows. */
export function toAccountInfo(acc: any): StripeAccountInfo {
  return {
    accountId: String(acc?.id ?? ''),
    businessName: String(acc?.business_profile?.name || acc?.settings?.dashboard?.display_name || acc?.email || 'Stripe account'),
    email: String(acc?.email ?? ''),
    country: String(acc?.country ?? ''),
    defaultCurrency: String(acc?.default_currency ?? '').toUpperCase(),
    dashboardType: (['standard', 'express', 'custom'].includes(acc?.type) ? acc.type : 'unknown'),
    chargesEnabled: Boolean(acc?.charges_enabled),
    payoutsEnabled: Boolean(acc?.payouts_enabled),
    detailsSubmitted: Boolean(acc?.details_submitted),
    requirementsDue: [...new Set<string>([...(acc?.requirements?.currently_due ?? []), ...(acc?.requirements?.past_due ?? [])])].slice(0, 20),
    disabledReason: acc?.requirements?.disabled_reason ?? null,
    livemode: Boolean(acc?.livemode ?? false),
  };
}

// ---------- Invoices ----------

export type StripeInvoiceStatus = 'draft' | 'open' | 'paid' | 'uncollectible' | 'void';

/** Link between a CRM invoice and the Stripe invoice created for it on the connected account. */
export interface StripeInvoiceLink {
  crmInvoiceId: string;
  stripeInvoiceId: string;
  stripeCustomerId: string;
  status: StripeInvoiceStatus;
  hostedInvoiceUrl: string | null;
  invoicePdf: string | null;
  amountDue: number;
  amountPaid: number;
  currency: string;
  /** CRM invoice version the Stripe invoice was built from. */
  crmVersion: number;
  createdAt: string;
  updatedAt: string;
  /** Stripe sent the invoice email itself. */
  sentByStripe: boolean;
}

export interface StripeLineDraft {
  description: string;
  /** Minor units; always > 0. */
  amount: number;
}

/**
 * Maps a CRM invoice onto Stripe invoice items so the Stripe total equals the CRM
 * total to the cent: one item per line (after its share of any discount), one per
 * tax rate, one per fee. Uses the CRM's own calculator (BigInt, no rounding drift).
 */
export function buildStripeLines(inv: Invoice): { lines: StripeLineDraft[]; total: number; currency: string } {
  const t = calculateInvoice({ currency: inv.currency, items: inv.items, discount: inv.discount, fees: inv.fees });
  const lines: StripeLineDraft[] = [];
  inv.items.forEach((item, i) => {
    const r = t.lines[i];
    if (!r || r.taxable <= 0n) return;
    const qty = item.quantity && item.quantity !== '1' ? ` × ${item.quantity}` : '';
    const disc = r.discountShare > 0n ? ' (after discount)' : '';
    lines.push({ description: `${item.name || 'Item'}${qty}${disc}`.slice(0, 500), amount: Number(r.taxable) });
  });
  for (const g of t.taxGroups) {
    if (g.tax <= 0n) continue;
    const pct = formatRate(g.rate);
    lines.push({ description: `Tax ${pct}%`, amount: Number(g.tax) });
  }
  for (const f of t.fees) if (f.amount > 0n) lines.push({ description: (f.label || 'Fee').slice(0, 500), amount: Number(f.amount) });
  const total = lines.reduce((s, l) => s + l.amount, 0);
  return { lines, total, currency: inv.currency.toLowerCase() };
}

function formatRate(scaled: bigint): string {
  const whole = scaled / 1000n;
  const frac = (scaled % 1000n).toString().padStart(3, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : `${whole}`;
}

/** Minor-unit integer → decimal string in the currency ("1234" USD → "12.34"). */
export function minorToDecimal(amount: number, currency: string): string {
  const d = currencyInfo(currency.toUpperCase()).decimals;
  const neg = amount < 0;
  const s = Math.abs(Math.round(amount)).toString().padStart(d + 1, '0');
  const out = d ? `${s.slice(0, -d)}.${s.slice(-d)}` : s;
  return neg ? `-${out}` : out;
}

/** Decimal string → minor units, or null if invalid / too many decimals. */
export function decimalToMinor(value: string, currency: string): number | null {
  const d = currencyInfo(currency.toUpperCase()).decimals;
  const m = /^\s*(\d+)(?:\.(\d+))?\s*$/.exec(value);
  if (!m) return null;
  const frac = m[2] ?? '';
  if (frac.length > d) return null;
  return Number(m[1]) * 10 ** d + Number((frac.padEnd(d, '0') || '0'));
}

// ---------- Subscriptions ----------

export type BillingInterval = 'week' | 'month' | 'quarter' | 'year';
export type SubscriptionStatus = 'incomplete' | 'incomplete_expired' | 'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid' | 'paused';

export interface CrmSubscription {
  id: string; // Stripe subscription id
  clientId: string | null;
  customerId: string;
  customerName: string;
  customerEmail: string;
  planName: string;
  /** Per interval, minor units. */
  unitAmount: number;
  quantity: number;
  currency: string;
  interval: BillingInterval;
  status: SubscriptionStatus;
  currentPeriodEnd: string | null;
  trialEnd: string | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
  latestInvoiceUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export const SUBSCRIPTION_STATUS_LABEL: Record<SubscriptionStatus, string> = {
  incomplete: 'Awaiting first payment', incomplete_expired: 'Expired', trialing: 'Trial', active: 'Active',
  past_due: 'Past due', canceled: 'Canceled', unpaid: 'Unpaid', paused: 'Paused',
};

/** Stripe recurring params for our interval names (quarter = every 3 months). */
export function stripeRecurring(interval: BillingInterval): { interval: 'week' | 'month' | 'year'; interval_count: number } {
  return interval === 'quarter' ? { interval: 'month', interval_count: 3 } : { interval, interval_count: 1 };
}

export function fromStripeRecurring(r: { interval?: string; interval_count?: number } | null | undefined): BillingInterval {
  if (!r) return 'month';
  if (r.interval === 'month' && r.interval_count === 3) return 'quarter';
  return (['week', 'month', 'year'].includes(r.interval as string) ? r.interval : 'month') as BillingInterval;
}

/** Monthly recurring revenue for one subscription, minor units (rounded). */
export function monthlyValue(s: Pick<CrmSubscription, 'unitAmount' | 'quantity' | 'interval'>): number {
  const per = s.unitAmount * s.quantity;
  switch (s.interval) {
    case 'week': return Math.round((per * 52) / 12);
    case 'month': return per;
    case 'quarter': return Math.round(per / 3);
    case 'year': return Math.round(per / 12);
  }
}

/** Still running: active, in trial, or past due. */
export const isBillingSubscription = (s: Pick<CrmSubscription, 'status'>) => ['active', 'trialing', 'past_due'].includes(s.status);
/** Counts toward MRR: being billed now (trials aren't billed yet). */
export const countsTowardMrr = (s: Pick<CrmSubscription, 'status'>) => s.status === 'active' || s.status === 'past_due';

/** MRR grouped by currency (subscriptions in different currencies aren't summed together). */
export function mrrByCurrency(subs: CrmSubscription[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of subs) if (countsTowardMrr(s)) out[s.currency] = (out[s.currency] ?? 0) + monthlyValue(s);
  return out;
}

/** Normalises a Stripe Subscription (SDK shape). */
export function toCrmSubscription(sub: any, clientId: string | null, now = new Date()): CrmSubscription {
  const item = sub?.items?.data?.[0];
  const price = item?.price;
  const customer = typeof sub?.customer === 'object' ? sub.customer : null;
  const ts = (v: number | null | undefined) => (v ? new Date(v * 1000).toISOString() : null);
  const periodEnd = item?.current_period_end ?? sub?.current_period_end;
  const latest = typeof sub?.latest_invoice === 'object' ? sub.latest_invoice : null;
  return {
    id: String(sub?.id ?? ''),
    clientId: clientId ?? (sub?.metadata?.crm_client_id || null),
    customerId: String(customer?.id ?? sub?.customer ?? ''),
    customerName: String(customer?.name ?? sub?.metadata?.crm_customer_name ?? ''),
    customerEmail: String(customer?.email ?? sub?.metadata?.crm_customer_email ?? ''),
    planName: String(sub?.metadata?.crm_plan_name || price?.nickname || 'Subscription'),
    unitAmount: Number(price?.unit_amount ?? 0),
    quantity: Number(item?.quantity ?? 1),
    currency: String(price?.currency ?? sub?.currency ?? 'usd').toUpperCase(),
    interval: fromStripeRecurring(price?.recurring),
    status: (sub?.status ?? 'incomplete') as SubscriptionStatus,
    currentPeriodEnd: ts(periodEnd),
    trialEnd: ts(sub?.trial_end),
    cancelAtPeriodEnd: Boolean(sub?.cancel_at_period_end),
    canceledAt: ts(sub?.canceled_at),
    latestInvoiceUrl: latest?.hosted_invoice_url ?? null,
    createdAt: ts(sub?.created) ?? now.toISOString(),
    updatedAt: now.toISOString(),
  };
}
