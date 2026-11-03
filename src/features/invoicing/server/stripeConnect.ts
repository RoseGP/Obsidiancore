/**
 * Stripe Connect for billing (server only).
 *
 * Each CRM business connects its own Stripe account (Connect OAuth for an existing
 * account, or Stripe-hosted onboarding for a new Standard account). All calls run
 * on the platform secret key with `{ stripeAccount }`, so money moves on the
 * business's own account and the CRM never stores account secrets.
 *
 * Tenant isolation: the connected account id is only ever read from the caller's
 * own business record; webhooks are routed by `event.account` through the
 * account → business index and cross-checked against invoice metadata.
 */
import crypto from 'node:crypto';
import Stripe from 'stripe';
import { createInvoice, uid } from '../domain/factories';
import { buildInvoiceView, todayISO, daysBetween } from '../domain/status';
import type { BillingSnapshot, Client, Invoice, Payment } from '../domain/types';
import { loadSnapshot, withSnapshot } from './store';
import {
  businessForAccount, linkAccount, loadStripeState, markProcessed, unlinkAccount, withStripeState,
  type StripeBusinessState,
} from './stripeStore';
import {
  buildStripeLines, decimalToMinor, deriveConnectionStatus, minorToDecimal, stripeRecurring, toAccountInfo, toCrmSubscription,
  type BillingInterval, type CrmSubscription, type StripeConnection, type StripeInvoiceLink, type StripeInvoiceStatus,
} from '../stripe/model';

// ---------- Configuration ----------

export function stripeConfig() {
  const secretKey = process.env.STRIPE_SECRET_KEY || '';
  return {
    secretKey,
    clientId: process.env.STRIPE_CONNECT_CLIENT_ID || process.env.STRIPE_CLIENT_ID || '',
    webhookSecret: process.env.STRIPE_CONNECT_WEBHOOK_SECRET || '',
    appUrl: (process.env.APP_URL || '').replace(/\/+$/, ''),
    stateSecret: process.env.OAUTH_STATE_SECRET || process.env.JWT_SECRET || '',
    applicationFeePercent: Number(process.env.STRIPE_APPLICATION_FEE_PERCENT || 0),
    livemode: secretKey.startsWith('sk_live_'),
  };
}

export interface SetupStatus {
  apiKey: boolean;
  oauth: boolean;
  webhook: boolean;
  stateSecret: boolean;
  appUrl: boolean;
  livemode: boolean;
  missing: string[];
}

export function setupStatus(): SetupStatus {
  const c = stripeConfig();
  const missing: string[] = [];
  if (!c.secretKey) missing.push('STRIPE_SECRET_KEY');
  if (!c.clientId) missing.push('STRIPE_CONNECT_CLIENT_ID');
  if (!c.webhookSecret) missing.push('STRIPE_CONNECT_WEBHOOK_SECRET');
  if (!c.stateSecret) missing.push('OAUTH_STATE_SECRET');
  return { apiKey: !!c.secretKey, oauth: !!c.clientId, webhook: !!c.webhookSecret, stateSecret: !!c.stateSecret, appUrl: !!c.appUrl, livemode: c.livemode, missing };
}

export class StripeConnectError extends Error {
  constructor(message: string, public code: 'not_configured' | 'not_connected' | 'validation' | 'conflict' | 'forbidden' | 'not_found' | 'provider', public status = 400) {
    super(message);
  }
}

/** Minimal surface of the Stripe SDK we use (lets tests pass a fake). */
export type StripeLike = Pick<Stripe, 'accounts' | 'accountLinks' | 'oauth' | 'customers' | 'invoices' | 'invoiceItems' | 'subscriptions' | 'products' | 'webhooks'>;

let factory: (() => StripeLike) | null = null;
let cached: StripeLike | null = null;
/** Tests only. */
export function setStripeClientFactory(f: (() => StripeLike) | null) { factory = f; cached = null; }

function stripe(): StripeLike {
  if (factory) return (cached ??= factory());
  const { secretKey } = stripeConfig();
  if (!secretKey) throw new StripeConnectError('Stripe isn’t set up on this server yet. Add STRIPE_SECRET_KEY.', 'not_configured', 503);
  return (cached ??= new Stripe(secretKey, { appInfo: { name: 'Obsidian CRM Billing' } }) as unknown as StripeLike);
}

const providerError = (err: any, fallback: string) =>
  new StripeConnectError(err?.raw?.message || err?.message || fallback, 'provider', err?.statusCode && err.statusCode < 500 ? 400 : 502);

