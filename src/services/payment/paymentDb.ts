/**
 * Payment provider data (Stripe / Square connections, customers, invoices, webhook idempotency),
 * stored in the tenant-scoped document store. Survives restarts; nothing is seeded.
 *
 * The first argument of every tenant function is the ORGANIZATION id (the routes pass
 * `tenantOf(req).orgId`). For backwards compatibility the records keep the field name `user_id`,
 * which holds that organization id.
 *
 *   organizations/{orgId}/payment_connections/{provider}
 *   organizations/{orgId}/payment_customers/{customerId}
 *   organizations/{orgId}/payment_invoices/{invoiceId}          (invoice + its items)
 *   organizations/{orgId}/payment_invoice_keys/{hash(idempotencyKey)}
 *   organizations/{orgId}/payment_audit/{id}
 *   payment_provider_invoices/{provider}_{hash(providerInvoiceId)}   → { orgId, invoiceId }  (webhooks)
 *   payment_provider_accounts/{provider}_{hash(providerAccountId)}   → { orgId }             (deauthorization)
 *   payment_webhook_events/{provider}_{hash(eventId)}                → processed marker      (idempotency)
 */
import crypto from 'node:crypto';
import { assertId, getDocStore } from '../../server/data/docStore';
import { ConnectedAccount, Customer, Invoice, InvoiceItem, PaymentProviderType } from './types';

const SAFE = /^[A-Za-z0-9_-]{1,128}$/;
const hash = (v: string) => crypto.createHash('sha256').update(v).digest('hex').slice(0, 48);
/** A path segment for an id we generated or received from a provider (hashed if it isn't a safe segment). */
const seg = (id: string) => (SAFE.test(id) ? id : `h_${hash(id)}`);
const org = (orgId: string) => `organizations/${assertId(orgId)}`;
const provider = (p: PaymentProviderType) => {
  if (p !== 'stripe' && p !== 'square') throw Object.assign(new Error('Unknown payment provider.'), { status: 400, code: 'invalid_provider' });
  return p;
};
const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v));

/* ------------------------------------------------------------------ connected accounts */

export async function getConnectedAccount(orgId: string, p: PaymentProviderType): Promise<ConnectedAccount | null> {
  return (await (await getDocStore()).get(`${org(orgId)}/payment_connections/${provider(p)}`)) as ConnectedAccount | null;
}

export async function listConnectedAccounts(orgId: string): Promise<ConnectedAccount[]> {
  return (await (await getDocStore()).list(`${org(orgId)}/payment_connections`)) as ConnectedAccount[];
}

export async function saveConnectedAccount(account: ConnectedAccount): Promise<ConnectedAccount> {
  const st = await getDocStore();
  const base = org(account.user_id);
  const previous = await getConnectedAccount(account.user_id, account.provider);
  if (previous && previous.provider_account_id !== account.provider_account_id) {
    await st.deleteRecursive(`payment_provider_accounts/${account.provider}_${hash(previous.provider_account_id)}`);
  }
  await st.set(`${base}/payment_connections/${provider(account.provider)}`, plain(account));
  await st.set(`payment_provider_accounts/${account.provider}_${hash(account.provider_account_id)}`, { orgId: account.user_id, provider: account.provider });
  await logAudit(account.user_id, 'CONNECT_ACCOUNT', account.provider, account.id, {
    accountId: account.provider_account_id,
    businessName: account.provider_metadata?.business_name,
  });
  return account;
}

export async function removeConnectedAccount(orgId: string, p: PaymentProviderType): Promise<boolean> {
  const existing = await getConnectedAccount(orgId, p);
  if (!existing) return false;
  const st = await getDocStore();
  await st.deleteRecursive(`${org(orgId)}/payment_connections/${provider(p)}`);
  await st.deleteRecursive(`payment_provider_accounts/${p}_${hash(existing.provider_account_id)}`);
  await logAudit(orgId, 'DISCONNECT_ACCOUNT', p, existing.id, { accountId: existing.provider_account_id });
  return true;
}

/** A seller revoked access at the provider (webhook): find the organization through the index. */
export async function disconnectAccountByProviderAccountId(p: PaymentProviderType, providerAccountId: string): Promise<boolean> {
  const idx = await (await getDocStore()).get(`payment_provider_accounts/${provider(p)}_${hash(providerAccountId)}`);
  if (!idx?.orgId) return false;
  const existing = await getConnectedAccount(idx.orgId, p);
  if (!existing || existing.provider_account_id !== providerAccountId) return false;
  await removeConnectedAccount(idx.orgId, p);
  await logAudit(idx.orgId, 'REVOKE_ACCOUNT_WEBHOOK', p, existing.id, { accountId: providerAccountId });
  return true;
}

/* ------------------------------------------------------------------ customers */

/** Returns null when the customer doesn't exist in this organization (other organizations' records are invisible). */
export async function getCustomer(orgId: string, customerId: string): Promise<Customer | null> {
  return (await (await getDocStore()).get(`${org(orgId)}/payment_customers/${seg(customerId)}`)) as Customer | null;
}

