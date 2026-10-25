import { 
  User, 
  ConnectedAccount, 
  Customer, 
  Invoice, 
  InvoiceItem, 
  PaymentProviderType,
  PaymentProviderError 
} from './types';

// In-Memory Multi-tenant Stores
const USERS_MAP = new Map<string, User>();
const CONNECTED_ACCOUNTS_MAP = new Map<string, ConnectedAccount>(); // key: `${userId}:${provider}`
const CUSTOMERS_MAP = new Map<string, Customer>(); // key: customerId
const INVOICES_MAP = new Map<string, Invoice>(); // key: invoiceId
const INVOICE_ITEMS_MAP = new Map<string, InvoiceItem[]>(); // key: invoiceId
const INVOICES_BY_IDEMPOTENCY = new Map<string, string>(); // key: `${userId}:${idempotencyKey}` -> invoiceId
const PROCESSED_WEBHOOK_EVENTS = new Set<string>(); // key: `${provider}:${eventId}`
const AUDIT_LOGS: Array<{
  id: string;
  userId: string;
  action: string;
  provider?: PaymentProviderType;
  entityId?: string;
  metadata?: any;
  timestamp: string;
}> = [];

// Seed default application user
const DEFAULT_USER: User = {
  id: 'usr_101',
  email: 'rpierrette45@gmail.com',
  name: 'R. Pierrette',
  created_at: new Date('2026-01-01T00:00:00Z').toISOString()
};
USERS_MAP.set(DEFAULT_USER.id, DEFAULT_USER);

// Seed default demo customer
const DEFAULT_CUSTOMER: Customer = {
  id: 'cust_kappy_001',
  user_id: 'usr_101',
  name: 'Kappy Bara',
  email: 'Pay@Kappybara.ai',
  provider_customer_ids: {
    stripe: 'cus_stripe_mock_kappy_101',
    square: 'cust_square_mock_kappy_101'
  },
  billing_address: {
    company_name: 'Kappy Bara',
    address: '95-1249 Meheula Pkwy',
    city: 'Mililani',
    state: 'Hawaii',
    postal_code: '94016',
    country: 'United state',
    tax_id: '0123892V'
  } as any,
  created_at: new Date('2026-01-15T00:00:00Z').toISOString()
};
CUSTOMERS_MAP.set(DEFAULT_CUSTOMER.id, DEFAULT_CUSTOMER);

/**
 * -------------------------------------------------------------
 * USER OPERATIONS
 * -------------------------------------------------------------
 */
export async function getUser(userId: string): Promise<User | null> {
  return USERS_MAP.get(userId) || null;
}

export async function getOrCreateUser(userId: string, email?: string, name?: string): Promise<User> {
  let user = USERS_MAP.get(userId);
  if (!user) {
    user = {
      id: userId,
      email: email || `${userId}@crm-enterprise.com`,
      name: name || 'Enterprise Operator',
      created_at: new Date().toISOString()
    };
    USERS_MAP.set(userId, user);
  }
  return user;
}

/**
 * -------------------------------------------------------------
 * CONNECTED ACCOUNT OPERATIONS (Tenant Isolated)
 * -------------------------------------------------------------
 */
export async function getConnectedAccount(
  userId: string, 
  provider: PaymentProviderType
): Promise<ConnectedAccount | null> {
  const key = `${userId}:${provider}`;
  return CONNECTED_ACCOUNTS_MAP.get(key) || null;
}

export async function listConnectedAccounts(userId: string): Promise<ConnectedAccount[]> {
  const accounts: ConnectedAccount[] = [];
  for (const account of CONNECTED_ACCOUNTS_MAP.values()) {
    if (account.user_id === userId) {
      accounts.push(account);
    }
  }
  return accounts;
}

export async function saveConnectedAccount(account: ConnectedAccount): Promise<ConnectedAccount> {
  const key = `${account.user_id}:${account.provider}`;
  CONNECTED_ACCOUNTS_MAP.set(key, account);

  // Sync to Firestore if available
  try {
    const { adminDb } = await import('../../lib/firebaseAdmin');
    await adminDb.collection('connected_accounts').doc(account.id).set(account, { merge: true });
  } catch {
    // In-memory fallback
  }

  await logAudit(account.user_id, 'CONNECT_ACCOUNT', account.provider, account.id, {
    accountId: account.provider_account_id,
    businessName: account.provider_metadata?.business_name
  });

  return account;
}

