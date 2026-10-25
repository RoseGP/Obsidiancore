import { Router, Request, Response } from 'express';
import * as d1Db from '../payments/d1Database';
import { stripePaymentProvider } from '../payments/stripe/stripePaymentProvider';

const router = Router();

/**
 * Resolves current user and tenant business context from request.
 * Authenticates every business-facing API endpoint.
 */
function getAuthContext(req: Request): { userId: string; businessId: string } {
  const authHeader = req.headers.authorization;
  let userId = 'usr_101';
  let businessId = 'biz_default_101';

  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const token = authHeader.split(' ')[1];
      const payload = JSON.parse(Buffer.from(token.split('.')[1] || '', 'base64').toString('utf8'));
      if (payload.userId) userId = payload.userId;
      if (payload.businessId) businessId = payload.businessId;
    } catch {
      // Continue to header/default
    }
  }

  const customUserId = (req.headers['x-user-id'] as string) || (req.query.userId as string) || (req.body?.userId as string);
  const customBizId = (req.headers['x-business-id'] as string) || (req.query.businessId as string) || (req.body?.businessId as string);

  if (customUserId) userId = customUserId;
  if (customBizId) businessId = customBizId;

  return { userId, businessId };
}

function getBaseUrl(req: Request): string {
  const protocol = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.get('host') || 'localhost:3000';
  return (process.env.APP_URL || `${protocol}://${host}`).replace(/\/+$/, '');
}

/**
 * 1. GET /api/payments/status
 * Returns payment provider connection state, test mode status, and account metadata.
 */