export async function findCustomerByEmail(orgId: string, email: string): Promise<Customer | null> {
  const want = email.trim().toLowerCase();
  const all = await listCustomers(orgId);
  return all.find((c) => (c.email || '').toLowerCase() === want) || null;
}

export async function listCustomers(orgId: string): Promise<Customer[]> {
  return (await (await getDocStore()).list(`${org(orgId)}/payment_customers`)) as Customer[];
}

export async function saveCustomer(customer: Customer): Promise<Customer> {
  await (await getDocStore()).set(`${org(customer.user_id)}/payment_customers/${seg(customer.id)}`, plain(customer));
  return customer;
}

/* ------------------------------------------------------------------ invoices */

async function withCustomer(orgId: string, doc: any): Promise<Invoice> {
  const customer = doc.customer_id ? await getCustomer(orgId, doc.customer_id) : null;
  return { ...doc, items: doc.items || [], customer: customer || undefined } as Invoice;
}

export async function getInvoice(orgId: string, invoiceId: string): Promise<Invoice | null> {
  const doc = await (await getDocStore()).get(`${org(orgId)}/payment_invoices/${seg(invoiceId)}`);
  return doc ? withCustomer(orgId, doc) : null;
}

export async function getInvoiceByProviderInvoiceId(p: PaymentProviderType, providerInvoiceId: string): Promise<Invoice | null> {
  if (!providerInvoiceId) return null;
  const idx = await (await getDocStore()).get(`payment_provider_invoices/${provider(p)}_${hash(providerInvoiceId)}`);
  if (!idx?.orgId || !idx?.invoiceId) return null;
  const inv = await getInvoice(idx.orgId, idx.invoiceId);
  return inv && inv.provider === p && inv.provider_invoice_id === providerInvoiceId ? inv : null;
}

export async function getInvoiceByIdempotencyKey(orgId: string, idempotencyKey: string): Promise<Invoice | null> {
  const ref = await (await getDocStore()).get(`${org(orgId)}/payment_invoice_keys/${hash(idempotencyKey)}`);
  return ref?.invoiceId ? getInvoice(orgId, ref.invoiceId) : null;
}

export async function registerInvoiceIdempotencyKey(orgId: string, idempotencyKey: string, invoiceId: string): Promise<void> {
  await (await getDocStore()).set(`${org(orgId)}/payment_invoice_keys/${hash(idempotencyKey)}`, { invoiceId, createdAt: new Date().toISOString() });
}

