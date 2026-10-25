/**
 * Payment Provider Abstraction and Cloudflare D1 Data Models
 * Multi-tenant SaaS Invoicing with Test Mode Support
 */

export type SupportedPaymentProvider = 'stripe' | 'square' | 'paypal';

export type PaymentAccountStatus = 'active' | 'pending' | 'disconnected';

export type LocalInvoicePaymentStatus = 'unpaid' | 'open' | 'paid' | 'failed' | 'void';

/**
 * Normalized Payment Provider Interface
 * Designed so Stripe, Square, and PayPal share the same contract.
 */
export interface PaymentProvider {
  providerName: SupportedPaymentProvider;
  
  createInvoice(input: CreateProviderInvoiceInput): Promise<ProviderInvoice>;
  sendInvoice(providerInvoiceId: string): Promise<void>;
  getInvoice(providerInvoiceId: string): Promise<ProviderInvoice>;
}

export interface CreateProviderInvoiceItemInput {
  description: string;
  quantity: number;
  unitPriceCents: number; // Stored and transmitted in integer minor units (e.g. $25.99 = 2599)
  taxRatePercent?: number; // e.g. 10 for 10%
  amountCents: number;
}

export interface CreateProviderInvoiceInput {
  invoiceId: string;
  businessId: string;
  connectedAccountId?: string;
  customer: {
    id: string;
    name: string;
    email: string;
    stripeCustomerId?: string;
    billingAddress?: {
      address?: string;
      city?: string;
      state?: string;
      postalCode?: string;
      country?: string;
      taxId?: string;
    };
  };
  invoiceNumber: string;
  currency: string;
  items: CreateProviderInvoiceItemInput[];
  subtotalCents: number; // Integer minor units
  taxCents: number;      // Integer minor units
  totalCents: number;    // Integer minor units
  dueDate?: string;
  description?: string;
}

export interface ProviderInvoice {
  id: string;
  providerInvoiceId: string;
  paymentUrl: string;
  paymentStatus: LocalInvoicePaymentStatus;
  totalCents: number;
  currency: string;
  customerEmail?: string;
  metadata?: Record<string, any>;
}

/**
 * Cloudflare D1 Database Entities
 */

export interface D1Business {
  id: string;
  name: string;
  email: string;
  created_at: string;
  updated_at: string;
}

export interface D1PaymentAccount {
  id: string;
  business_id: string;
  provider: SupportedPaymentProvider;
  provider_account_id: string;
  status: PaymentAccountStatus;
  access_token_encrypted: string | null;
  refresh_token_encrypted: string | null;
  created_at: string;
  updated_at: string;
}

export interface D1Customer {
  id: string;
  business_id: string;
  name: string;
  email: string;
  stripe_customer_id: string | null;
  billing_address: string | null; // JSON string
  created_at: string;
  updated_at: string;
}

export interface D1InvoiceItem {
  id: string;
  invoice_id: string;
  description: string;
  quantity: number;
  unit_price_cents: number; // Integer cents
  tax_rate_percent: number;
  amount_cents: number;     // Integer cents
}

export interface D1Invoice {
  id: string;
  business_id: string;
  customer_id: string;
  invoice_number: string;
  currency: string;
  subtotal_cents: number; // Integer cents
  tax_cents: number;      // Integer cents
  total_cents: number;    // Integer cents
  status: 'draft' | 'open' | 'paid' | 'void' | 'uncollectible';
  payment_provider: SupportedPaymentProvider | null;
  provider_invoice_id: string | null;
  payment_url: string | null;
  payment_status: LocalInvoicePaymentStatus;
  due_date: string | null;
  description: string | null;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
  items?: D1InvoiceItem[];
  customer?: D1Customer;
}

export interface D1WebhookEvent {
  id: string;
  provider: SupportedPaymentProvider;
  event_id: string;
  processed_at: string;
  created_at: string;
}