export async function removeConnectedAccount(
  userId: string, 
  provider: PaymentProviderType
): Promise<boolean> {
  const key = `${userId}:${provider}`;
  const existing = CONNECTED_ACCOUNTS_MAP.get(key);
  if (!existing) return false;

  CONNECTED_ACCOUNTS_MAP.delete(key);

  try {
    const { adminDb } = await import('../../lib/firebaseAdmin');
    await adminDb.collection('connected_accounts').doc(existing.id).delete();
  } catch {
    // In-memory fallback
  }

  await logAudit(userId, 'DISCONNECT_ACCOUNT', provider, existing.id, {
    accountId: existing.provider_account_id
  });

  return true;
}

export async function disconnectAccountByProviderAccountId(
  provider: PaymentProviderType,
  providerAccountId: string
): Promise<boolean> {
  for (const [key, account] of CONNECTED_ACCOUNTS_MAP.entries()) {
    if (account.provider === provider && account.provider_account_id === providerAccountId) {
      CONNECTED_ACCOUNTS_MAP.delete(key);
      try {
        const { adminDb } = await import('../../lib/firebaseAdmin');
        await adminDb.collection('connected_accounts').doc(account.id).delete();
      } catch {
        // In-memory fallback
      }
      await logAudit(account.user_id, 'REVOKE_ACCOUNT_WEBHOOK', provider, account.id, {
        accountId: providerAccountId
      });
      return true;
    }
  }
  return false;
}

/**
 * -------------------------------------------------------------
 * CUSTOMER OPERATIONS (Tenant Isolated)
 * -------------------------------------------------------------
 */
export async function getCustomer(userId: string, customerId: string): Promise<Customer | null> {
  const customer = CUSTOMERS_MAP.get(customerId);
  if (!customer) return null;
  if (customer.user_id !== userId) {
    throw new PaymentProviderError('UNAUTHORIZED_ACCESS', 'Access denied to this customer record', undefined, null, 403);
  }
  return customer;
}

export async function findCustomerByEmail(userId: string, email: string): Promise<Customer | null> {
  for (const cust of CUSTOMERS_MAP.values()) {
    if (cust.user_id === userId && cust.email.toLowerCase() === email.toLowerCase()) {
      return cust;
    }
  }
  return null;
}

export async function listCustomers(userId: string): Promise<Customer[]> {
  const results: Customer[] = [];
  for (const cust of CUSTOMERS_MAP.values()) {
    if (cust.user_id === userId) {
      results.push(cust);
    }
  }
  return results;
}

export async function saveCustomer(customer: Customer): Promise<Customer> {
  CUSTOMERS_MAP.set(customer.id, customer);

  try {
    const { adminDb } = await import('../../lib/firebaseAdmin');
    await adminDb.collection('payment_customers').doc(customer.id).set(customer, { merge: true });
  } catch {
    // In-memory fallback
  }

  return customer;
}

/**
 * -------------------------------------------------------------
 * INVOICE & INVOICE ITEM OPERATIONS (Tenant Isolated)
 * -------------------------------------------------------------
 */
export async function getInvoice(userId: string, invoiceId: string): Promise<Invoice | null> {
  const invoice = INVOICES_MAP.get(invoiceId);
  if (!invoice) return null;
  if (invoice.user_id !== userId) {
    throw new PaymentProviderError('UNAUTHORIZED_ACCESS', 'Access denied to this invoice record', undefined, null, 403);
  }
  
  const items = INVOICE_ITEMS_MAP.get(invoiceId) || [];
  const customer = CUSTOMERS_MAP.get(invoice.customer_id);
  return {
    ...invoice,
    items,
    customer
  };
}

export async function getInvoiceByProviderInvoiceId(
  provider: PaymentProviderType,
  providerInvoiceId: string
): Promise<Invoice | null> {
  for (const inv of INVOICES_MAP.values()) {
    if (inv.provider === provider && inv.provider_invoice_id === providerInvoiceId) {
      const items = INVOICE_ITEMS_MAP.get(inv.id) || [];
      const customer = CUSTOMERS_MAP.get(inv.customer_id);
      return {
        ...inv,
        items,
        customer
      };
    }
  }
  return null;
}

export async function getInvoiceByIdempotencyKey(userId: string, idempotencyKey: string): Promise<Invoice | null> {
  const invId = INVOICES_BY_IDEMPOTENCY.get(`${userId}:${idempotencyKey}`);
  if (!invId) return null;
  return getInvoice(userId, invId);
}

