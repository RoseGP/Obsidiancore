import Stripe from 'stripe';
import { 
  PaymentProvider, 
  ConnectedAccount, 
  ProviderAccount, 
  Customer, 
  Invoice, 
  InvoiceItem, 
  CreateCustomerInput, 
  CreateInvoiceInput, 
  PaymentProviderError 
} from './types';
import { encryptToken, decryptToken } from './encryption';
import * as paymentDb from './paymentDb';
import { optionalSecret } from '../../utils/secrets';

export class StripeProvider implements PaymentProvider {
  private userId: string;
  private stripeClient: Stripe | null = null;
  private connectedAccount: ConnectedAccount | null = null;

  constructor(userId: string) {
    this.userId = userId;
  }

  /**
   * Initializes Stripe SDK using either platform secret key or connected account access token
   */
  private async getStripeClient(): Promise<{ stripe: Stripe; accountId?: string }> {
    const connected = await paymentDb.getConnectedAccount(this.userId, 'stripe');
    const secretKey = optionalSecret('STRIPE_SECRET_KEY');

    if (!connected && !process.env.STRIPE_SECRET_KEY) {
      // In development fallback mode, initialize sandbox mock
      return {
        stripe: new Stripe(secretKey, { apiVersion: '2023-10-16' as any })
      };
    }

    if (!connected) {
      throw new PaymentProviderError('PROVIDER_NOT_CONNECTED', 'Stripe account is not connected for this user', 'stripe', null, 400);
    }

    this.connectedAccount = connected;
    let accessToken: string;
    try {
      accessToken = decryptToken(connected.access_token_encrypted);
    } catch {
      throw new PaymentProviderError('PROVIDER_AUTH_EXPIRED', 'Stripe authorization has expired or token is invalid. Please reconnect.', 'stripe', null, 401);
    }

    // Connect with platform secret key acting on behalf of the connected account
    const stripe = new Stripe(accessToken || secretKey, {
      apiVersion: '2023-10-16' as any
    });

    return { stripe, accountId: connected.provider_account_id };
  }

