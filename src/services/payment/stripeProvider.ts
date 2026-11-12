/**
 * Stripe invoicing for one organization, through its connected Stripe account (Stripe Connect, Standard,
 * OAuth). Every API call uses the platform key + `Stripe-Account` header (stripeClient.ts).
 *
 * Invoices
 *   - Built from the CRM's own exact totals (Invoicing calc engine, integer minor units): one Stripe invoice
 *     item per line subtotal, a negative "Discount" item, one item per tax rate, one per fee, and a negative
 *     "Payments received" item for any amount already paid, so the Stripe total equals the CRM balance due
 *     exactly (checked after creation; a mismatch deletes the draft and fails).
 *   - The invoice is created first (`pending_invoice_items_behavior: 'exclude'`) and every item is attached to
 *     it explicitly, so no stray pending item ends up on another invoice for the same customer.
 *   - Every write has an idempotency key derived from the CRM invoice id, so retries never duplicate.
 *   - Created as a draft. Finalizing and emailing happen only through `sendInvoice` (an explicit user action).
 * Customers
 *   - One Stripe customer per CRM record (`crm_ref`), per connected account: the stored mapping, then an
 *     existing Stripe customer with the same email (or the same crm_ref in metadata), then a new one.
 */
import crypto from 'node:crypto';
import type Stripe from 'stripe';
import {
  PaymentProvider, ConnectedAccount, ProviderAccount, Customer, Invoice, InvoiceItem,
  CreateCustomerInput, CreateInvoiceInput, PaymentProviderError, InvoiceStatus,
} from './types';
import { encryptToken } from './encryption';
import * as paymentDb from './paymentDb';
import { assertProviderConfigured } from './config';
import {
  STRIPE_CURRENCY_EXPONENT, assertStripeCurrency, minimumChargeMinor, onAccount, platformStripe, stripeErrorSummary, stripeMode, stripeUserMessage,
} from './stripeClient';
import { applyStripeInvoice, snapshotOf } from './stripeInvoiceSync';
import { calculateInvoice, type InvoiceTotals } from '../../features/invoicing/domain/calc';
import { formatRate, minorToDecimalString } from '../../features/invoicing/domain/money';
import type { LineItem } from '../../features/invoicing/domain/types';

const hash = (v: string) => crypto.createHash('sha256').update(v).digest('hex').slice(0, 32);
const MAX_LINES = 250; // Stripe's limit on invoice items per invoice
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** One Stripe invoice item: an amount in minor units and the text shown on the invoice. */
export interface StripeLine { amount: number; description: string }

/**
 * The Stripe invoice items for CRM totals (see the header). Their sum is exactly `totals.balanceDue`
 * (or `totals.total` when nothing has been paid).
 */
export function stripeLinesFromTotals(totals: InvoiceTotals, items: Array<Pick<LineItem, 'id' | 'name' | 'description' | 'quantity' | 'unitPrice'>>, currency: string): StripeLine[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const money = (minor: bigint) => `${minorToDecimalString(minor, currency)} ${currency}`;
  const out: StripeLine[] = [];
  for (const l of totals.lines) {
    if (!l.valid || l.subtotal === 0n) continue;
    const src = byId.get(l.id);
    const qty = src?.quantity?.trim() || '1';
    const name = (src?.name || src?.description || 'Item').trim();
    const extra = src?.description && src.description.trim() !== name ? ` (${src.description.trim()})` : '';
    out.push({ amount: Number(l.subtotal), description: `${name}${extra} · ${qty} × ${money(l.unitPrice)}`.slice(0, 500) });
  }
  if (totals.discount > 0n) out.push({ amount: -Number(totals.discount), description: totals.discountRate !== null ? `Discount (${formatRate(totals.discountRate)}%)` : 'Discount' });
  for (const g of totals.taxGroups) if (g.tax !== 0n) out.push({ amount: Number(g.tax), description: `Tax ${formatRate(g.rate)}% on ${money(g.taxable)}` });
  for (const f of totals.fees) if (f.amount !== 0n) out.push({ amount: Number(f.amount), description: (f.label || 'Fee').slice(0, 500) });
  if (totals.amountPaid > 0n) out.push({ amount: -Number(totals.amountPaid > totals.total ? totals.total : totals.amountPaid), description: 'Payments received' });
  return out;
}

export interface CustomerRef { crmRef: string; name: string; email: string; address?: Customer['billing_address'] }

