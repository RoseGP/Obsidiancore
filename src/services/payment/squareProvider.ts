import axios from 'axios';
import crypto from 'crypto';
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

export class SquareProvider implements PaymentProvider {
  private userId: string;

  constructor(userId: string) {
    this.userId = userId;
  }

  private getBaseUrl(): string {
    const isProd = process.env.SQUARE_ENVIRONMENT === 'production';
    return isProd ? 'https://connect.squareup.com' : 'https://connect.squareupsandbox.com';
  }

  private isLiveToken(token: string): boolean {
    return Boolean(
      token && 
      !token.startsWith('mock_square_') && 
      !token.startsWith('sq_sim_') &&
      !token.startsWith('sq_live_at_') &&
      process.env.SQUARE_APPLICATION_ID && 
      process.env.SQUARE_APPLICATION_SECRET
    );
  }

  private async getAccessTokenAndLocation(): Promise<{ token: string; locationId: string }> {
    const connected = await paymentDb.getConnectedAccount(this.userId, 'square');
    if (!connected) {
      if (!process.env.SQUARE_ACCESS_TOKEN) {
        return {
          token: 'mock_square_sandbox_token',
          locationId: 'LOC_MOCK_SANDBOX_01'
        };
      }
      return {
        token: process.env.SQUARE_ACCESS_TOKEN,
        locationId: process.env.SQUARE_LOCATION_ID || 'main'
      };
    }

    try {
      const token = decryptToken(connected.access_token_encrypted);
      const locationId = connected.provider_metadata?.location_id || process.env.SQUARE_LOCATION_ID || 'main';
      return { token, locationId };
    } catch {
      throw new PaymentProviderError('PROVIDER_AUTH_EXPIRED', 'Square authorization token expired. Please reconnect.', 'square', null, 401);
    }
  }