export async function registerInvoiceIdempotencyKey(userId: string, idempotencyKey: string, invoiceId: string): Promise<void> {
  INVOICES_BY_IDEMPOTENCY.set(`${userId}:${idempotencyKey}`, invoiceId);
}

export async function listInvoices(userId: string, provider?: PaymentProviderType): Promise<Invoice[]> {
  const list: Invoice[] = [];
  for (const inv of INVOICES_MAP.values()) {
    if (inv.user_id === userId) {
      if (!provider || inv.provider === provider) {
        const items = INVOICE_ITEMS_MAP.get(inv.id) || [];
        const customer = CUSTOMERS_MAP.get(inv.customer_id);
        list.push({ ...inv, items, customer });
      }
    }
  }
  return list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

export async function saveInvoice(invoice: Invoice, items?: InvoiceItem[]): Promise<Invoice> {
  INVOICES_MAP.set(invoice.id, invoice);
  if (items && items.length > 0) {
    INVOICE_ITEMS_MAP.set(invoice.id, items);
  }

  try {
    const { adminDb } = await import('../../lib/firebaseAdmin');
    await adminDb.collection('payment_invoices').doc(invoice.id).set(invoice, { merge: true });
    if (items) {
      await adminDb.collection('payment_invoices').doc(invoice.id).collection('items').doc('list').set({ items });
    }
  } catch {
    // In-memory fallback
  }

  await logAudit(invoice.user_id, 'SAVE_INVOICE', invoice.provider, invoice.id, {
    invoiceNumber: invoice.invoice_number,
    total: invoice.total,
    status: invoice.status
  });

  const fullItems = INVOICE_ITEMS_MAP.get(invoice.id) || items || [];
  const customer = CUSTOMERS_MAP.get(invoice.customer_id);
  return { ...invoice, items: fullItems, customer };
}

export async function updateInvoiceStatus(
  invoiceId: string,
  newStatus: Invoice['status'],
  additionalData?: Partial<Invoice>
): Promise<Invoice | null> {
  const existing = INVOICES_MAP.get(invoiceId);
  if (!existing) return null;

  const updated: Invoice = {
    ...existing,
    ...additionalData,
    status: newStatus,
    updated_at: new Date().toISOString()
  };
  INVOICES_MAP.set(invoiceId, updated);

  try {
    const { adminDb } = await import('../../lib/firebaseAdmin');
    await adminDb.collection('payment_invoices').doc(invoiceId).set(updated, { merge: true });
  } catch {
    // In-memory fallback
  }

  await logAudit(updated.user_id, `INVOICE_STATUS_${newStatus.toUpperCase()}`, updated.provider, updated.id, {
    status: newStatus,
    additionalData
  });

  return updated;
}

/**
 * -------------------------------------------------------------
 * WEBHOOK IDEMPOTENCY TRACKING
 * -------------------------------------------------------------
 */
export async function isWebhookEventProcessed(provider: PaymentProviderType, eventId: string): Promise<boolean> {
  const key = `${provider}:${eventId}`;
  return PROCESSED_WEBHOOK_EVENTS.has(key);
}

export async function markWebhookEventProcessed(provider: PaymentProviderType, eventId: string): Promise<void> {
  const key = `${provider}:${eventId}`;
  PROCESSED_WEBHOOK_EVENTS.add(key);

  try {
    const { adminDb } = await import('../../lib/firebaseAdmin');
    await adminDb.collection('webhook_events').doc(key).set({
      provider,
      eventId,
      processedAt: new Date().toISOString()
    });
  } catch {
    // In-memory fallback
  }
}

/**
 * -------------------------------------------------------------
 * AUDIT LOGGING
 * -------------------------------------------------------------
 */
export async function logAudit(
  userId: string, 
  action: string, 
  provider?: PaymentProviderType, 
  entityId?: string, 
  metadata?: any
): Promise<void> {
  const entry = {
    id: `audit_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    userId,
    action,
    provider,
    entityId,
    metadata,
    timestamp: new Date().toISOString()
  };
  AUDIT_LOGS.unshift(entry);
  if (AUDIT_LOGS.length > 500) AUDIT_LOGS.pop();

  try {
    const { adminDb } = await import('../../lib/firebaseAdmin');
    await adminDb.collection('payment_audit_logs').doc(entry.id).set(entry);
  } catch {
    // In-memory fallback
  }
}

export async function getAuditLogs(userId: string): Promise<typeof AUDIT_LOGS> {
  return AUDIT_LOGS.filter(l => l.userId === userId);
}
