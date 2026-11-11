/**
 * Payment Provider Architecture Types
 * Standard data models for multi-tenant SaaS Invoicing
 */

export interface User {
  id: string;
  email: string;
  name: string;
  created_at: string;
}

export type PaymentProviderType = 'stripe' | 'square';

export interface ConnectedAccount {
  id: string;
  user_id: string;
  provider: PaymentProviderType;
  provider_account_id: string;
  access_token_encrypted: string;
  refresh_token_encrypted?: string;
  token_expires_at?: string;
  provider_metadata?: {
    business_name?: string;
    email?: string;
    country?: string;
    currency?: string;
    environment?: 'sandbox' | 'production';
    capabilities?: string[];
    [key: string]: any;
  };
  created_at: string;
  updated_at: string;
}

export interface CustomerBillingAddress {
  address: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
  tax_id?: string;
}

export interface Customer {
  id: string;
  user_id: string;
  name: string;
  email: string;
  provider_customer_ids: Partial<Record<PaymentProviderType, string>>;
  billing_address: CustomerBillingAddress;
  created_at: string;
}

export type InvoiceStatus = 'draft' | 'open' | 'paid' | 'uncollectible' | 'void';

export interface InvoiceItem {
  id: string;
  invoice_id: string;
  description: string;
  quantity: number;
  unit_price: number;
  tax_rate: number;
  amount: number;
}

export interface Invoice {
  id: string;
  user_id: string;
  customer_id: string;
  provider: PaymentProviderType;
  provider_invoice_id: string;
  invoice_number: string;
  currency: string;
  subtotal: number;
  tax: number;
  total: number;
  status: InvoiceStatus;
  due_date: string;
  description: string;
  hosted_invoice_url: string;
  /** The Invoicing app invoice (billing/{orgId}/invoices/{id}) this provider invoice collects, if any. */
  billing_invoice_id?: string;
  created_at: string;
  updated_at: string;
  items?: InvoiceItem[];
  customer?: Customer;
}

export interface ProviderAccount {
  provider: PaymentProviderType;
  accountId: string;
  businessName: string;
  email?: string;
  connected: boolean;
  environment: 'sandbox' | 'production';
  connectedAt?: string;
}

export interface CreateCustomerInput {
  name: string;
  email: string;
  billing_address?: CustomerBillingAddress;
}

export interface CreateInvoiceItemInput {
  description: string;
  quantity: number;
  unit_price: number;
  tax_rate?: number;
}

export interface CreateInvoiceInput {
  customerId: string;
  invoiceNumber: string;
  currency: string;
  dueDate: string;
  description?: string;
  items: CreateInvoiceItemInput[];
  deliveryMethod?: 'email' | 'share_manually';
  idempotencyKey?: string;
  /** Links the provider invoice to an Invoicing app invoice so a confirmed payment marks it paid. */
  billingInvoiceId?: string;
}

/**
 * Standard Payment Provider Abstraction
 */
export interface PaymentProvider {
  connect(authCode: string, redirectUri: string): Promise<ConnectedAccount>;
  disconnect(): Promise<void>;
  getAccount(): Promise<ProviderAccount>;
  createCustomer(input: CreateCustomerInput): Promise<Customer>;
  createInvoice(input: CreateInvoiceInput): Promise<Invoice>;
  sendInvoice(invoiceId: string): Promise<Invoice>;
  getInvoice(invoiceId: string): Promise<Invoice>;
  listInvoices(): Promise<Invoice[]>;
  voidInvoice(invoiceId: string): Promise<Invoice>;
}

/**
 * Provider-Independent Error System
 */
export type PaymentErrorCode =
  | 'PROVIDER_NOT_CONNECTED'
  | 'PROVIDER_NOT_CONFIGURED'
  | 'PROVIDER_AUTH_EXPIRED'
  | 'PROVIDER_AUTH_REVOKED'
  | 'CUSTOMER_CREATION_FAILED'
  | 'INVOICE_CREATION_FAILED'
  | 'INVOICE_SEND_FAILED'
  | 'PROVIDER_RATE_LIMITED'
  | 'PROVIDER_VALIDATION_ERROR'
  | 'UNAUTHORIZED_ACCESS'
  | 'CSRF_STATE_INVALID'
  | 'WEBHOOK_SIGNATURE_INVALID';

export class PaymentProviderError extends Error {
  public code: PaymentErrorCode;
  public provider?: PaymentProviderType;
  public details?: any;
  public statusCode: number;

  constructor(
    code: PaymentErrorCode,
    message: string,
    provider?: PaymentProviderType,
    details?: any,
    statusCode: number = 400
  ) {
    super(message);
    this.name = 'PaymentProviderError';
    this.code = code;
    this.provider = provider;
    this.details = details;
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, PaymentProviderError.prototype);
  }
}