export class StripeProvider implements PaymentProvider {
  constructor(private readonly orgId: string) {}

  /* ---------------------------------------------------------------- connection */

  private async connection(): Promise<ConnectedAccount> {
    assertProviderConfigured('stripe');
    const connected = await paymentDb.getConnectedAccount(this.orgId, 'stripe');
    if (!connected?.provider_account_id) throw new PaymentProviderError('PROVIDER_NOT_CONNECTED', 'Connect Stripe first.', 'stripe', null, 409);
    return connected;
  }

  /** Exchanges the OAuth code (Stripe Connect) and stores the connection for this organization. */
  async connect(authCode: string, _redirectUri: string, actorId?: string): Promise<ConnectedAccount> {
    assertProviderConfigured('stripe');
    if (!authCode) throw new PaymentProviderError('PROVIDER_VALIDATION_ERROR', 'Stripe didn’t return an authorization code.', 'stripe', null, 400);
    const stripe = platformStripe();
    let token: Stripe.OAuthToken;
    try {
      token = await stripe.oauth.token({ grant_type: 'authorization_code', code: authCode });
    } catch (err) {
      throw new PaymentProviderError('PROVIDER_AUTH_REVOKED', 'Stripe didn’t accept the connection. Try connecting again.', 'stripe', stripeErrorSummary(err), 400);
    }
    const acctId = token.stripe_user_id || '';
    if (!acctId || !token.access_token) throw new PaymentProviderError('PROVIDER_AUTH_REVOKED', 'Stripe didn’t complete the connection. Try connecting again.', 'stripe', null, 400);
    // The same Stripe account can't be connected to two organizations (webhooks route by account).
    const owner = await paymentDb.orgForProviderAccount('stripe', acctId);
    if (owner && owner !== this.orgId) {
      throw new PaymentProviderError('PROVIDER_VALIDATION_ERROR', 'This Stripe account is already connected to another organization.', 'stripe', null, 409);
    }
    let acct: Partial<Stripe.Account> = {};
    try { acct = await stripe.accounts.retrieve(acctId); } catch { /* profile is optional */ }
    const now = new Date().toISOString();
    return paymentDb.saveConnectedAccount({
      id: `conn_stripe_${this.orgId}`,
      user_id: this.orgId,
      provider: 'stripe',
      provider_account_id: acctId,
      access_token_encrypted: encryptToken(token.access_token),
      refresh_token_encrypted: token.refresh_token ? encryptToken(token.refresh_token) : undefined,
      provider_metadata: {
        business_name: acct.business_profile?.name || acct.settings?.dashboard?.display_name || '',
        email: acct.email || '',
        country: acct.country || '',
        currency: acct.default_currency ? acct.default_currency.toUpperCase() : '',
        environment: token.livemode ? 'production' : 'sandbox',
        charges_enabled: acct.charges_enabled ?? null,
        capabilities: ['invoicing'],
        connected_by: actorId || null,
      },
      created_at: now,
      updated_at: now,
    });
  }

  async disconnect(): Promise<void> {
    const connected = await paymentDb.getConnectedAccount(this.orgId, 'stripe');
    if (!connected) return;
    if (process.env.STRIPE_SECRET_KEY && process.env.STRIPE_CLIENT_ID) {
      try {
        await platformStripe().oauth.deauthorize({ client_id: process.env.STRIPE_CLIENT_ID, stripe_user_id: connected.provider_account_id });
      } catch (err) {
        // Already revoked at Stripe, or Stripe unreachable: the local disconnect still happens (and is audited).
        console.warn('[stripe] deauthorize:', stripeErrorSummary(err).code || stripeErrorSummary(err).type || 'error');
      }
    }
    await paymentDb.removeConnectedAccount(this.orgId, 'stripe');
  }

  async getAccount(): Promise<ProviderAccount & { mode?: string; country?: string; currency?: string; chargesEnabled?: boolean | null }> {
    const c = await paymentDb.getConnectedAccount(this.orgId, 'stripe');
    if (!c) return { provider: 'stripe', accountId: '', businessName: '', connected: false, environment: 'sandbox', mode: stripeMode() };
    const m = c.provider_metadata || {};
    return {
      provider: 'stripe', accountId: c.provider_account_id, businessName: m.business_name || '', email: m.email, connected: true,
      environment: (m.environment as any) || 'sandbox', connectedAt: c.created_at, mode: stripeMode(),
      country: m.country || undefined, currency: m.currency || undefined, chargesEnabled: m.charges_enabled ?? null,
    };
  }