// ---------- Signed, single-use OAuth state ----------

const usedNonces = new Map<string, number>();

export function signState(payload: { businessId: string; userId: string; returnTo?: string }, now = Date.now()): string {
  const { stateSecret } = stripeConfig();
  if (!stateSecret) throw new StripeConnectError('Set OAUTH_STATE_SECRET to connect Stripe accounts.', 'not_configured', 503);
  const body = Buffer.from(JSON.stringify({ ...payload, n: crypto.randomBytes(12).toString('hex'), exp: now + 10 * 60_000 })).toString('base64url');
  const sig = crypto.createHmac('sha256', stateSecret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyState(state: string, now = Date.now()): { businessId: string; userId: string; returnTo?: string } {
  const { stateSecret } = stripeConfig();
  const [body, sig] = String(state || '').split('.');
  if (!stateSecret || !body || !sig) throw new StripeConnectError('The Stripe authorization link is invalid. Start again.', 'validation');
  const expected = crypto.createHmac('sha256', stateSecret).update(body).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new StripeConnectError('The Stripe authorization link is invalid. Start again.', 'validation');
  const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  if (typeof data.exp !== 'number' || data.exp < now) throw new StripeConnectError('The Stripe authorization took too long. Start again.', 'validation');
  if (usedNonces.has(data.n)) throw new StripeConnectError('This Stripe authorization link was already used. Start again.', 'validation');
  usedNonces.set(data.n, data.exp);
  for (const [n, exp] of usedNonces) if (exp < now) usedNonces.delete(n);
  return { businessId: String(data.businessId), userId: String(data.userId), returnTo: data.returnTo };
}

const appBase = (origin: string) => stripeConfig().appUrl || origin.replace(/\/+$/, '');
export const oauthRedirectUri = (origin: string) => `${appBase(origin)}/api/billing-stripe/oauth/callback`;
export const appReturnUrl = (origin: string, result: string) => `${appBase(origin)}/?view=proposals&subtab=invoicing&billing=stripe&stripe=${encodeURIComponent(result)}`;

// ---------- Connection ----------

export interface PublicStripeState {
  setup: SetupStatus;
  connection: StripeConnection;
  invoices: Record<string, StripeInvoiceLink>;
  subscriptions: CrmSubscription[];
}

export async function getPublicState(businessId: string): Promise<PublicStripeState> {
  const s = await loadStripeState(businessId);
  return {
    setup: setupStatus(),
    connection: s.connection,
    invoices: s.invoices,
    subscriptions: Object.values(s.subscriptions).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  };
}

function requireConnected(s: StripeBusinessState, opts: { charges?: boolean } = {}): string {
  const acc = s.connection.account;
  if (!acc || s.connection.status === 'disconnected') throw new StripeConnectError('Connect your Stripe account first.', 'not_connected', 409);
  if (opts.charges && !acc.chargesEnabled) {
    throw new StripeConnectError('Stripe hasn’t enabled payments on this account yet. Finish verification in Stripe, then sync.', 'not_connected', 409);
  }
  return acc.accountId;
}

export function createOAuthUrl(businessId: string, userId: string, origin: string): string {
  const c = stripeConfig();
  if (!c.clientId) throw new StripeConnectError('Stripe Connect OAuth isn’t set up. Add STRIPE_CONNECT_CLIENT_ID (your platform’s ca_… id).', 'not_configured', 503);
  const state = signState({ businessId, userId });
  const q = new URLSearchParams({ response_type: 'code', client_id: c.clientId, scope: 'read_write', state, redirect_uri: oauthRedirectUri(origin) });
  return `https://connect.stripe.com/oauth/authorize?${q}`;
}

async function saveAccount(businessId: string, acc: any, method: 'oauth' | 'onboarding') {
  const info = toAccountInfo(acc);
  const link = await linkAccount(info.accountId, businessId);
  if (!link.ok) throw new StripeConnectError('This Stripe account is already connected to another workspace.', 'conflict', 409);
  return withStripeState(businessId, (s) => {
    const now = new Date().toISOString();
    const sameAccount = s.connection.account?.accountId === info.accountId;
    const connection: StripeConnection = {
      ...s.connection,
      status: deriveConnectionStatus(info), account: info, method,
      connectedAt: sameAccount && s.connection.connectedAt ? s.connection.connectedAt : now,
      updatedAt: now, lastSyncAt: now, disconnectedAt: null,
    };
    // Customers belong to an account: a different account starts with a clean customer map.
    const state = { ...s, connection, customers: sameAccount ? s.customers : {} };
    return { state, result: connection };
  });
}

/** OAuth callback: exchange the code, link the account to the business from the signed state. */
export async function completeOAuth(code: string, state: string): Promise<{ businessId: string; connection: StripeConnection }> {
  const { businessId } = verifyState(state);
  let accountId: string;
  try {
    const token: any = await stripe().oauth.token({ grant_type: 'authorization_code', code });
    accountId = token.stripe_user_id;
  } catch (err) { throw providerError(err, 'Stripe didn’t accept the authorization.'); }
  if (!accountId) throw new StripeConnectError('Stripe didn’t return an account id.', 'provider', 502);
  const acc = await stripe().accounts.retrieve(accountId).catch((err) => { throw providerError(err, 'Couldn’t read the Stripe account.'); });
  const connection = await saveAccount(businessId, acc, 'oauth');
  return { businessId, connection };
}

/**
 * Stripe-hosted onboarding. Creates a Standard account for a business without one
 * (or continues onboarding for one created here) and returns the onboarding link.
 */
export async function startOnboarding(businessId: string, email: string, origin: string): Promise<string> {
  const s = await loadStripeState(businessId);
  let accountId = s.connection.account?.accountId;
  if (accountId && s.connection.method === 'oauth') {
    throw new StripeConnectError('This account was connected with OAuth. Finish verification in your Stripe Dashboard.', 'conflict', 409);
  }
  try {
    if (!accountId || s.connection.status === 'disconnected') {
      const acc: any = await stripe().accounts.create({ type: 'standard', ...(email ? { email } : {}), metadata: { crm_business_id: businessId } } as any);
      await saveAccount(businessId, acc, 'onboarding');
      accountId = acc.id;
    }
    const link: any = await stripe().accountLinks.create({
      account: accountId!, type: 'account_onboarding',
      refresh_url: appReturnUrl(origin, 'onboarding-refresh'), return_url: appReturnUrl(origin, 'onboarding-return'),
    });
    return link.url;
  } catch (err) {
    if (err instanceof StripeConnectError) throw err;
    throw providerError(err, 'Stripe couldn’t start onboarding.');
  }
}

export async function disconnect(businessId: string): Promise<StripeConnection> {
  const s = await loadStripeState(businessId);
  const acc = s.connection.account;
  if (acc && s.connection.method === 'oauth' && stripeConfig().clientId) {
    try { await stripe().oauth.deauthorize({ client_id: stripeConfig().clientId, stripe_user_id: acc.accountId }); }
    catch (err: any) { if (!/not connected|No such|invalid/i.test(err?.message ?? '')) throw providerError(err, 'Stripe couldn’t disconnect the account.'); }
  }
  if (acc) await unlinkAccount(acc.accountId, businessId);
  return withStripeState(businessId, (st) => {
    const now = new Date().toISOString();
    // Keep the account details and history so reconnecting the same account restores everything.
    const connection: StripeConnection = { ...st.connection, status: 'disconnected', updatedAt: now, disconnectedAt: now };
    return { state: { ...st, connection }, result: connection };
  });
}

// ---------- Sync ----------

export async function sync(businessId: string): Promise<PublicStripeState> {
  const s0 = await loadStripeState(businessId);
  const accountId = requireConnected(s0);
  const api = stripe();
  const acc = await api.accounts.retrieve(accountId).catch((err) => { throw providerError(err, 'Couldn’t read the Stripe account.'); });
  const info = toAccountInfo(acc);
  const invoices: any[] = [];
  for (const link of Object.values(s0.invoices)) {
    try { invoices.push(await api.invoices.retrieve(link.stripeInvoiceId, {}, { stripeAccount: accountId })); } catch { /* deleted in Stripe: keep last known */ }
  }
  let subs: any[] = [];
  try {
    const list: any = await api.subscriptions.list({ status: 'all', limit: 100, expand: ['data.customer', 'data.latest_invoice'] }, { stripeAccount: accountId });
    subs = list.data ?? [];
  } catch (err) { throw providerError(err, 'Couldn’t list subscriptions.'); }

  for (const inv of invoices) await applyStripeInvoice(businessId, accountId, inv);
  await withStripeState(businessId, (s) => {
    const now = new Date().toISOString();
    const clientByCustomer = Object.fromEntries(Object.entries(s.customers).map(([k, v]) => [v, k.startsWith('email:') ? null : k]));
    const subscriptions: Record<string, CrmSubscription> = {};
    for (const sub of subs) {
      const cid = typeof sub.customer === 'object' ? sub.customer?.id : sub.customer;
      subscriptions[sub.id] = toCrmSubscription(sub, clientByCustomer[cid] ?? null);
    }
    return { state: { ...s, subscriptions, connection: { ...s.connection, account: info, status: deriveConnectionStatus(info), lastSyncAt: now, updatedAt: now } }, result: null };
  });
  return getPublicState(businessId);
}

// ---------- Customers ----------

async function ensureCustomer(businessId: string, accountId: string, who: { clientId: string | null; name: string; email: string; company?: string }): Promise<string> {
  const key = who.clientId ?? `email:${who.email.toLowerCase()}`;
  const s = await loadStripeState(businessId);
  if (s.customers[key]) return s.customers[key];
  const cust: any = await stripe().customers.create({
    name: who.company || who.name || who.email,
    email: who.email || undefined,
    metadata: { crm_business_id: businessId, ...(who.clientId ? { crm_client_id: who.clientId } : {}), ...(who.company && who.name ? { contact_name: who.name } : {}) },
  }, { stripeAccount: accountId }).catch((err) => { throw providerError(err, 'Couldn’t create the customer in Stripe.'); });
  await withStripeState(businessId, (st) => ({ state: { ...st, customers: { ...st.customers, [key]: cust.id } }, result: null }));
  return cust.id;
}

// ---------- Invoices: CRM → Stripe ----------

function toLink(inv: any, crmInvoiceId: string, crmVersion: number, prev?: StripeInvoiceLink): StripeInvoiceLink {
  const now = new Date().toISOString();
  return {
    crmInvoiceId, stripeInvoiceId: inv.id,
    stripeCustomerId: typeof inv.customer === 'object' ? inv.customer.id : String(inv.customer ?? prev?.stripeCustomerId ?? ''),
    status: (inv.status ?? 'draft') as StripeInvoiceStatus,
    hostedInvoiceUrl: inv.hosted_invoice_url ?? prev?.hostedInvoiceUrl ?? null,
    invoicePdf: inv.invoice_pdf ?? prev?.invoicePdf ?? null,
    amountDue: Number(inv.amount_due ?? 0), amountPaid: Number(inv.amount_paid ?? 0),
    currency: String(inv.currency ?? '').toUpperCase(), crmVersion,
    createdAt: prev?.createdAt ?? now, updatedAt: now,
    sentByStripe: prev?.sentByStripe ?? false,
  };
}

/**
 * Creates (or reuses) a Stripe invoice for the CRM invoice's balance due and
 * returns its hosted payment page. Drafts are marked sent, since issuing a
 * payment link issues the invoice. Re-running after an edit replaces an unpaid
 * Stripe invoice built from an older version.
 */
export async function collectInvoice(businessId: string, crmInvoiceId: string, opts: { sendEmail: boolean; actor: string }): Promise<StripeInvoiceLink> {
  const st = await loadStripeState(businessId);
  const accountId = requireConnected(st, { charges: true });
  const snapshot = await loadSnapshot(businessId);
  const inv = snapshot.invoices.find((i) => i.id === crmInvoiceId);
  if (!inv) throw new StripeConnectError('Invoice not found.', 'not_found', 404);
  if (inv.lifecycle === 'void') throw new StripeConnectError('This invoice is void.', 'conflict', 409);
  if (!inv.billTo.email) throw new StripeConnectError('Add the client’s email address to the invoice first; Stripe sends receipts there.', 'validation', 422);
  const view = buildInvoiceView(inv, snapshot.payments, todayISO());
  const balance = Number(view.totals.balanceDue);
  if (balance <= 0) throw new StripeConnectError('This invoice has no balance due.', 'conflict', 409);

  const api = stripe();
  const existing = st.invoices[crmInvoiceId];
  if (existing && existing.status === 'open' && existing.crmVersion === inv.version && existing.amountDue === balance) {
    if (opts.sendEmail && !existing.sentByStripe) return sendViaStripe(businessId, crmInvoiceId);
    return existing;
  }
  if (existing && existing.status === 'paid') throw new StripeConnectError('This invoice was already paid through Stripe.', 'conflict', 409);
  if (existing && (existing.status === 'open' || existing.status === 'draft')) {
    // Built from an older version or amount: retire it so the client can't pay the wrong total.
    try {
      if (existing.status === 'open') await api.invoices.voidInvoice(existing.stripeInvoiceId, {}, { stripeAccount: accountId });
      else await api.invoices.del(existing.stripeInvoiceId, {}, { stripeAccount: accountId });
    } catch (err) { throw providerError(err, 'Couldn’t replace the earlier Stripe invoice.'); }
  }

  const customer = await ensureCustomer(businessId, accountId, { clientId: inv.clientId, name: inv.billTo.name, email: inv.billTo.email, company: inv.billTo.company });
  const full = buildStripeLines(inv);
  const lines = full.total === balance ? full.lines : [{ description: `Balance due on ${inv.number}`, amount: balance }];
  const daysUntilDue = Math.max(0, daysBetween(todayISO(), inv.dueDate || todayISO()));
  const feePct = stripeConfig().applicationFeePercent;
  const meta = { crm_business_id: businessId, crm_invoice_id: inv.id, crm_invoice_number: inv.number, crm_version: String(inv.version) };

  let created: any;
  try {
    created = await api.invoices.create({
      customer, collection_method: 'send_invoice', days_until_due: daysUntilDue, currency: full.currency,
      auto_advance: false, pending_invoice_items_behavior: 'exclude',
      description: inv.notes ? inv.notes.slice(0, 500) : undefined,
      footer: inv.paymentInstructions ? inv.paymentInstructions.slice(0, 500) : undefined,
      metadata: meta,
      ...(feePct > 0 ? { application_fee_amount: Math.floor((balance * feePct) / 100) } : {}),
    } as any, { stripeAccount: accountId, idempotencyKey: `crm-inv-${inv.id}-v${inv.version}-${balance}` });
    for (const [i, l] of lines.entries()) {
      await api.invoiceItems.create({ customer, invoice: created.id, currency: full.currency, amount: l.amount, description: l.description, metadata: meta } as any,
        { stripeAccount: accountId, idempotencyKey: `crm-item-${inv.id}-v${inv.version}-${balance}-${i}` });
    }
    created = await api.invoices.finalizeInvoice(created.id, {}, { stripeAccount: accountId });
  } catch (err) { throw providerError(err, 'Stripe couldn’t create the invoice.'); }

  if (Number(created.amount_due) !== balance) {
    await api.invoices.voidInvoice(created.id, {}, { stripeAccount: accountId }).catch(() => null);
    throw new StripeConnectError(`Stripe calculated ${minorToDecimal(Number(created.amount_due), inv.currency)} ${inv.currency} instead of ${minorToDecimal(balance, inv.currency)}. Nothing was charged; check tax settings in Stripe.`, 'provider', 502);
  }

  const link = toLink(created, inv.id, inv.version, existing);
  await withStripeState(businessId, (s) => ({ state: { ...s, invoices: { ...s.invoices, [inv.id]: link } }, result: null }));
  await withSnapshot(businessId, (s) => {
    const i = s.invoices.find((x) => x.id === inv.id)!;
    const at = new Date().toISOString();
    const lifecycle = i.lifecycle === 'draft' ? 'sent' : i.lifecycle;
    const next: Invoice = {
      ...i, lifecycle, sentAt: i.sentAt ?? (lifecycle === 'sent' ? at : null), updatedAt: at, version: i.version + 1,
      activity: [...i.activity, { id: uid('act'), at, type: 'updated', message: `Stripe payment link created by ${opts.actor} (${created.id})` }],
    };
    return { snapshot: { ...s, invoices: s.invoices.map((x) => (x.id === i.id ? next : x)) }, result: null };
  });
  // The CRM version moved on because of our own activity entry; keep the link in step.
  await withStripeState(businessId, (s) => ({ state: { ...s, invoices: { ...s.invoices, [inv.id]: { ...s.invoices[inv.id], crmVersion: inv.version + 1 } } }, result: null }));
  if (opts.sendEmail) return sendViaStripe(businessId, inv.id);
  return (await loadStripeState(businessId)).invoices[inv.id];
}

export async function sendViaStripe(businessId: string, crmInvoiceId: string): Promise<StripeInvoiceLink> {
  const st = await loadStripeState(businessId);
  const accountId = requireConnected(st, { charges: true });
  const link = st.invoices[crmInvoiceId];
  if (!link || link.status !== 'open') throw new StripeConnectError('Create the Stripe payment link first.', 'conflict', 409);
  const sent: any = await stripe().invoices.sendInvoice(link.stripeInvoiceId, {}, { stripeAccount: accountId }).catch((err) => { throw providerError(err, 'Stripe couldn’t email the invoice.'); });
  return withStripeState(businessId, (s) => {
    const next = { ...toLink(sent, crmInvoiceId, link.crmVersion, link), sentByStripe: true };
    return { state: { ...s, invoices: { ...s.invoices, [crmInvoiceId]: next } }, result: next };
  });
}

// ---------- Invoices: Stripe → CRM ----------

const STRIPE_SYSTEM = 'Stripe';

/**
 * Applies a Stripe invoice to the CRM: updates the link, records confirmed card
 * payments (idempotent on the Stripe invoice id), and imports invoices Stripe
 * generated itself (e.g. subscription renewals) as CRM invoices.
 */
export async function applyStripeInvoice(businessId: string, accountId: string, si: any): Promise<void> {
  const metaBiz = si?.metadata?.crm_business_id;
  if (metaBiz && metaBiz !== businessId) return; // never cross tenants
  let crmId: string | undefined = si?.metadata?.crm_invoice_id;
  const st = await loadStripeState(businessId);
  if (!crmId) crmId = Object.values(st.invoices).find((l) => l.stripeInvoiceId === si.id)?.crmInvoiceId;

  // Import Stripe-generated invoices (subscriptions) once they are finalized.
  if (!crmId) {
    if (!si?.subscription && !si?.parent?.subscription_details) return;
    if (si.status === 'draft') return;
    crmId = await importStripeInvoice(businessId, si);
    if (!crmId) return;
  }

  const prev = (await loadStripeState(businessId)).invoices[crmId];
  const link = toLink(si, crmId, prev?.crmVersion ?? 0, prev);
  await withStripeState(businessId, (s) => ({ state: { ...s, invoices: { ...s.invoices, [crmId!]: link } }, result: null }));

  const paidMinor = Number(si.amount_paid ?? 0);
  if (paidMinor <= 0) return;
  await withSnapshot(businessId, (s) => {
    const inv = s.invoices.find((i) => i.id === crmId);
    if (!inv) return { snapshot: s, result: null };
    const ref = `Stripe ${si.id}`;
    const already = s.payments.filter((p) => p.invoiceId === inv.id && p.source === 'provider' && p.reference === ref && p.status === 'confirmed')
      .reduce((t, p) => t + (decimalToMinor(p.amount, inv.currency) ?? 0), 0);
    const delta = paidMinor - already;
    if (delta <= 0) return { snapshot: s, result: null };
    return { snapshot: recordProviderPayment(s, inv, delta, ref, si), result: null };
  });
}

function recordProviderPayment(s: BillingSnapshot, inv: Invoice, minor: number, reference: string, si: any): BillingSnapshot {
  const at = new Date().toISOString();
  const paidAt = si?.status_transitions?.paid_at ? new Date(si.status_transitions.paid_at * 1000) : new Date();
  const payment: Payment = {
    id: uid('pay'), receiptNumber: `RCT-${5001 + s.payments.length}`, invoiceId: inv.id,
    amount: minorToDecimal(minor, inv.currency), currency: inv.currency, date: todayISO(paidAt), method: 'card',
    reference, note: si?.hosted_invoice_url ? 'Paid on the Stripe payment page.' : 'Paid through Stripe.',
    status: 'confirmed', source: 'provider', recordedBy: STRIPE_SYSTEM, createdAt: at,
  };
  const lifecycle = inv.lifecycle === 'draft' ? 'sent' : inv.lifecycle;
  const next: Invoice = {
    ...inv, lifecycle, sentAt: inv.sentAt ?? at, updatedAt: at, version: inv.version + 1,
    activity: [...inv.activity, { id: uid('act'), at, type: 'payment_recorded', message: `Stripe payment of ${payment.amount} ${payment.currency} confirmed` }],
  };
  return { ...s, payments: [...s.payments, payment], invoices: s.invoices.map((i) => (i.id === inv.id ? next : i)) };
}

async function importStripeInvoice(businessId: string, si: any): Promise<string | undefined> {
  const st = await loadStripeState(businessId);
  const customerId = typeof si.customer === 'object' ? si.customer?.id : si.customer;
  const clientKey = Object.entries(st.customers).find(([, v]) => v === customerId)?.[0];
  const clientId = clientKey && !clientKey.startsWith('email:') ? clientKey : null;
  const currency = String(si.currency ?? 'usd').toUpperCase();
  return withSnapshot(businessId, (s) => {
    const dupe = s.invoices.find((i) => i.activity.some((a) => a.message.includes(si.id)));
    if (dupe) return { snapshot: s, result: dupe.id };
    const base = createInvoice(s.settings, s.invoices.map((i) => i.number), 'standard');
    const client: Client | undefined = clientId ? s.clients.find((c) => c.id === clientId) : undefined;
    const issue = todayISO(si.created ? new Date(si.created * 1000) : new Date());
    const due = si.due_date ? todayISO(new Date(si.due_date * 1000)) : issue;
    const lines: any[] = si.lines?.data ?? [];
    const at = new Date().toISOString();
    const inv: Invoice = {
      ...base, clientId: client?.id ?? null, currency: currency as Invoice['currency'], issueDate: issue, dueDate: due,
      billTo: {
        ...base.billTo,
        name: client?.name ?? String(si.customer_name ?? ''), company: client?.company ?? '', email: client?.email ?? String(si.customer_email ?? ''),
        phone: client?.phone ?? '', address: client?.address ?? base.billTo.address, taxIdLabel: client?.taxIdLabel ?? '', taxId: client?.taxId ?? '',
      },
      items: (lines.length ? lines : [{ description: 'Subscription', amount: si.amount_due }]).map((l: any) => ({
        id: uid('li'), name: String(l.description || 'Subscription').slice(0, 200), description: '',
        quantity: '1', unitPrice: minorToDecimal(Number(l.amount ?? 0), currency), taxRate: '0',
      })),
      discount: { type: 'percent', value: '' }, fees: [], lifecycle: 'sent', sentAt: at,
      notes: 'Created automatically from a Stripe subscription invoice.',
      activity: [{ id: uid('act'), at, type: 'created', message: `Imported from Stripe ${si.id}` }],
    };
    return { snapshot: { ...s, invoices: [...s.invoices, inv] }, result: inv.id };
  });
}

// ---------- Subscriptions ----------

export interface CreateSubscriptionInput {
  clientId: string;
  planName: string;
  amount: string; // decimal, per interval
  currency: string;
  interval: BillingInterval;
  quantity: number;
  trialDays: number;
}

export async function createSubscription(businessId: string, input: CreateSubscriptionInput): Promise<CrmSubscription> {
  const st = await loadStripeState(businessId);
  const accountId = requireConnected(st, { charges: true });
  const snapshot = await loadSnapshot(businessId);
  const client = snapshot.clients.find((c) => c.id === input.clientId && !c.archived);
  if (!client) throw new StripeConnectError('Choose a client.', 'validation', 422);
  if (!client.email) throw new StripeConnectError('Add an email address to this client first.', 'validation', 422);
  const unit = decimalToMinor(input.amount, input.currency);
  if (!unit || unit <= 0) throw new StripeConnectError('Enter a price greater than zero.', 'validation', 422);
  if (!input.planName.trim()) throw new StripeConnectError('Name the plan.', 'validation', 422);
  const customer = await ensureCustomer(businessId, accountId, { clientId: client.id, name: client.name, email: client.email, company: client.company });
  const api = stripe();
  let sub: any;
  try {
    const product: any = await api.products.create({ name: input.planName.trim().slice(0, 120), metadata: { crm_business_id: businessId } }, { stripeAccount: accountId });
    sub = await api.subscriptions.create({
      customer,
      collection_method: 'send_invoice', days_until_due: snapshot.settings.defaultTermsDays || 30,
      items: [{ quantity: Math.max(1, Math.floor(input.quantity || 1)), price_data: { currency: input.currency.toLowerCase(), product: product.id, unit_amount: unit, recurring: stripeRecurring(input.interval) } }],
      ...(input.trialDays > 0 ? { trial_period_days: Math.min(730, Math.floor(input.trialDays)) } : {}),
      metadata: { crm_business_id: businessId, crm_client_id: client.id, crm_plan_name: input.planName.trim().slice(0, 120), crm_customer_name: client.company || client.name, crm_customer_email: client.email },
      expand: ['latest_invoice', 'customer'],
    } as any, { stripeAccount: accountId });
  } catch (err) { throw providerError(err, 'Stripe couldn’t create the subscription.'); }
  const crm = toCrmSubscription(sub, client.id);
  await withStripeState(businessId, (s) => ({ state: { ...s, subscriptions: { ...s.subscriptions, [crm.id]: crm } }, result: null }));
  return crm;
}

export async function updateSubscription(businessId: string, subscriptionId: string, action: 'cancel_at_period_end' | 'resume' | 'cancel_now'): Promise<CrmSubscription> {
  const st = await loadStripeState(businessId);
  const accountId = requireConnected(st);
  const current = st.subscriptions[subscriptionId];
  if (!current) throw new StripeConnectError('Subscription not found.', 'not_found', 404);
  const api = stripe();
  let sub: any;
  try {
    if (action === 'cancel_now') sub = await api.subscriptions.cancel(subscriptionId, {}, { stripeAccount: accountId });
    else sub = await api.subscriptions.update(subscriptionId, { cancel_at_period_end: action === 'cancel_at_period_end', expand: ['customer', 'latest_invoice'] } as any, { stripeAccount: accountId });
  } catch (err) { throw providerError(err, 'Stripe couldn’t update the subscription.'); }
  const crm = { ...toCrmSubscription(sub, current.clientId), planName: current.planName, customerName: current.customerName || toCrmSubscription(sub, current.clientId).customerName };
  await withStripeState(businessId, (s) => ({ state: { ...s, subscriptions: { ...s.subscriptions, [crm.id]: crm } }, result: null }));
  return crm;
}

// ---------- Webhooks (Connect endpoint) ----------

export type WebhookOutcome = { status: number; handled: boolean; reason?: string };

export function constructEvent(rawBody: string | Buffer, signature: string | undefined): any {
  const { webhookSecret } = stripeConfig();
  if (!webhookSecret) throw new StripeConnectError('Set STRIPE_CONNECT_WEBHOOK_SECRET to receive Stripe events.', 'not_configured', 503);
  if (!signature) throw new StripeConnectError('Missing Stripe-Signature header.', 'validation', 400);
  try { return stripe().webhooks.constructEvent(rawBody, signature, webhookSecret); }
  catch { throw new StripeConnectError('Invalid Stripe signature.', 'validation', 400); }
}

export async function handleEvent(event: any): Promise<WebhookOutcome> {
  const accountId: string | undefined = event?.account;
  if (!accountId) return { status: 200, handled: false, reason: 'not a Connect event' };
  const businessId = await businessForAccount(accountId);
  if (!businessId) return { status: 200, handled: false, reason: 'account not linked' };
  const st = await loadStripeState(businessId);
  if (st.processedEvents.includes(event.id)) return { status: 200, handled: false, reason: 'duplicate' };
  const obj = event.data?.object ?? {};
  let handled = true;

  switch (event.type) {
    case 'account.updated': {
      const info = toAccountInfo(obj);
      await withStripeState(businessId, (s) => (s.connection.status === 'disconnected' ? { state: s, result: null } : {
        state: { ...s, connection: { ...s.connection, account: info, status: deriveConnectionStatus(info), updatedAt: new Date().toISOString() } }, result: null,
      }));
      break;
    }
    case 'account.application.deauthorized': {
      await unlinkAccount(accountId, businessId);
      await withStripeState(businessId, (s) => {
        const now = new Date().toISOString();
        return { state: { ...s, connection: { ...s.connection, status: 'disconnected', updatedAt: now, disconnectedAt: now } }, result: null };
      });
      break;
    }
    case 'invoice.finalized': case 'invoice.updated': case 'invoice.sent': case 'invoice.paid': case 'invoice.payment_succeeded':
    case 'invoice.payment_failed': case 'invoice.voided': case 'invoice.marked_uncollectible':
      await applyStripeInvoice(businessId, accountId, obj);
      break;
    case 'customer.subscription.created': case 'customer.subscription.updated': case 'customer.subscription.deleted':
    case 'customer.subscription.paused': case 'customer.subscription.resumed': case 'customer.subscription.trial_will_end': {
      if (obj?.metadata?.crm_business_id && obj.metadata.crm_business_id !== businessId) { handled = false; break; }
      await withStripeState(businessId, (s) => {
        const prev = s.subscriptions[obj.id];
        const next = toCrmSubscription(obj, prev?.clientId ?? null);
        if (prev) { next.customerName = next.customerName || prev.customerName; next.customerEmail = next.customerEmail || prev.customerEmail; next.planName = prev.planName || next.planName; }
        return { state: { ...s, subscriptions: { ...s.subscriptions, [obj.id]: next } }, result: null };
      });
      break;
    }
    default:
      handled = false;
  }
  await withStripeState(businessId, (s) => ({ state: { ...markProcessed(s, event.id), connection: { ...s.connection, lastWebhookAt: new Date().toISOString() } }, result: null }));
  return { status: 200, handled };
}
