import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { generateOAuthState, validateOAuthState } from '../services/payment/encryption';
import * as paymentDb from '../services/payment/paymentDb';
import { getPaymentProvider } from '../services/payment/providerFactory';
import { PaymentProviderError } from '../services/payment/types';

const router = Router();

// In-memory rate limiting map: ip/user -> timestamp count
const RATE_LIMIT_MAP = new Map<string, { count: number; expiresAt: number }>();

function checkRateLimit(key: string, limit: number = 30, windowMs: number = 60000): boolean {
  const now = Date.now();
  const record = RATE_LIMIT_MAP.get(key);
  if (!record || now > record.expiresAt) {
    RATE_LIMIT_MAP.set(key, { count: 1, expiresAt: now + windowMs });
    return true;
  }
  if (record.count >= limit) {
    return false;
  }
  record.count += 1;
  return true;
}

// Helper to resolve authenticated user ID
function getAuthUserId(req: Request): string {
  // If user session exists or header is provided, use it. Default to usr_101 for preview
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const token = authHeader.split(' ')[1];
      const payloadBase64 = token.split('.')[1];
      if (payloadBase64) {
        const payload = JSON.parse(Buffer.from(payloadBase64, 'base64').toString('utf8'));
        if (payload.userId) return payload.userId;
      }
    } catch {
      // Continue to default
    }
  }

  const queryUserId = req.query.userId as string;
  const bodyUserId = req.body?.userId as string;
  return queryUserId || bodyUserId || 'usr_101';
}

function getHostUrl(req: Request): string {
  const protocol = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.get('host') || 'localhost:3000';
  return (process.env.APP_URL || `${protocol}://${host}`).replace(/\/+$/, '');
}

/**
 * -------------------------------------------------------------
 * 1. STATUS & OVERVIEW
 * GET /api/integrations/status
 * Returns connection state for both providers (NO secrets/tokens exposed)
 * -------------------------------------------------------------
 */