  /* ---------------------------------------------------------------- customers */

  /** The Stripe customer for a CRM record in the connected account, reused whenever possible. */
  async resolveCustomer(ref: CustomerRef): Promise<Customer> {
    const email = ref.email.trim().toLowerCase();
    const name = ref.name.trim();
    if (!EMAIL.test(email)) throw new PaymentProviderError('PROVIDER_VALIDATION_ERROR', 'The customer needs a valid email address to receive a Stripe invoice.', 'stripe', null, 400);
    if (!name) throw new PaymentProviderError('PROVIDER_VALIDATION_ERROR', 'The customer needs a name.', 'stripe', null, 400);
    const conn = await this.connection();
    const acct = conn.provider_account_id;
    const stripe = platformStripe();

    let local = (await paymentDb.findCustomerByCrmRef(this.orgId, ref.crmRef)) || (await paymentDb.findCustomerByEmail(this.orgId, email));
    let stripeId = local && local.provider_account_ids?.stripe === acct ? local.provider_customer_ids?.stripe : undefined;
    // Older records (before the account was stored with the id) are trusted only if they still exist there.
    if (!stripeId && local?.provider_customer_ids?.stripe && !local.provider_account_ids?.stripe) stripeId = local.provider_customer_ids.stripe;

    try {
      if (stripeId) {
        const existing = await stripe.customers.retrieve(stripeId, {}, onAccount(acct)).catch((e: any) => (e?.code === 'resource_missing' ? null : Promise.reject(e)));
        if (!existing || (existing as Stripe.DeletedCustomer).deleted) stripeId = undefined;
      }
      if (!stripeId) {
        // Avoid duplicates in the seller's Stripe account: reuse a customer with this email.
        const found = await stripe.customers.list({ email, limit: 10 }, onAccount(acct));
        const live = found.data.filter((c) => !(c as any).deleted);
        const pick = live.find((c) => c.metadata?.crm_ref === ref.crmRef) || (live.length === 1 ? live[0] : live.find((c) => c.metadata?.obsidian_org_id === this.orgId));
        stripeId = pick?.id;
      }
      if (!stripeId) {
        const created = await stripe.customers.create({
          name, email,
          ...(ref.address && ref.address.address ? { address: { line1: ref.address.address, city: ref.address.city || undefined, state: ref.address.state || undefined, postal_code: ref.address.postal_code || undefined, country: ref.address.country || undefined } } : {}),
          metadata: { crm_ref: ref.crmRef, obsidian_org_id: this.orgId },
        }, onAccount(acct, `obs:${this.orgId}:cust:${hash(`${acct}:${ref.crmRef}`)}`));
        stripeId = created.id;
      }
    } catch (err) {
      if (err instanceof PaymentProviderError) throw err;
      throw new PaymentProviderError('CUSTOMER_CREATION_FAILED', stripeUserMessage(err, 'Stripe couldn’t create or find the customer.'), 'stripe', stripeErrorSummary(err), 502);
    }

    const base: Customer = local ?? {
      id: `cust_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`, user_id: this.orgId, name, email,
      provider_customer_ids: {}, billing_address: ref.address as any, created_at: new Date().toISOString(),
    };
    return paymentDb.saveCustomer({
      ...base, name, email, crm_ref: base.crm_ref || ref.crmRef,
      provider_customer_ids: { ...base.provider_customer_ids, stripe: stripeId },
      provider_account_ids: { ...(base.provider_account_ids || {}), stripe: acct },
      ...(ref.address ? { billing_address: ref.address } : {}),
    });
  }

  async createCustomer(input: CreateCustomerInput): Promise<Customer> {
    return this.resolveCustomer({ crmRef: `email:${String(input.email || '').trim().toLowerCase()}`, name: input.name, email: input.email, address: input.billing_address });
  }

  /* ---------------------------------------------------------------- invoices */

