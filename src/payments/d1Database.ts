import { 
  D1Business, 
  D1PaymentAccount, 
  D1Customer, 
  D1Invoice, 
  D1InvoiceItem, 
  D1WebhookEvent,
  SupportedPaymentProvider,
  LocalInvoicePaymentStatus
} from './types';

/**
 * Cloudflare D1 Interface Compatibility Layer
 * Mimics Cloudflare Worker env.DB prepared statement methods:
 *   db.prepare(sql).bind(...params).first() / .all() / .run()
 */
export interface D1PreparedStatement {
  bind(...params: any[]): D1PreparedStatement;
  first<T = Record<string, any>>(colName?: string): Promise<T | null>;
  all<T = Record<string, any>>(): Promise<{ results: T[]; success: boolean; meta: any }>;
  run(): Promise<{ success: boolean; meta: { changes: number; last_row_id: number } }>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<any[]>;
  exec(query: string): Promise<void>;
}

// In-Memory Multi-Tenant Store implementing D1 data structures
class InMemoryD1Store {
  public businesses = new Map<string, D1Business>();
  public paymentAccounts = new Map<string, D1PaymentAccount>(); // key: `${business_id}:${provider}`
  public customers = new Map<string, D1Customer>();
  public invoices = new Map<string, D1Invoice>();
  public invoiceItems = new Map<string, D1InvoiceItem[]>(); // key: invoice_id
  public webhookEvents = new Map<string, D1WebhookEvent>(); // key: `${provider}:${event_id}`

  constructor() {
    this.seedDefaultData();
  }

  public seedDefaultData() {
    // Default primary test business
    const defaultBusiness: D1Business = {
      id: 'biz_default_101',
      name: 'Ace Studio Enterprise',
      email: 'billing@acestudio.pro',
      created_at: new Date('2026-01-01T00:00:00Z').toISOString(),
      updated_at: new Date('2026-01-01T00:00:00Z').toISOString()
    };
    this.businesses.set(defaultBusiness.id, defaultBusiness);

    // Default primary test customer
    const defaultCustomer: D1Customer = {
      id: 'cust_kappy_001',
      business_id: 'biz_default_101',
      name: 'Kappy Bara',
      email: 'Pay@Kappybara.ai',
      stripe_customer_id: 'cus_test_mock_kappy_101',
      billing_address: JSON.stringify({
        companyName: 'Kappy Bara AI',
        address: '95-1249 Meheula Pkwy',
        city: 'Mililani',
        state: 'Hawaii',
        postalCode: '94016',
        country: 'United States',
        taxId: '0123892V'
      }),
      created_at: new Date('2026-01-10T00:00:00Z').toISOString(),
      updated_at: new Date('2026-01-10T00:00:00Z').toISOString()
    };
    this.customers.set(defaultCustomer.id, defaultCustomer);

    // Default seeded invoice: $3,500.00 = 350000 cents
    const defaultInvoice: D1Invoice = {
      id: 'INV-000001',
      business_id: 'biz_default_101',
      customer_id: 'cust_kappy_001',
      invoice_number: '000001',
      currency: 'USD',
      subtotal_cents: 350000,
      tax_cents: 0,
      total_cents: 350000,
      status: 'open',
      payment_provider: 'stripe',
      provider_invoice_id: null,
      payment_url: null,
      payment_status: 'unpaid',
      due_date: '2026-03-30',
      description: 'UI Design & Development Sprint',
      paid_at: null,
      created_at: new Date('2026-01-24T00:00:00Z').toISOString(),
      updated_at: new Date('2026-01-24T00:00:00Z').toISOString()
    };
    this.invoices.set(defaultInvoice.id, defaultInvoice);

    const defaultItems: D1InvoiceItem[] = [
      {
        id: 'item-1',
        invoice_id: 'INV-000001',
        description: 'UI Design Work',
        quantity: 2,
        unit_price_cents: 100000, // $1,000.00
        tax_rate_percent: 0,
        amount_cents: 200000     // $2,000.00
      },
      {
        id: 'item-2',
        invoice_id: 'INV-000001',
        description: 'Frontend & API Integration',
        quantity: 1,
        unit_price_cents: 150000, // $1,500.00
        tax_rate_percent: 0,
        amount_cents: 150000     // $1,500.00
      }
    ];
    this.invoiceItems.set(defaultInvoice.id, defaultItems);
  }
}

export const store = new InMemoryD1Store();

/**
 * High-level Typed D1 Service Layer
 * Enforces business tenant isolation and integer minor units calculations.
 */

export async function getBusiness(businessId: string): Promise<D1Business | null> {
  return store.businesses.get(businessId) || null;
}