router.get('/status', async (req: Request, res: Response) => {
  try {
    const userId = getAuthUserId(req);
    const stripeProvider = getPaymentProvider(userId, 'stripe');
    const squareProvider = getPaymentProvider(userId, 'square');

    const [stripeAcc, squareAcc] = await Promise.all([
      stripeProvider.getAccount(),
      squareProvider.getAccount()
    ]);

    return res.status(200).json({
      success: true,
      userId,
      providers: {
        stripe: stripeAcc,
        square: squareAcc
      }
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * -------------------------------------------------------------
 * 2. STRIPE FLOW
 * -------------------------------------------------------------
 */

// GET /api/integrations/stripe/connect
router.get('/stripe/connect', async (req: Request, res: Response) => {
  const userId = getAuthUserId(req);
  if (!checkRateLimit(`stripe_connect_${userId}`, 15)) {
    return res.status(429).json({ error: 'Too many connection attempts. Please wait.' });
  }

  const state = generateOAuthState(userId, 'stripe');
  const redirectUri = `${getHostUrl(req)}/api/integrations/stripe/callback`;
  const clientId = process.env.STRIPE_CLIENT_ID;

  let authUrl = '';
  if (clientId) {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      scope: 'read_write',
      redirect_uri: redirectUri,
      state
    });
    authUrl = `https://connect.stripe.com/oauth/authorize?${params.toString()}`;
  } else {
    // In sandbox test environments, route to sandbox callback URL
    authUrl = `${redirectUri}?code=simulated_stripe_code&state=${encodeURIComponent(state)}`;
  }

  // If request accepts JSON (from API call), return JSON with authUrl; otherwise redirect
  if (req.headers.accept?.includes('application/json') || req.query.format === 'json') {
    return res.status(200).json({
      success: true,
      provider: 'stripe',
      authUrl,
      state
    });
  }

  return res.redirect(authUrl);
});

// GET /api/integrations/stripe/callback
router.get('/stripe/callback', async (req: Request, res: Response) => {
  const { code, state, error, error_description } = req.query;

  if (error) {
    console.error('[Stripe Callback] OAuth error from provider:', error, error_description);
    return res.redirect(`/?view=proposals&subtab=payment_providers&error=${encodeURIComponent(String(error_description || error))}`);
  }

  if (!state || typeof state !== 'string') {
    return res.status(400).send('Missing CSRF OAuth state.');
  }

  try {
    // Validate CSRF state & extract verified user ID
    const validatedState = validateOAuthState(state, 'stripe');
    const userId = validatedState.userId;

    const redirectUri = `${getHostUrl(req)}/api/integrations/stripe/callback`;
    const stripeProvider = getPaymentProvider(userId, 'stripe');

    await stripeProvider.connect(String(code || 'simulated_stripe_code'), redirectUri);

    console.log(`[Stripe Callback] Successfully connected Stripe account for user ${userId}`);
    return res.redirect('/?view=proposals&subtab=payment_providers&connected=stripe&status=success');
  } catch (err: any) {
    console.error('[Stripe Callback] Connection failed:', err);
    return res.redirect(`/?view=proposals&subtab=payment_providers&error=${encodeURIComponent(err.message || 'Stripe connection failed')}`);
  }
});

// POST /api/integrations/stripe/disconnect
router.post('/stripe/disconnect', async (req: Request, res: Response) => {
  try {
    const userId = getAuthUserId(req);
    const stripeProvider = getPaymentProvider(userId, 'stripe');
    await stripeProvider.disconnect();

    return res.status(200).json({
      success: true,
      message: 'Stripe account disconnected successfully.'
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * -------------------------------------------------------------
 * 3. SQUARE FLOW
 * -------------------------------------------------------------
 */

// GET /api/integrations/square/connect
router.get('/square/connect', async (req: Request, res: Response) => {
  const userId = getAuthUserId(req);
  if (!checkRateLimit(`square_connect_${userId}`, 15)) {
    return res.status(429).json({ error: 'Too many connection attempts. Please wait.' });
  }

  const state = generateOAuthState(userId, 'square');
  const redirectUri = `${getHostUrl(req)}/api/integrations/square/callback`;
  const appId = process.env.SQUARE_APPLICATION_ID;
  const isProd = process.env.SQUARE_ENVIRONMENT === 'production';
  const baseUrl = isProd ? 'https://connect.squareup.com' : 'https://connect.squareupsandbox.com';

  let authUrl = '';
  if (appId) {
    const permissions = [
      'INVOICES_WRITE',
      'INVOICES_READ',
      'ORDERS_WRITE',
      'ORDERS_READ',
      'CUSTOMERS_WRITE',
      'CUSTOMERS_READ',
      'MERCHANT_PROFILE_READ'
    ].join('+');

    authUrl = `${baseUrl}/oauth2/authorize?client_id=${appId}&scope=${permissions}&session=false&state=${encodeURIComponent(state)}&redirect_uri=${encodeURIComponent(redirectUri)}`;
  } else {
    // Sandbox fallback
    authUrl = `${redirectUri}?code=simulated_square_code&state=${encodeURIComponent(state)}`;
  }

  if (req.headers.accept?.includes('application/json') || req.query.format === 'json') {
    return res.status(200).json({
      success: true,
      provider: 'square',
      authUrl,
      state
    });
  }

  return res.redirect(authUrl);
});

// GET /api/integrations/square/callback
router.get('/square/callback', async (req: Request, res: Response) => {
  const { code, state, error, error_description } = req.query;

  if (error) {
    console.error('[Square Callback] OAuth error from provider:', error, error_description);
    return res.redirect(`/?view=proposals&subtab=payment_providers&error=${encodeURIComponent(String(error_description || error))}`);
  }

  if (!state || typeof state !== 'string') {
    return res.status(400).send('Missing CSRF OAuth state.');
  }

  try {
    const validatedState = validateOAuthState(state, 'square');
    const userId = validatedState.userId;

    const redirectUri = `${getHostUrl(req)}/api/integrations/square/callback`;
    const squareProvider = getPaymentProvider(userId, 'square');

    await squareProvider.connect(String(code || 'simulated_square_code'), redirectUri);

    console.log(`[Square Callback] Successfully connected Square account for user ${userId}`);
    return res.redirect('/?view=proposals&subtab=payment_providers&connected=square&status=success');
  } catch (err: any) {
    console.error('[Square Callback] Connection failed:', err);
    return res.redirect(`/?view=proposals&subtab=payment_providers&error=${encodeURIComponent(err.message || 'Square connection failed')}`);
  }
});

// POST /api/integrations/square/disconnect
router.post('/square/disconnect', async (req: Request, res: Response) => {
  try {
    const userId = getAuthUserId(req);
    const squareProvider = getPaymentProvider(userId, 'square');
    await squareProvider.disconnect();

    return res.status(200).json({
      success: true,
      message: 'Square account disconnected successfully.'
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * -------------------------------------------------------------
 * 4. INVOICE CREATION & SENDING VIA ADAPTER
 * -------------------------------------------------------------
 */

// POST /api/integrations/invoices/create
router.post('/invoices/create', async (req: Request, res: Response) => {
  try {
    const userId = getAuthUserId(req);
    const { 
      provider, 
      customer: customerData, 
      invoiceNumber, 
      currency, 
      dueDate, 
      description, 
      items,
      autoSend
    } = req.body;

    if (!provider || (provider !== 'stripe' && provider !== 'square')) {
      return res.status(400).json({ 
        success: false, 
        errorCode: 'PROVIDER_VALIDATION_ERROR',
        error: "Missing or invalid 'provider'. Must be 'stripe' or 'square'." 
      });
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ 
        success: false, 
        errorCode: 'PROVIDER_VALIDATION_ERROR',
        error: 'Invoice must contain at least one line item.' 
      });
    }

    const paymentProvider = getPaymentProvider(userId, provider);

    // 1. Find or create the Customer for this tenant
    let customerId = customerData?.id;
    if (!customerId && customerData?.email) {
      const createdCust = await paymentProvider.createCustomer({
        name: customerData.name || 'Client',
        email: customerData.email,
        billing_address: customerData.billing_address || {
          address: customerData.address || '100 Business St',
          city: customerData.city || 'Mililani',
          state: customerData.state || 'Hawaii',
          postal_code: customerData.postalCode || '94016',
          country: customerData.country || 'United States',
          tax_id: customerData.taxId
        }
      });
      customerId = createdCust.id;
    }

    if (!customerId) {
      // Use fallback default customer if none passed
      customerId = 'cust_kappy_001';
    }

    // 2. Create the Invoice with line items
    const invoice = await paymentProvider.createInvoice({
      customerId,
      invoiceNumber: invoiceNumber || `INV-${Date.now().toString().slice(-6)}`,
      currency: currency || 'USD',
      dueDate: dueDate || new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0],
      description: description || `Invoice #${invoiceNumber}`,
      items: items.map(it => ({
        description: it.description,
        quantity: Number(it.quantity) || 1,
        unit_price: Number(it.unit_price || it.price) || 0,
        tax_rate: Number(it.tax_rate) || 0
      }))
    });

    // 3. Auto send if requested
    let finalInvoice = invoice;
    if (autoSend) {
      finalInvoice = await paymentProvider.sendInvoice(invoice.id);
    }

    return res.status(200).json({
      success: true,
      provider,
      invoice: finalInvoice,
      message: autoSend ? 'Invoice created and sent via provider successfully.' : 'Invoice draft created successfully.'
    });
  } catch (err: any) {
    console.error('[Create Invoice Error]:', err);
    const statusCode = err instanceof PaymentProviderError ? err.statusCode : 500;
    const errorCode = err instanceof PaymentProviderError ? err.code : 'INVOICE_CREATION_FAILED';
    return res.status(statusCode).json({
      success: false,
      errorCode,
      error: err.message || 'Failed to create invoice via payment provider'
    });
  }
});

// POST /api/integrations/invoices/:id/send
router.post('/invoices/:id/send', async (req: Request, res: Response) => {
  try {
    const userId = getAuthUserId(req);
    const { id } = req.params;
    const invoice = await paymentDb.getInvoice(userId, id);

    if (!invoice) {
      return res.status(404).json({ success: false, error: `Invoice ${id} not found.` });
    }

    const paymentProvider = getPaymentProvider(userId, invoice.provider);
    const sentInvoice = await paymentProvider.sendInvoice(id);

    return res.status(200).json({
      success: true,
      provider: invoice.provider,
      invoice: sentInvoice,
      message: `Invoice #${sentInvoice.invoice_number} dispatched successfully via ${sentInvoice.provider.toUpperCase()}.`
    });
  } catch (err: any) {
    console.error('[Send Invoice Error]:', err);
    const statusCode = err instanceof PaymentProviderError ? err.statusCode : 500;
    const errorCode = err instanceof PaymentProviderError ? err.code : 'INVOICE_SEND_FAILED';
    return res.status(statusCode).json({
      success: false,
      errorCode,
      error: err.message || 'Failed to send invoice'
    });
  }
});

// GET /api/integrations/invoices
router.get('/invoices', async (req: Request, res: Response) => {
  try {
    const userId = getAuthUserId(req);
    const provider = req.query.provider as any;
    const invoices = await paymentDb.listInvoices(userId, provider);

    return res.status(200).json({
      success: true,
      userId,
      invoices
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/integrations/invoices/:id/void
router.post('/invoices/:id/void', async (req: Request, res: Response) => {
  try {
    const userId = getAuthUserId(req);
    const { id } = req.params;
    const invoice = await paymentDb.getInvoice(userId, id);

    if (!invoice) {
      return res.status(404).json({ success: false, error: `Invoice ${id} not found.` });
    }

    const paymentProvider = getPaymentProvider(userId, invoice.provider);
    const voided = await paymentProvider.voidInvoice(id);

    return res.status(200).json({
      success: true,
      invoice: voided,
      message: 'Invoice voided successfully.'
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