export async function listInvoices(orgId: string, p?: PaymentProviderType): Promise<Invoice[]> {
  const docs = await (await getDocStore()).list(`${org(orgId)}/payment_invoices`);
  const list = await Promise.all(docs.filter((d: any) => !p || d.provider === p).map((d) => withCustomer(orgId, d)));
  return list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

async function writeInvoice(doc: Invoice & { items: InvoiceItem[] }) {
  const st = await getDocStore();
  const { customer: _c, ...rest } = doc as any;
  await st.set(`${org(doc.user_id)}/payment_invoices/${seg(doc.id)}`, plain(rest));
  if (doc.provider && doc.provider_invoice_id) {
    await st.set(`payment_provider_invoices/${doc.provider}_${hash(doc.provider_invoice_id)}`, { orgId: doc.user_id, invoiceId: doc.id });
  }
}

export async function saveInvoice(invoice: Invoice, items?: InvoiceItem[]): Promise<Invoice> {
  const existing = await (await getDocStore()).get(`${org(invoice.user_id)}/payment_invoices/${seg(invoice.id)}`);
  const finalItems = items && items.length > 0 ? items : (invoice.items || existing?.items || []);
  await writeInvoice({ ...invoice, items: finalItems });
  await logAudit(invoice.user_id, 'SAVE_INVOICE', invoice.provider, invoice.id, {
    invoiceNumber: invoice.invoice_number, total: invoice.total, status: invoice.status,
  });
  return withCustomer(invoice.user_id, { ...invoice, items: finalItems });
}

export async function updateInvoiceStatus(
  orgId: string,
  invoiceId: string,
  newStatus: Invoice['status'],
  additionalData?: Partial<Invoice>,
): Promise<Invoice | null> {
  const existing = await (await getDocStore()).get(`${org(orgId)}/payment_invoices/${seg(invoiceId)}`);
  if (!existing) return null;
  const updated = { ...existing, ...(additionalData || {}), user_id: orgId, id: existing.id, status: newStatus, updated_at: new Date().toISOString() };
  await writeInvoice(updated);
  await logAudit(orgId, `INVOICE_STATUS_${newStatus.toUpperCase()}`, updated.provider, updated.id, { status: newStatus });
  return withCustomer(orgId, updated);
}

/** The customer standing for a CRM record ("billing_client:<id>", "email:<address>"), if one was created. */
export async function findCustomerByCrmRef(orgId: string, crmRef: string): Promise<Customer | null> {
  return (await listCustomers(orgId)).find((c) => c.crm_ref === crmRef) || null;
}

/** Provider invoices that collect one Invoicing invoice, newest first. */
export async function listInvoicesForBillingInvoice(orgId: string, billingInvoiceId: string): Promise<Invoice[]> {
  return (await listInvoices(orgId)).filter((i) => i.billing_invoice_id === billingInvoiceId);
}

/** The organization a provider (connected) account belongs to, from the index written on connect. */
export async function orgForProviderAccount(p: PaymentProviderType, providerAccountId: string): Promise<string | null> {
  if (!providerAccountId) return null;
  const idx = await (await getDocStore()).get(`payment_provider_accounts/${provider(p)}_${hash(providerAccountId)}`);
  return idx?.orgId ? String(idx.orgId) : null;
}

/**
 * Applies `patch(current)` to an invoice atomically. Return null from `patch` to leave it unchanged
 * (used by webhooks and refreshes so concurrent updates and out-of-order events can't undo each other).
 */
export async function patchInvoice(orgId: string, invoiceId: string, patch: (cur: Invoice) => Partial<Invoice> | null): Promise<Invoice | null> {
  const st = await getDocStore();
  const path = `${org(orgId)}/payment_invoices/${seg(invoiceId)}`;
  const result = await st.transaction(async (tx) => {
    const cur = await tx.get(path);
    if (!cur) return { doc: null as any, changed: false };
    const delta = patch(cur as Invoice);
    if (!delta) return { doc: cur, changed: false };
    const next = { ...cur, ...delta, id: cur.id, user_id: orgId, updated_at: new Date().toISOString() };
    tx.set(path, plain(next));
    return { doc: next, changed: true };
  });
  if (!result.doc) return null;
  if (result.changed) {
    const d = result.doc;
    if (d.provider && d.provider_invoice_id) await st.set(`payment_provider_invoices/${d.provider}_${hash(d.provider_invoice_id)}`, { orgId, invoiceId: d.id });
    await logAudit(orgId, `INVOICE_STATUS_${String(d.status).toUpperCase()}`, d.provider, d.id, { status: d.status });
  }
  return withCustomer(orgId, result.doc);
}

/* ------------------------------------------------------------------ OAuth state (single use) */

/** Consumes an OAuth state nonce once; a replayed callback link is refused. */
export async function claimOAuthNonce(p: PaymentProviderType, nonce: string): Promise<boolean> {
  const st = await getDocStore();
  const path = `payment_oauth_nonces/${provider(p)}_${hash(nonce)}`;
  return st.transaction(async (tx) => {
    if (await tx.get(path)) return false;
    tx.set(path, { provider: p, usedAt: new Date().toISOString() });
    return true;
  });
}

/* ------------------------------------------------------------------ webhook idempotency */

const eventPath = (p: PaymentProviderType, eventId: string) => `payment_webhook_events/${provider(p)}_${hash(eventId)}`;

export async function isWebhookEventProcessed(p: PaymentProviderType, eventId: string): Promise<boolean> {
  return !!(await (await getDocStore()).get(eventPath(p, eventId)));
}

export async function markWebhookEventProcessed(p: PaymentProviderType, eventId: string): Promise<void> {
  await (await getDocStore()).set(eventPath(p, eventId), { provider: p, eventId, processedAt: new Date().toISOString() });
}

/**
 * Atomically records a webhook event. Returns true the first time an event id is seen, false for a
 * replay (also after a restart, or when two deliveries race).
 */
export async function claimWebhookEvent(p: PaymentProviderType, eventId: string): Promise<boolean> {
  const st = await getDocStore();
  const path = eventPath(p, eventId);
  return st.transaction(async (tx) => {
    if (await tx.get(path)) return false;
    tx.set(path, { provider: p, eventId, processedAt: new Date().toISOString() });
    return true;
  });
}

/** Lets a failed event be delivered again (the provider retries). */
export async function releaseWebhookEvent(p: PaymentProviderType, eventId: string): Promise<void> {
  await (await getDocStore()).deleteRecursive(eventPath(p, eventId));
}

/* ------------------------------------------------------------------ audit */

export interface PaymentAuditEntry {
  id: string; orgId: string; action: string; provider?: PaymentProviderType; entityId?: string; metadata?: any; timestamp: string;
}

export async function logAudit(orgId: string, action: string, p?: PaymentProviderType, entityId?: string, metadata?: any): Promise<void> {
  const entry: PaymentAuditEntry = {
    id: `audit_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
    orgId, action, provider: p, entityId, metadata, timestamp: new Date().toISOString(),
  };
  try {
    await (await getDocStore()).set(`${org(orgId)}/payment_audit/${entry.id}`, plain(entry));
  } catch (err: any) {
    console.error('[payments] audit write failed:', err?.code || err?.name || 'error');
  }
}

export async function getAuditLogs(orgId: string): Promise<PaymentAuditEntry[]> {
  const rows = (await (await getDocStore()).list(`${org(orgId)}/payment_audit`)) as PaymentAuditEntry[];
  return rows.sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 500);
}