  /**
   * Connect OAuth Flow
   * Exchanges authorization code for Stripe Connect tokens
   */
  async connect(authCode: string, redirectUri: string): Promise<ConnectedAccount> {
    const clientId = process.env.STRIPE_CLIENT_ID;
    const secretKey = process.env.STRIPE_SECRET_KEY;

    let stripeUserId = `acct_stripe_${Date.now()}`;
    let accessToken = `sk_live_token_simulated_${Date.now()}`;
    let refreshToken = `rt_live_token_simulated_${Date.now()}`;
    let businessName = 'Stripe Connected Merchant';
    let email = 'billing@stripe-merchant.io';

    if (clientId && secretKey && authCode !== 'simulated_stripe_code') {
      try {
        const stripe = new Stripe(secretKey, { apiVersion: '2023-10-16' as any });
        const response = await stripe.oauth.token({
          grant_type: 'authorization_code',
          code: authCode,
          redirect_uri: redirectUri
        });

        stripeUserId = response.stripe_user_id || stripeUserId;
        accessToken = response.access_token || accessToken;
        refreshToken = response.refresh_token || refreshToken;

        // Retrieve merchant profile
        try {
          const acc = await stripe.accounts.retrieve(stripeUserId);
          businessName = acc.business_profile?.name || acc.settings?.dashboard?.display_name || businessName;
          email = acc.email || email;
        } catch {
          // Keep defaults
        }
      } catch (err: any) {
        throw new PaymentProviderError(
          'PROVIDER_AUTH_REVOKED',
          `Stripe OAuth exchange failed: ${err.message}`,
          'stripe',
          err,
          400
        );
      }
    } else {
      // Sandbox mode: generate realistic test merchant
      businessName = 'Ace Studio Invoicing (Stripe Test)';
      email = 'pay@acestudio.pro';
    }

    const encryptedAccessToken = encryptToken(accessToken);
    const encryptedRefreshToken = refreshToken ? encryptToken(refreshToken) : undefined;

    const account: ConnectedAccount = {
      id: `conn_stripe_${this.userId}_${Date.now()}`,
      user_id: this.userId,
      provider: 'stripe',
      provider_account_id: stripeUserId,
      access_token_encrypted: encryptedAccessToken,
      refresh_token_encrypted: encryptedRefreshToken,
      provider_metadata: {
        business_name: businessName,
        email,
        environment: process.env.STRIPE_SECRET_KEY?.startsWith('sk_live') ? 'production' : 'sandbox',
        capabilities: ['invoicing', 'card_payments']
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    return await paymentDb.saveConnectedAccount(account);
  }

  async disconnect(): Promise<void> {
    const connected = await paymentDb.getConnectedAccount(this.userId, 'stripe');
    if (connected && process.env.STRIPE_SECRET_KEY && connected.access_token_encrypted) {
      try {
        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' as any });
        await stripe.oauth.deauthorize({
          client_id: process.env.STRIPE_CLIENT_ID || '',
          stripe_user_id: connected.provider_account_id
        }).catch(() => null);
      } catch {
        // Continue with local disconnect
      }
    }
    await paymentDb.removeConnectedAccount(this.userId, 'stripe');
  }

  async getAccount(): Promise<ProviderAccount> {
    const connected = await paymentDb.getConnectedAccount(this.userId, 'stripe');
    if (!connected) {
      return {
        provider: 'stripe',
        accountId: '',
        businessName: '',
        connected: false,
        environment: 'sandbox'
      };
    }

    return {
      provider: 'stripe',
      accountId: connected.provider_account_id,
      businessName: connected.provider_metadata?.business_name || 'Stripe Merchant',
      email: connected.provider_metadata?.email,
      connected: true,
      environment: (connected.provider_metadata?.environment as any) || 'sandbox',
      connectedAt: connected.created_at
    };
  }

  async createCustomer(input: CreateCustomerInput): Promise<Customer> {
    // 1. Check if customer already exists for this tenant
    let localCust = await paymentDb.findCustomerByEmail(this.userId, input.email);
    let stripeCustomerId = localCust?.provider_customer_ids?.stripe;

    if (!stripeCustomerId) {
      const { stripe, accountId } = await this.getStripeClient();
      try {
        if (process.env.STRIPE_SECRET_KEY) {
          const stripeCust = await stripe.customers.create(
            {
              name: input.name,
              email: input.email,
              address: input.billing_address ? {
                line1: input.billing_address.address,
                city: input.billing_address.city,
                state: input.billing_address.state,
                postal_code: input.billing_address.postal_code,
                country: input.billing_address.country
              } : undefined,
              metadata: {
                app_user_id: this.userId
              }
            },
            accountId ? { stripeAccount: accountId } : undefined
          );
          stripeCustomerId = stripeCust.id;
        } else {
          // Sandbox mock id
          stripeCustomerId = `cus_stripe_sb_${Date.now()}`;
        }
      } catch (err: any) {
        throw new PaymentProviderError(
          'CUSTOMER_CREATION_FAILED',
          `Failed to create Stripe customer: ${err.message}`,
          'stripe',
          err
        );
      }
    }

    if (localCust) {
      localCust.provider_customer_ids.stripe = stripeCustomerId;
      if (input.billing_address) localCust.billing_address = input.billing_address;
      return await paymentDb.saveCustomer(localCust);
    }

    const newCustomer: Customer = {
      id: `cust_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      user_id: this.userId,
      name: input.name,
      email: input.email,
      provider_customer_ids: {
        stripe: stripeCustomerId
      },
      billing_address: input.billing_address || {
        address: '100 Business Way',
        city: 'San Francisco',
        state: 'CA',
        postal_code: '94107',
        country: 'United States'
      },
      created_at: new Date().toISOString()
    };

    return await paymentDb.saveCustomer(newCustomer);
  }

  async createInvoice(input: CreateInvoiceInput): Promise<Invoice> {
    if (input.idempotencyKey) {
      const existing = await paymentDb.getInvoiceByIdempotencyKey(this.userId, input.idempotencyKey);
      if (existing) {
        return existing;
      }
    }

    const { stripe, accountId } = await this.getStripeClient();
    const customer = await paymentDb.getCustomer(this.userId, input.customerId);
    if (!customer) {
      throw new PaymentProviderError('PROVIDER_VALIDATION_ERROR', `Customer ${input.customerId} not found`, 'stripe');
    }

    let stripeCustomerId = customer.provider_customer_ids.stripe;
    if (!stripeCustomerId) {
      const refreshed = await this.createCustomer({
        name: customer.name,
        email: customer.email,
        billing_address: customer.billing_address
      });
      stripeCustomerId = refreshed.provider_customer_ids.stripe!;
    }

    const currency = (input.currency || 'usd').toLowerCase();
    let subtotal = 0;
    let taxTotal = 0;

    const invoiceItemsPayload = input.items.map(it => {
      const qty = Number(it.quantity) || 1;
      const price = Number(it.unit_price) || 0;
      const amt = qty * price;
      const taxRate = Number(it.tax_rate) || 0;
      const tax = (amt * taxRate) / 100;
      subtotal += amt;
      taxTotal += tax;
      return {
        description: it.description,
        quantity: qty,
        unit_price: price,
        tax_rate: taxRate,
        amount: amt
      };
    });

    const total = subtotal + taxTotal;
    const invoiceId = `inv_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    let stripeInvoiceId = `in_stripe_sb_${Date.now()}`;
    let hostedInvoiceUrl = `https://invoice.stripe.com/i/acct_simulated/invst_${Date.now()}`;

    // Calculate due date timestamp in seconds
    const dueTimestamp = Math.floor(new Date(input.dueDate).getTime() / 1000) || Math.floor(Date.now() / 1000) + 14 * 86400;

    if (process.env.STRIPE_SECRET_KEY) {
      try {
        const stripeReqOptions = accountId ? { stripeAccount: accountId } : undefined;

        // 1. Create Stripe Invoice Items
        for (const it of invoiceItemsPayload) {
          await stripe.invoiceItems.create(
            {
              customer: stripeCustomerId,
              amount: Math.round(it.amount * 100), // convert to cents
              currency,
              description: it.description
            },
            stripeReqOptions
          );
        }

        // 2. Create the Stripe Invoice
        const stripeInvoice = await stripe.invoices.create(
          {
            customer: stripeCustomerId,
            collection_method: 'send_invoice',
            due_date: dueTimestamp,
            description: input.description || `Invoice #${input.invoiceNumber}`,
            auto_advance: false,
            metadata: {
              app_invoice_id: invoiceId,
              app_user_id: this.userId,
              invoice_number: input.invoiceNumber
            }
          },
          stripeReqOptions
        );

        stripeInvoiceId = stripeInvoice.id;
        hostedInvoiceUrl = stripeInvoice.hosted_invoice_url || hostedInvoiceUrl;
      } catch (err: any) {
        throw new PaymentProviderError(
          'INVOICE_CREATION_FAILED',
          `Stripe invoice creation failed: ${err.message}`,
          'stripe',
          err
        );
      }
    }

    const items: InvoiceItem[] = invoiceItemsPayload.map((it, idx) => ({
      id: `item_${invoiceId}_${idx}`,
      invoice_id: invoiceId,
      description: it.description,
      quantity: it.quantity,
      unit_price: it.unit_price,
      tax_rate: it.tax_rate,
      amount: it.amount
    }));

    const invoice: Invoice = {
      id: invoiceId,
      user_id: this.userId,
      customer_id: customer.id,
      provider: 'stripe',
      provider_invoice_id: stripeInvoiceId,
      invoice_number: input.invoiceNumber,
      currency: currency.toUpperCase(),
      subtotal,
      tax: taxTotal,
      total,
      status: 'draft',
      due_date: input.dueDate,
      description: input.description || `Invoice #${input.invoiceNumber}`,
      hosted_invoice_url: hostedInvoiceUrl,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const saved = await paymentDb.saveInvoice(invoice, items);
    if (input.idempotencyKey) {
      await paymentDb.registerInvoiceIdempotencyKey(this.userId, input.idempotencyKey, saved.id);
    }
    return saved;
  }

  async finalizeInvoice(invoiceId: string): Promise<Invoice> {
    const invoice = await paymentDb.getInvoice(this.userId, invoiceId);
    if (!invoice) {
      throw new PaymentProviderError('PROVIDER_VALIDATION_ERROR', `Invoice ${invoiceId} not found`, 'stripe');
    }

    const { stripe, accountId } = await this.getStripeClient();
    let finalUrl = invoice.hosted_invoice_url;

    if (process.env.STRIPE_SECRET_KEY && !invoice.provider_invoice_id.startsWith('in_stripe_sb_')) {
      try {
        const stripeReqOptions = accountId ? { stripeAccount: accountId } : undefined;
        const finalized = await stripe.invoices.finalizeInvoice(invoice.provider_invoice_id, stripeReqOptions);
        finalUrl = finalized.hosted_invoice_url || finalUrl;
      } catch (err: any) {
        throw new PaymentProviderError(
          'INVOICE_SEND_FAILED',
          `Failed to finalize Stripe invoice: ${err.message}`,
          'stripe',
          err
        );
      }
    } else {
      finalUrl = `https://invoice.stripe.com/test-i/${invoice.provider_invoice_id}#finalized`;
    }

    const updated = await paymentDb.updateInvoiceStatus(invoice.id, 'open', {
      hosted_invoice_url: finalUrl
    });

    return updated || invoice;
  }

  async sendInvoice(invoiceId: string): Promise<Invoice> {
    const invoice = await this.finalizeInvoice(invoiceId);
    const { stripe, accountId } = await this.getStripeClient();

    if (process.env.STRIPE_SECRET_KEY && !invoice.provider_invoice_id.startsWith('in_stripe_sb_')) {
      try {
        const stripeReqOptions = accountId ? { stripeAccount: accountId } : undefined;
        const sent = await stripe.invoices.sendInvoice(invoice.provider_invoice_id, stripeReqOptions);
        const finalUrl = sent.hosted_invoice_url || invoice.hosted_invoice_url;
        const updated = await paymentDb.updateInvoiceStatus(invoice.id, 'open', {
          hosted_invoice_url: finalUrl
        });
        return updated || invoice;
      } catch (err: any) {
        throw new PaymentProviderError(
          'INVOICE_SEND_FAILED',
          `Failed to send Stripe invoice: ${err.message}`,
          'stripe',
          err
        );
      }
    }

    return invoice;
  }

  async getInvoice(invoiceId: string): Promise<Invoice> {
    const inv = await paymentDb.getInvoice(this.userId, invoiceId);
    if (!inv) {
      throw new PaymentProviderError('PROVIDER_VALIDATION_ERROR', `Invoice ${invoiceId} not found`, 'stripe', null, 404);
    }
    return inv;
  }

  async listInvoices(): Promise<Invoice[]> {
    return await paymentDb.listInvoices(this.userId, 'stripe');
  }

  async voidInvoice(invoiceId: string): Promise<Invoice> {
    const invoice = await paymentDb.getInvoice(this.userId, invoiceId);
    if (!invoice) {
      throw new PaymentProviderError('PROVIDER_VALIDATION_ERROR', `Invoice ${invoiceId} not found`, 'stripe');
    }

    const { stripe, accountId } = await this.getStripeClient();
    if (process.env.STRIPE_SECRET_KEY && !invoice.provider_invoice_id.startsWith('in_stripe_sb_')) {
      try {
        await stripe.invoices.voidInvoice(invoice.provider_invoice_id, accountId ? { stripeAccount: accountId } : undefined);
      } catch (err: any) {
        console.warn('[Stripe void] API warning:', err.message);
      }
    }

    const updated = await paymentDb.updateInvoiceStatus(invoiceId, 'void');
    return updated || invoice;
  }
}