  async connect(authCode: string, redirectUri: string): Promise<ConnectedAccount> {
    const appId = process.env.SQUARE_APPLICATION_ID;
    const appSecret = process.env.SQUARE_APPLICATION_SECRET;
    const baseUrl = this.getBaseUrl();

    let merchantId = `sq_merch_${Date.now()}`;
    let accessToken = `mock_square_sandbox_${Date.now()}`;
    let refreshToken = `mock_square_rt_${Date.now()}`;
    let businessName = 'Square Connected Merchant';
    let locationId = 'LOC_MAIN_2026';
    let expiresAt: string | undefined;

    if (appId && appSecret && authCode !== 'simulated_square_code') {
      try {
        const tokenRes = await axios.post(`${baseUrl}/oauth2/token`, {
          client_id: appId,
          client_secret: appSecret,
          code: authCode,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri
        });

        accessToken = tokenRes.data.access_token;
        refreshToken = tokenRes.data.refresh_token;
        merchantId = tokenRes.data.merchant_id || merchantId;
        if (tokenRes.data.expires_at) {
          expiresAt = tokenRes.data.expires_at;
        }

        // Fetch merchant profile and default location
        try {
          const merchRes = await axios.get(`${baseUrl}/v2/merchants/${merchantId}`, {
            headers: { Authorization: `Bearer ${accessToken}` }
          });
          businessName = merchRes.data.merchant?.business_name || businessName;

          const locRes = await axios.get(`${baseUrl}/v2/locations`, {
            headers: { Authorization: `Bearer ${accessToken}` }
          });
          const locs = locRes.data.locations || [];
          if (locs.length > 0) {
            locationId = locs[0].id;
          }
        } catch {
          // Keep defaults
        }
      } catch (err: any) {
        throw new PaymentProviderError(
          'PROVIDER_AUTH_REVOKED',
          `Square OAuth exchange failed: ${err.response?.data?.message || err.message}`,
          'square',
          err.response?.data,
          400
        );
      }
    } else {
      // Sandbox fallback
      businessName = 'Ace Studio Invoicing (Square Sandbox)';
    }

    const encryptedAccessToken = encryptToken(accessToken);
    const encryptedRefreshToken = refreshToken ? encryptToken(refreshToken) : undefined;

    const account: ConnectedAccount = {
      id: `conn_square_${this.userId}_${Date.now()}`,
      user_id: this.userId,
      provider: 'square',
      provider_account_id: merchantId,
      access_token_encrypted: encryptedAccessToken,
      refresh_token_encrypted: encryptedRefreshToken,
      token_expires_at: expiresAt,
      provider_metadata: {
        business_name: businessName,
        location_id: locationId,
        environment: process.env.SQUARE_ENVIRONMENT === 'production' ? 'production' : 'sandbox',
        capabilities: ['ORDERS_WRITE', 'INVOICES_WRITE', 'CUSTOMERS_WRITE']
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    return await paymentDb.saveConnectedAccount(account);
  }

  async disconnect(): Promise<void> {
    const connected = await paymentDb.getConnectedAccount(this.userId, 'square');
    if (connected && process.env.SQUARE_APPLICATION_ID && connected.access_token_encrypted) {
      try {
        const token = decryptToken(connected.access_token_encrypted);
        await axios.post(
          `${this.getBaseUrl()}/oauth2/revoke`,
          {
            client_id: process.env.SQUARE_APPLICATION_ID,
            access_token: token
          },
          {
            headers: {
              Authorization: `Client ${process.env.SQUARE_APPLICATION_SECRET}`
            }
          }
        ).catch(() => null);
      } catch {
        // Continue
      }
    }
    await paymentDb.removeConnectedAccount(this.userId, 'square');
  }

  async getAccount(): Promise<ProviderAccount> {
    const connected = await paymentDb.getConnectedAccount(this.userId, 'square');
    if (!connected) {
      return {
        provider: 'square',
        accountId: '',
        businessName: '',
        connected: false,
        environment: 'sandbox'
      };
    }

    return {
      provider: 'square',
      accountId: connected.provider_account_id,
      businessName: connected.provider_metadata?.business_name || 'Square Merchant',
      connected: true,
      environment: (connected.provider_metadata?.environment as any) || 'sandbox',
      connectedAt: connected.created_at
    };
  }

  async createCustomer(input: CreateCustomerInput): Promise<Customer> {
    let localCust = await paymentDb.findCustomerByEmail(this.userId, input.email);
    let squareCustomerId = localCust?.provider_customer_ids?.square;

    if (!squareCustomerId) {
      const { token } = await this.getAccessTokenAndLocation();
      if (this.isLiveToken(token)) {
        try {
          const res = await axios.post(
            `${this.getBaseUrl()}/v2/customers`,
            {
              idempotency_key: crypto.randomBytes(16).toString('hex'),
              given_name: input.name,
              email_address: input.email,
              address: input.billing_address ? {
                address_line_1: input.billing_address.address,
                locality: input.billing_address.city,
                administrative_district_level_1: input.billing_address.state,
                postal_code: input.billing_address.postal_code,
                country: 'US'
              } : undefined
            },
            {
              headers: { Authorization: `Bearer ${token}` }
            }
          );
          squareCustomerId = res.data.customer?.id;
        } catch (err: any) {
          throw new PaymentProviderError(
            'CUSTOMER_CREATION_FAILED',
            `Square customer creation failed: ${err.response?.data?.errors?.[0]?.detail || err.message}`,
            'square',
            err.response?.data
          );
        }
      } else {
        squareCustomerId = `cust_sq_sb_${Date.now()}`;
      }
    }

    if (localCust) {
      localCust.provider_customer_ids.square = squareCustomerId;
      if (input.billing_address) localCust.billing_address = input.billing_address;
      return await paymentDb.saveCustomer(localCust);
    }

    const newCustomer: Customer = {
      id: `cust_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      user_id: this.userId,
      name: input.name,
      email: input.email,
      provider_customer_ids: {
        square: squareCustomerId
      },
      billing_address: input.billing_address || {
        address: '95-1249 Meheula Pkwy',
        city: 'Mililani',
        state: 'HI',
        postal_code: '94016',
        country: 'United States'
      },
      created_at: new Date().toISOString()
    };

    return await paymentDb.saveCustomer(newCustomer);
  }

  /**
   * Helper to create a Square Order through the Orders API.
   * Square requires an order before an invoice can be created.
   */
  async createOrder(
    locationId: string,
    customerId: string,
    lineItems: any[],
    idempotencyKey?: string
  ): Promise<string> {
    const { token } = await this.getAccessTokenAndLocation();
    if (this.isLiveToken(token)) {
      const orderIdempotency = idempotencyKey || crypto.randomBytes(16).toString('hex');
      const orderResponse = await axios.post(
        `${this.getBaseUrl()}/v2/orders`,
        {
          idempotency_key: `ord_${orderIdempotency}`,
          order: {
            location_id: locationId,
            customer_id: customerId,
            line_items: lineItems
          }
        },
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );
      const squareOrderId = orderResponse.data.order?.id;
      if (!squareOrderId) {
        throw new PaymentProviderError('INVOICE_CREATION_FAILED', 'Square did not return an Order ID', 'square');
      }
      return squareOrderId;
    }
    return `ord_sq_mock_${Date.now()}`;
  }

  /**
   * Creates a Square Invoice
   * CRITICAL REQUIREMENT: Square requires an Order created first via the Orders API,
   * then attaches the Invoice to that Order.
   */
  async createInvoice(input: CreateInvoiceInput): Promise<Invoice> {
    if (input.idempotencyKey) {
      const existing = await paymentDb.getInvoiceByIdempotencyKey(this.userId, input.idempotencyKey);
      if (existing) {
        return existing;
      }
    }

    const { token, locationId } = await this.getAccessTokenAndLocation();
    const customer = await paymentDb.getCustomer(this.userId, input.customerId);
    if (!customer) {
      throw new PaymentProviderError('PROVIDER_VALIDATION_ERROR', `Customer ${input.customerId} not found`, 'square');
    }

    let squareCustomerId = customer.provider_customer_ids.square;
    if (!squareCustomerId) {
      const refreshed = await this.createCustomer({
        name: customer.name,
        email: customer.email,
        billing_address: customer.billing_address
      });
      squareCustomerId = refreshed.provider_customer_ids.square!;
    }

    const currency = (input.currency || 'USD').toUpperCase();
    let subtotal = 0;
    let taxTotal = 0;

    const lineItemsPayload = input.items.map(it => {
      const qty = Number(it.quantity) || 1;
      const price = Number(it.unit_price) || 0;
      const amt = qty * price;
      const taxRate = Number(it.tax_rate) || 0;
      const tax = (amt * taxRate) / 100;
      subtotal += amt;
      taxTotal += tax;
      return {
        name: it.description,
        quantity: String(qty),
        base_price_money: {
          amount: Math.round(price * 100),
          currency
        }
      };
    });

    const total = subtotal + taxTotal;
    const invoiceId = `inv_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    let squareInvoiceId = `sq_inv_sb_${Date.now()}`;
    let hostedInvoiceUrl = `https://squareupsandbox.com/pay/inv_${Date.now()}`;

    // Format dueDate to YYYY-MM-DD
    const dueDateStr = input.dueDate || new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0];

    const orderIdempotency = input.idempotencyKey || crypto.randomBytes(16).toString('hex');
    // STEP 1: Create Order via Orders API
    const squareOrderId = await this.createOrder(locationId, squareCustomerId, lineItemsPayload, orderIdempotency);

    if (this.isLiveToken(token)) {
      try {
        // STEP 2: Create Square Invoice associated with that Order
        const invoiceResponse = await axios.post(
          `${this.getBaseUrl()}/v2/invoices`,
          {
            idempotency_key: `inv_${orderIdempotency}`,
            invoice: {
              order_id: squareOrderId,
              location_id: locationId,
              primary_recipient: {
                customer_id: squareCustomerId
              },
              payment_requests: [
                {
                  request_type: 'BALANCE',
                  due_date: dueDateStr,
                  automatic_payment_source: 'NONE'
                }
              ],
              delivery_method: 'EMAIL',
              invoice_number: input.invoiceNumber,
              title: input.description || `Invoice #${input.invoiceNumber}`
            }
          },
          {
            headers: { Authorization: `Bearer ${token}` }
          }
        );

        const sqInvoice = invoiceResponse.data.invoice;
        squareInvoiceId = sqInvoice?.id || squareInvoiceId;
        hostedInvoiceUrl = sqInvoice?.public_url || hostedInvoiceUrl;
      } catch (err: any) {
        throw new PaymentProviderError(
          'INVOICE_CREATION_FAILED',
          `Square invoice creation failed: ${err.response?.data?.errors?.[0]?.detail || err.message}`,
          'square',
          err.response?.data
        );
      }
    }

    const items: InvoiceItem[] = input.items.map((it, idx) => ({
      id: `item_${invoiceId}_${idx}`,
      invoice_id: invoiceId,
      description: it.description,
      quantity: Number(it.quantity) || 1,
      unit_price: Number(it.unit_price) || 0,
      tax_rate: Number(it.tax_rate) || 0,
      amount: (Number(it.quantity) || 1) * (Number(it.unit_price) || 0)
    }));

    const invoice: Invoice = {
      id: invoiceId,
      user_id: this.userId,
      customer_id: customer.id,
      provider: 'square',
      provider_invoice_id: squareInvoiceId,
      invoice_number: input.invoiceNumber,
      currency,
      subtotal,
      tax: taxTotal,
      total,
      status: 'draft',
      due_date: dueDateStr,
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

  async publishInvoice(invoiceId: string): Promise<Invoice> {
    return this.sendInvoice(invoiceId);
  }

  async sendInvoice(invoiceId: string): Promise<Invoice> {
    const invoice = await paymentDb.getInvoice(this.userId, invoiceId);
    if (!invoice) {
      throw new PaymentProviderError('PROVIDER_VALIDATION_ERROR', `Invoice ${invoiceId} not found`, 'square');
    }

    const { token } = await this.getAccessTokenAndLocation();
    let finalUrl = invoice.hosted_invoice_url;

    if (this.isLiveToken(token) && !invoice.provider_invoice_id.startsWith('sq_inv_sb_')) {
      try {
        // In Square, to send an invoice we call /v2/invoices/{id}/publish
        // First retrieve current version
        const getRes = await axios.get(`${this.getBaseUrl()}/v2/invoices/${invoice.provider_invoice_id}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const version = getRes.data.invoice?.version || 0;

        const publishRes = await axios.post(
          `${this.getBaseUrl()}/v2/invoices/${invoice.provider_invoice_id}/publish`,
          {
            version,
            idempotency_key: crypto.randomBytes(16).toString('hex')
          },
          {
            headers: { Authorization: `Bearer ${token}` }
          }
        );

        finalUrl = publishRes.data.invoice?.public_url || finalUrl;
      } catch (err: any) {
        throw new PaymentProviderError(
          'INVOICE_SEND_FAILED',
          `Failed to publish Square invoice: ${err.response?.data?.errors?.[0]?.detail || err.message}`,
          'square',
          err.response?.data
        );
      }
    } else {
      // Sandbox mode: generate active hosted payment link
      finalUrl = `https://squareupsandbox.com/pay/${invoice.provider_invoice_id}#amount=${invoice.total}`;
    }

    const updated = await paymentDb.updateInvoiceStatus(invoice.id, 'open', {
      hosted_invoice_url: finalUrl
    });

    return updated || invoice;
  }

  async getInvoice(invoiceId: string): Promise<Invoice> {
    const inv = await paymentDb.getInvoice(this.userId, invoiceId);
    if (!inv) {
      throw new PaymentProviderError('PROVIDER_VALIDATION_ERROR', `Invoice ${invoiceId} not found`, 'square', null, 404);
    }
    return inv;
  }

  async listInvoices(): Promise<Invoice[]> {
    return await paymentDb.listInvoices(this.userId, 'square');
  }

  async voidInvoice(invoiceId: string): Promise<Invoice> {
    const invoice = await paymentDb.getInvoice(this.userId, invoiceId);
    if (!invoice) {
      throw new PaymentProviderError('PROVIDER_VALIDATION_ERROR', `Invoice ${invoiceId} not found`, 'square');
    }

    const { token } = await this.getAccessTokenAndLocation();
    if (this.isLiveToken(token) && !invoice.provider_invoice_id.startsWith('sq_inv_sb_')) {
      try {
        const getRes = await axios.get(`${this.getBaseUrl()}/v2/invoices/${invoice.provider_invoice_id}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const version = getRes.data.invoice?.version || 0;

        await axios.post(
          `${this.getBaseUrl()}/v2/invoices/${invoice.provider_invoice_id}/cancel`,
          {
            version,
            idempotency_key: crypto.randomBytes(16).toString('hex')
          },
          {
            headers: { Authorization: `Bearer ${token}` }
          }
        ).catch(() => null);
      } catch (err: any) {
        console.warn('[Square cancel invoice] API warning:', err.message);
      }
    }

    const updated = await paymentDb.updateInvoiceStatus(invoiceId, 'void');
    return updated || invoice;
  }
}