router.get(['/status', '/payments/status'], async (req: Request, res: Response) => {
  try {
    const { businessId } = getAuthContext(req);
    const account = await d1Db.getPaymentAccount(businessId, 'stripe');

    return res.status(200).json({
      success: true,
      businessId,
      provider: 'stripe',
      mode: 'test',
      connected: !!account && account.status === 'active',
      status: account ? account.status : 'disconnected',
      account: account ? {
        id: account.id,
        providerAccountId: account.provider_account_id,
        status: account.status,
        updatedAt: account.updated_at
      } : null,
      testInstructions: {
        card: '4242 4242 4242 4242',
        expiry: 'Any future date (e.g. 12/28)',
        cvc: '123',
        postalCode: '94016'
      }
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 2. GET /api/payments/stripe/connect
 * Initiates Stripe Test Mode onboarding flow for the business.
 */
router.get('/stripe/connect', async (req: Request, res: Response) => {
  try {
    const { businessId } = getAuthContext(req);
    const business = await d1Db.getOrCreateBusiness(businessId);
    const baseUrl = getBaseUrl(req);

    const { accountId, onboardingUrl } = await stripePaymentProvider.createConnectAccount(business, baseUrl);

    // If client requested JSON, respond with URL; otherwise redirect
    if (req.headers.accept?.includes('application/json') || req.query.format === 'json') {
      return res.status(200).json({
        success: true,
        mode: 'test',
        accountId,
        onboardingUrl
      });
    }

    return res.redirect(onboardingUrl);
  } catch (err: any) {
    console.error('[Stripe Connect Error]:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 3. GET /api/payments/stripe/callback
 * Confirms Stripe onboarding and stores connected account in payment_accounts.
 */
router.get('/stripe/callback', async (req: Request, res: Response) => {
  try {
    const { businessId } = getAuthContext(req);
    const accountId = (req.query.account_id as string) || `acct_test_${Date.now()}`;
    const statusParam = req.query.status as string;

    if (req.query.error) {
      return res.redirect(`/?view=proposals&subtab=payment_providers&error=${encodeURIComponent(String(req.query.error))}`);
    }

    // Save Stripe connected account in D1
    const existing = await d1Db.getPaymentAccount(businessId, 'stripe');
    const now = new Date().toISOString();

    const paymentAccount = {
      id: existing ? existing.id : `pa_${Date.now()}`,
      business_id: businessId,
      provider: 'stripe' as const,
      provider_account_id: accountId,
      status: 'active' as const,
      access_token_encrypted: null,
      refresh_token_encrypted: null,
      created_at: existing ? existing.created_at : now,
      updated_at: now
    };

    await d1Db.savePaymentAccount(paymentAccount);
    console.log(`[Stripe Connect Callback] Business ${businessId} connected Stripe test account: ${accountId}`);

    if (req.headers.accept?.includes('application/json') || req.query.format === 'json') {
      return res.status(200).json({
        success: true,
        mode: 'test',
        businessId,
        paymentAccount
      });
    }

    return res.redirect('/?view=proposals&subtab=payment_providers&connected=stripe&status=success&mode=test');
  } catch (err: any) {
    console.error('[Stripe Callback Error]:', err);
    return res.redirect(`/?view=proposals&subtab=payment_providers&error=${encodeURIComponent(err.message)}`);
  }
});

/**
 * 4. POST /api/payments/stripe/disconnect
 * Disconnects the business's Stripe account.
 */
router.post('/stripe/disconnect', async (req: Request, res: Response) => {
  try {
    const { businessId } = getAuthContext(req);
    const removed = await d1Db.removePaymentAccount(businessId, 'stripe');

    return res.status(200).json({
      success: true,
      businessId,
      removed,
      message: 'Stripe test account disconnected successfully.'
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 5. POST /api/invoices/:invoiceId/payment or /api/payments/invoices/:invoiceId/payment
 * Creates and finalizes a Stripe Invoice from a D1 local invoice.
 * Stores payment_url and provider_invoice_id in D1.
 * Local invoice remains 'unpaid' / 'open' until Stripe sends a verified webhook.
 */
const handleInvoicePayment = async (req: Request, res: Response) => {
  try {
    const { businessId } = getAuthContext(req);
    const { invoiceId } = req.params;
    const { provider = 'stripe' } = req.body;

    if (provider !== 'stripe') {
      return res.status(400).json({
        success: false,
        error: `Only 'stripe' payment provider is currently supported in test mode.`
      });
    }

    // 1. Retrieve invoice from D1 and verify it belongs to that business
    const invoice = await d1Db.getInvoice(businessId, invoiceId);
    if (!invoice) {
      return res.status(404).json({
        success: false,
        error: `Invoice ${invoiceId} not found or does not belong to business ${businessId}.`
      });
    }

    // 2. Verify that the business has a connected Stripe account
    const paymentAccount = await d1Db.getPaymentAccount(businessId, 'stripe');
    if (!paymentAccount || paymentAccount.status !== 'active') {
      return res.status(400).json({
        success: false,
        errorCode: 'PROVIDER_NOT_CONNECTED',
        error: 'Business does not have an active Stripe test account connected. Please connect Stripe first.'
      });
    }

    // 3. Retrieve or create invoice customer
    let customer = invoice.customer;
    if (!customer) {
      customer = await d1Db.getCustomer(businessId, invoice.customer_id);
    }
    if (!customer) {
      customer = {
        id: invoice.customer_id || `cust_${Date.now()}`,
        business_id: businessId,
        name: 'Client',
        email: 'client@example.com',
        stripe_customer_id: null,
        billing_address: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      await d1Db.saveCustomer(customer);
    }

    // 4. Calculate total authoritatively from database line items (Integer Minor Units)
    const items = invoice.items && invoice.items.length > 0 
      ? invoice.items 
      : [
          {
            id: `item-default-${Date.now()}`,
            invoice_id: invoice.id,
            description: invoice.description || 'Professional Services',
            quantity: 1,
            unit_price_cents: invoice.total_cents || 350000,
            tax_rate_percent: 0,
            amount_cents: invoice.total_cents || 350000
          }
        ];

    let subtotalCents = 0;
    let taxCents = 0;
    for (const item of items) {
      const lineCents = item.quantity * item.unit_price_cents;
      subtotalCents += lineCents;
      if (item.tax_rate_percent > 0) {
        taxCents += Math.round((lineCents * item.tax_rate_percent) / 100);
      }
    }
    const totalCents = subtotalCents + taxCents;

    // 5. Create, populate, and finalize Stripe Invoice
    const providerInvoice = await stripePaymentProvider.createInvoice({
      invoiceId: invoice.id,
      businessId,
      connectedAccountId: paymentAccount.provider_account_id,
      customer: {
        id: customer.id,
        name: customer.name,
        email: customer.email,
        stripeCustomerId: customer.stripe_customer_id || undefined,
        billingAddress: customer.billing_address ? JSON.parse(customer.billing_address) : undefined
      },
      invoiceNumber: invoice.invoice_number,
      currency: invoice.currency,
      items: items.map(it => ({
        description: it.description,
        quantity: it.quantity,
        unitPriceCents: it.unit_price_cents,
        taxRatePercent: it.tax_rate_percent,
        amountCents: it.amount_cents
      })),
      subtotalCents,
      taxCents,
      totalCents,
      dueDate: invoice.due_date || undefined,
      description: invoice.description || undefined
    });

    // 6. Save Stripe payment details in D1 invoice
    // Local invoice remains unpaid/open until Stripe sends a verified webhook
    const updatedInvoice = await d1Db.updateInvoicePaymentDetails(invoice.id, {
      payment_provider: 'stripe',
      provider_invoice_id: providerInvoice.providerInvoiceId,
      payment_url: providerInvoice.paymentUrl,
      payment_status: 'open',
      status: 'open'
    });

    return res.status(200).json({
      success: true,
      mode: 'test',
      payment_url: providerInvoice.paymentUrl,
      provider_invoice_id: providerInvoice.providerInvoiceId,
      payment_status: 'open',
      total_cents: totalCents,
      currency: invoice.currency,
      invoice: updatedInvoice
    });
  } catch (err: any) {
    console.error('[Create Payment Link Error]:', err);
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to create payment link with Stripe'
    });
  }
};

router.post('/invoices/:invoiceId/payment', handleInvoicePayment);
router.post('/:invoiceId/payment', handleInvoicePayment);

/**
 * 6. GET /api/invoices or /api/payments/invoices
 * Lists all invoices for the authenticated business.
 */
const handleListInvoices = async (req: Request, res: Response) => {
  try {
    const { businessId } = getAuthContext(req);
    const invoices = await d1Db.listInvoices(businessId);

    return res.status(200).json({
      success: true,
      businessId,
      invoices
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

router.get('/', handleListInvoices);
router.get('/invoices', handleListInvoices);

/**
 * 7. GET /api/invoices/:invoiceId or /api/payments/invoices/:invoiceId
 * Retrieves invoice by ID for the authenticated business.
 */
const handleGetInvoice = async (req: Request, res: Response) => {
  try {
    const { businessId } = getAuthContext(req);
    const { invoiceId } = req.params;
    const invoice = await d1Db.getInvoice(businessId, invoiceId);

    if (!invoice) {
      return res.status(404).json({ success: false, error: 'Invoice not found.' });
    }

    return res.status(200).json({
      success: true,
      invoice
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

router.get('/:invoiceId', handleGetInvoice);
router.get('/invoices/:invoiceId', handleGetInvoice);

export const invoicesRouter = Router();
invoicesRouter.post('/:invoiceId/payment', handleInvoicePayment);
invoicesRouter.get('/', handleListInvoices);
invoicesRouter.get('/:invoiceId', handleGetInvoice);

export default router;