  /**
   * Creates a DRAFT Stripe invoice whose items are `lines` (minor units), for `customer`. Not finalized,
   * not sent. Returns the stored CRM record (status "draft").
   */
  async createDraftInvoice(input: {
    customer: Customer; currency: string; dueDate: string; number: string; description?: string; lines: StripeLine[];
    billingInvoiceId?: string; actorId?: string; localId?: string; idempotencyKey?: string;
  }): Promise<Invoice> {
    const currency = assertStripeCurrency(input.currency);
    if (input.lines.length === 0) throw new PaymentProviderError('PROVIDER_VALIDATION_ERROR', 'Add at least one line item.', 'stripe', null, 400);
    if (input.lines.length > MAX_LINES) throw new PaymentProviderError('PROVIDER_VALIDATION_ERROR', `Stripe invoices can have at most ${MAX_LINES} lines.`, 'stripe', null, 400);
    if (input.lines.some((l) => !Number.isSafeInteger(l.amount))) throw new PaymentProviderError('PROVIDER_VALIDATION_ERROR', 'An amount is too large for Stripe.', 'stripe', null, 400);
    const expected = input.lines.reduce((s, l) => s + l.amount, 0);
    if (expected <= 0) throw new PaymentProviderError('PROVIDER_VALIDATION_ERROR', 'There is nothing to collect: the amount due is zero.', 'stripe', null, 400);
    if (expected < minimumChargeMinor(currency)) throw new PaymentProviderError('PROVIDER_VALIDATION_ERROR', `Stripe can’t collect less than ${minorToDecimalString(BigInt(minimumChargeMinor(currency)), currency)} ${currency}.`, 'stripe', null, 400);
    const due = /^\d{4}-\d{2}-\d{2}$/.test(input.dueDate) ? Date.parse(`${input.dueDate}T23:59:59Z`) : NaN;
    if (!Number.isFinite(due)) throw new PaymentProviderError('PROVIDER_VALIDATION_ERROR', 'Due date must be a date (YYYY-MM-DD).', 'stripe', null, 400);
    // Stripe requires a due date in the future for invoices it emails.
    const dueUnix = Math.max(Math.floor(due / 1000), Math.floor(Date.now() / 1000) + 86400);

    const conn = await this.connection();
    const acct = conn.provider_account_id;
    const custId = input.customer.provider_account_ids?.stripe === acct || !input.customer.provider_account_ids?.stripe ? input.customer.provider_customer_ids?.stripe : undefined;
    if (!custId) throw new PaymentProviderError('PROVIDER_VALIDATION_ERROR', 'The customer isn’t set up in this Stripe account yet.', 'stripe', null, 409);

    const localId = input.localId || `inv_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
    const key = (step: string) => `obs:${this.orgId}:${input.idempotencyKey ? hash(input.idempotencyKey) : localId}:${step}`;
    const stripe = platformStripe();
    let draft: Stripe.Invoice | null = null;
    try {
      draft = await stripe.invoices.create({
        customer: custId,
        currency: currency.toLowerCase(),
        collection_method: 'send_invoice',
        due_date: dueUnix,
        auto_advance: false,
        pending_invoice_items_behavior: 'exclude',
        description: (input.description || `Invoice ${input.number}`).slice(0, 1500),
        custom_fields: [{ name: 'CRM invoice', value: input.number.slice(0, 30) }],
        metadata: { obsidian_org_id: this.orgId, crm_invoice_id: localId, crm_invoice_number: input.number.slice(0, 100), ...(input.billingInvoiceId ? { billing_invoice_id: input.billingInvoiceId } : {}) },
      }, onAccount(acct, key('invoice')));
      for (let i = 0; i < input.lines.length; i++) {
        const l = input.lines[i];
        await stripe.invoiceItems.create({
          customer: custId, invoice: draft.id, currency: currency.toLowerCase(), amount: l.amount, description: l.description,
        }, onAccount(acct, key(`item:${i}`)));
      }
      draft = await stripe.invoices.retrieve(draft.id, {}, onAccount(acct));
      if (draft.total !== expected) {
        throw new PaymentProviderError('INVOICE_CREATION_FAILED', `Stripe’s total (${draft.total}) didn’t match the CRM (${expected}). Nothing was sent.`, 'stripe', { stripeTotal: draft.total, expected }, 502);
      }
    } catch (err) {
      // Best effort: don't leave a half-built draft in the seller's account.
      if (draft?.id) await stripe.invoices.del(draft.id, {}, onAccount(acct)).catch(() => null);
      if (err instanceof PaymentProviderError) throw err;
      throw new PaymentProviderError('INVOICE_CREATION_FAILED', stripeUserMessage(err, 'Stripe couldn’t create the invoice.'), 'stripe', stripeErrorSummary(err), 502);
    }

    const exp = STRIPE_CURRENCY_EXPONENT[currency];
    const major = (minor: number) => minor / 10 ** exp;
    const items: InvoiceItem[] = input.lines.map((l, i) => ({ id: `item_${localId}_${i}`, invoice_id: localId, description: l.description, quantity: 1, unit_price: major(l.amount), tax_rate: 0, amount: major(l.amount) }));
    const now = new Date().toISOString();
    const record: Invoice = {
      id: localId, user_id: this.orgId, customer_id: input.customer.id, provider: 'stripe',
      provider_invoice_id: draft!.id, provider_account_id: acct, provider_customer_id: custId,
      invoice_number: input.number, currency, subtotal: major(expected), tax: 0, total: major(expected),
      status: 'draft', due_date: input.dueDate, description: input.description || `Invoice ${input.number}`,
      hosted_invoice_url: '', ...(input.billingInvoiceId ? { billing_invoice_id: input.billingInvoiceId } : {}),
      ...snapshotOf(draft!), payment_failure: null, created_by: input.actorId, created_at: now, updated_at: now,
    };
    return paymentDb.saveInvoice(record, items);
  }

  /** Generic API (/invoices/create): items are validated and totalled with the CRM's calc engine. */
  async createInvoice(input: CreateInvoiceInput & { actorId?: string }): Promise<Invoice> {
    if (input.idempotencyKey) {
      const existing = await paymentDb.getInvoiceByIdempotencyKey(this.orgId, input.idempotencyKey);
      if (existing) return existing;
    }
    const currency = assertStripeCurrency(input.currency || 'USD');
    const customer = await paymentDb.getCustomer(this.orgId, input.customerId);
    if (!customer) throw new PaymentProviderError('PROVIDER_VALIDATION_ERROR', 'That customer doesn’t exist in this organization.', 'stripe', null, 404);
    const ready = customer.provider_account_ids?.stripe && customer.provider_customer_ids?.stripe ? customer
      : await this.resolveCustomer({ crmRef: customer.crm_ref || `email:${customer.email.toLowerCase()}`, name: customer.name, email: customer.email, address: customer.billing_address });
    const items: LineItem[] = input.items.map((it, i) => ({
      id: `l${i}`, name: String(it.description || '').trim() || 'Item', description: '',
      quantity: String(it.quantity), unitPrice: String(it.unit_price), taxRate: String(it.tax_rate ?? 0),
    }));
    const totals = calculateInvoice({ currency, items, discount: { type: 'percent', value: '' }, fees: [] });
    if (totals.lines.some((l) => !l.valid)) throw new PaymentProviderError('PROVIDER_VALIDATION_ERROR', `Each line needs a quantity above 0 and a price of 0 or more in ${currency} (at most ${STRIPE_CURRENCY_EXPONENT[currency]} decimals).`, 'stripe', null, 400);
    const inv = await this.createDraftInvoice({
      customer: ready, currency, dueDate: input.dueDate, number: input.invoiceNumber, description: input.description,
      lines: stripeLinesFromTotals(totals, items, currency), billingInvoiceId: input.billingInvoiceId, actorId: input.actorId, idempotencyKey: input.idempotencyKey,
    });
    if (input.idempotencyKey) await paymentDb.registerInvoiceIdempotencyKey(this.orgId, input.idempotencyKey, inv.id);
    return inv;
  }

  private async local(invoiceId: string): Promise<Invoice> {
    const inv = await paymentDb.getInvoice(this.orgId, invoiceId);
    if (!inv || inv.provider !== 'stripe') throw new PaymentProviderError('PROVIDER_VALIDATION_ERROR', 'Invoice not found.', 'stripe', null, 404);
    return inv;
  }

  private async remote(inv: Invoice, acct: string): Promise<Stripe.Invoice> {
    if (inv.provider_account_id && inv.provider_account_id !== acct) {
      throw new PaymentProviderError('INVOICE_STATE_CONFLICT', 'This invoice belongs to a Stripe account that is no longer connected.', 'stripe', null, 409);
    }
    try { return await platformStripe().invoices.retrieve(inv.provider_invoice_id, {}, onAccount(acct)); }
    catch (err) { throw new PaymentProviderError('INVOICE_SEND_FAILED', stripeUserMessage(err, 'Stripe couldn’t load the invoice.'), 'stripe', stripeErrorSummary(err), 502); }
  }

  /** Re-reads the invoice from Stripe and applies it (for missed webhooks; the "Refresh" button). */
  async syncInvoice(invoiceId: string): Promise<Invoice> {
    const inv = await this.local(invoiceId);
    const conn = await this.connection();
    const si = await this.remote(inv, conn.provider_account_id);
    return applyStripeInvoice(inv, si, { at: new Date().toISOString() });
  }

  async finalizeInvoice(invoiceId: string): Promise<Invoice> {
    const inv = await this.local(invoiceId);
    const conn = await this.connection();
    let si = await this.remote(inv, conn.provider_account_id);
    if (si.status === 'draft') {
      try { si = await platformStripe().invoices.finalizeInvoice(si.id, { auto_advance: false }, onAccount(conn.provider_account_id, `obs:${this.orgId}:${inv.id}:finalize`)); }
      catch (err) { throw new PaymentProviderError('INVOICE_SEND_FAILED', stripeUserMessage(err, 'Stripe couldn’t finalize the invoice.'), 'stripe', stripeErrorSummary(err), 502); }
    }
    return applyStripeInvoice(inv, si, { at: new Date().toISOString() });
  }

  /** Finalizes (if needed) and emails the invoice through Stripe. Explicit user action only. */
  async sendInvoice(invoiceId: string): Promise<Invoice> {
    const inv = await this.local(invoiceId);
    if (inv.status === 'paid' || inv.status === 'void' || inv.status === 'uncollectible') {
      throw new PaymentProviderError('INVOICE_STATE_CONFLICT', `This invoice is ${inv.status === 'uncollectible' ? 'marked uncollectible' : inv.status}; it can’t be sent.`, 'stripe', null, 409);
    }
    const finalized = await this.finalizeInvoice(invoiceId);
    if (finalized.status !== 'open') {
      throw new PaymentProviderError('INVOICE_STATE_CONFLICT', `Stripe reports this invoice as ${finalized.status}; it wasn’t sent.`, 'stripe', null, 409);
    }
    const conn = await this.connection();
    let sent: Stripe.Invoice;
    try {
      // The first send is keyed by the invoice; "Send again" by the minute, so a double click emails once.
      const n = inv.sent_at ? `again:${Math.floor(Date.now() / 60_000)}` : 'first';
      sent = await platformStripe().invoices.sendInvoice(finalized.provider_invoice_id, {}, onAccount(conn.provider_account_id, `obs:${this.orgId}:${inv.id}:send:${n}`));
    } catch (err) {
      throw new PaymentProviderError('INVOICE_SEND_FAILED', stripeUserMessage(err, 'Stripe couldn’t email the invoice.'), 'stripe', stripeErrorSummary(err), 502);
    }
    return applyStripeInvoice(finalized, sent, { at: new Date().toISOString(), sent: true });
  }

  async getInvoice(invoiceId: string): Promise<Invoice> {
    return this.local(invoiceId);
  }

  async listInvoices(): Promise<Invoice[]> {
    return paymentDb.listInvoices(this.orgId, 'stripe');
  }

  /** Drafts are deleted at Stripe; open invoices are voided. Paid invoices can't be voided (refund instead). */
  async voidInvoice(invoiceId: string): Promise<Invoice> {
    const inv = await this.local(invoiceId);
    if (inv.status === 'void') return inv;
    if (inv.status === 'paid') throw new PaymentProviderError('INVOICE_STATE_CONFLICT', 'A paid invoice can’t be voided. Refund it in Stripe instead.', 'stripe', null, 409);
    const conn = await this.connection();
    const si = await this.remote(inv, conn.provider_account_id);
    const stripe = platformStripe();
    try {
      if (si.status === 'draft') {
        await stripe.invoices.del(si.id, {}, onAccount(conn.provider_account_id));
        return (await paymentDb.patchInvoice(this.orgId, inv.id, () => ({ status: 'void' as InvoiceStatus, voided_at: new Date().toISOString() }))) || inv;
      }
      if (si.status === 'paid') return applyStripeInvoice(inv, si, { at: new Date().toISOString() });
      const voided = await stripe.invoices.voidInvoice(si.id, {}, onAccount(conn.provider_account_id, `obs:${this.orgId}:${inv.id}:void`));
      return applyStripeInvoice(inv, voided, { at: new Date().toISOString() });
    } catch (err) {
      if (err instanceof PaymentProviderError) throw err;
      throw new PaymentProviderError('INVOICE_SEND_FAILED', stripeUserMessage(err, 'Stripe couldn’t void the invoice.'), 'stripe', stripeErrorSummary(err), 502);
    }
  }
}