export async function getOrCreateBusiness(businessId: string, name?: string, email?: string): Promise<D1Business> {
  let business = store.businesses.get(businessId);
  if (!business) {
    business = {
      id: businessId,
      name: name || 'Enterprise Business',
      email: email || 'billing@enterprise-crm.io',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    store.businesses.set(businessId, business);
  }
  return business;
}

export async function getPaymentAccount(
  businessId: string, 
  provider: SupportedPaymentProvider
): Promise<D1PaymentAccount | null> {
  const key = `${businessId}:${provider}`;
  return store.paymentAccounts.get(key) || null;
}

export async function savePaymentAccount(account: D1PaymentAccount): Promise<D1PaymentAccount> {
  const key = `${account.business_id}:${account.provider}`;
  store.paymentAccounts.set(key, account);
  return account;
}

export async function removePaymentAccount(
  businessId: string, 
  provider: SupportedPaymentProvider
): Promise<boolean> {
  const key = `${businessId}:${provider}`;
  const existing = store.paymentAccounts.get(key);
  if (existing) {
    store.paymentAccounts.delete(key);
    return true;
  }
  return false;
}

export async function getCustomer(businessId: string, customerId: string): Promise<D1Customer | null> {
  const cust = store.customers.get(customerId);
  if (!cust || cust.business_id !== businessId) return null;
  return cust;
}

export async function findCustomerByEmail(businessId: string, email: string): Promise<D1Customer | null> {
  for (const c of store.customers.values()) {
    if (c.business_id === businessId && c.email.toLowerCase() === email.toLowerCase()) {
      return c;
    }
  }
  return null;
}

export async function saveCustomer(customer: D1Customer): Promise<D1Customer> {
  store.customers.set(customer.id, customer);
  return customer;
}

export async function updateCustomerStripeId(
  businessId: string, 
  customerId: string, 
  stripeCustomerId: string
): Promise<void> {
  const cust = await getCustomer(businessId, customerId);
  if (cust) {
    cust.stripe_customer_id = stripeCustomerId;
    cust.updated_at = new Date().toISOString();
  }
}

export async function getInvoice(businessId: string, invoiceId: string): Promise<D1Invoice | null> {
  const inv = store.invoices.get(invoiceId);
  if (!inv || inv.business_id !== businessId) return null;
  
  const items = store.invoiceItems.get(invoiceId) || [];
  const customer = store.customers.get(inv.customer_id);

  return {
    ...inv,
    items,
    customer
  };
}

export async function getInvoiceByProviderInvoiceId(
  provider: SupportedPaymentProvider, 
  providerInvoiceId: string
): Promise<D1Invoice | null> {
  for (const inv of store.invoices.values()) {
    if (inv.payment_provider === provider && inv.provider_invoice_id === providerInvoiceId) {
      const items = store.invoiceItems.get(inv.id) || [];
      const customer = store.customers.get(inv.customer_id);
      return {
        ...inv,
        items,
        customer
      };
    }
  }
  return null;
}

export async function listInvoices(businessId: string): Promise<D1Invoice[]> {
  const list: D1Invoice[] = [];
  for (const inv of store.invoices.values()) {
    if (inv.business_id === businessId) {
      const items = store.invoiceItems.get(inv.id) || [];
      const customer = store.customers.get(inv.customer_id);
      list.push({ ...inv, items, customer });
    }
  }
  return list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

export async function saveInvoice(
  invoice: D1Invoice, 
  items?: D1InvoiceItem[]
): Promise<D1Invoice> {
  // If items are provided, calculate totals authoritatively in integer cents
  if (items && items.length > 0) {
    let subtotalCents = 0;
    let taxCents = 0;

    for (const item of items) {
      const lineAmountCents = item.quantity * item.unit_price_cents;
      subtotalCents += lineAmountCents;
      if (item.tax_rate_percent && item.tax_rate_percent > 0) {
        taxCents += Math.round((lineAmountCents * item.tax_rate_percent) / 100);
      }
    }

    invoice.subtotal_cents = subtotalCents;
    invoice.tax_cents = taxCents;
    invoice.total_cents = subtotalCents + taxCents;

    store.invoiceItems.set(invoice.id, items);
  }

  store.invoices.set(invoice.id, invoice);
  return invoice;
}

export async function updateInvoicePaymentDetails(
  invoiceId: string, 
  updates: {
    payment_provider?: SupportedPaymentProvider;
    provider_invoice_id?: string;
    payment_url?: string;
    payment_status?: LocalInvoicePaymentStatus;
    status?: 'draft' | 'open' | 'paid' | 'void' | 'uncollectible';
    paid_at?: string | null;
  }
): Promise<D1Invoice | null> {
  const inv = store.invoices.get(invoiceId);
  if (!inv) return null;

  if (updates.payment_provider !== undefined) inv.payment_provider = updates.payment_provider;
  if (updates.provider_invoice_id !== undefined) inv.provider_invoice_id = updates.provider_invoice_id;
  if (updates.payment_url !== undefined) inv.payment_url = updates.payment_url;
  if (updates.payment_status !== undefined) inv.payment_status = updates.payment_status;
  if (updates.status !== undefined) inv.status = updates.status;
  if (updates.paid_at !== undefined) inv.paid_at = updates.paid_at;
  inv.updated_at = new Date().toISOString();

  return inv;
}

/**
 * Webhook Idempotency Table Operations
 */

export async function isWebhookEventProcessed(
  provider: SupportedPaymentProvider, 
  eventId: string
): Promise<boolean> {
  const key = `${provider}:${eventId}`;
  return store.webhookEvents.has(key);
}

export async function markWebhookEventProcessed(
  provider: SupportedPaymentProvider, 
  eventId: string
): Promise<D1WebhookEvent> {
  const key = `${provider}:${eventId}`;
  const event: D1WebhookEvent = {
    id: `whe_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    provider,
    event_id: eventId,
    processed_at: new Date().toISOString(),
    created_at: new Date().toISOString()
  };
  store.webhookEvents.set(key, event);
  return event;
}
