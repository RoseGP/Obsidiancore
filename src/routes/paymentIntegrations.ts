/**
 * /api/integrations: the organization's Stripe / Square connections and provider invoices.
 *
 * Single payments stack: data lives in paymentDb (document store, organizations/{orgId}/payment_*), keyed by
 * the signed-in member's organization (tenantOf(req).orgId), never by an id from the request. The legacy
 * /api/payments and /api/invoices routes are thin aliases over this module (see payments.ts).
 *
 *   GET  /status                       read     both providers' connection state + whether the server is configured
 *   GET  /:provider/connect            manage   starts OAuth (503 <provider>_not_configured without keys)
 *   GET  /:provider/callback           public   OAuth return; the organization comes from the signed state
 *   POST /:provider/disconnect         manage
 *   POST /invoices/create              write    { provider, customer|customerId, items, billingInvoiceId? … }
 *   POST /invoices/:id/send            write
 *   POST /invoices/:id/void            write
 *   GET  /invoices                     read
 *
 * Nothing is simulated: without provider credentials every provider operation answers 503.
 */
import { Router, Request, Response, RequestHandler } from 'express';
import { generateOAuthState, validateOAuthState } from '../services/payment/encryption';
import * as paymentDb from '../services/payment/paymentDb';
import { getPaymentProvider } from '../services/payment/providerFactory';
import { PaymentProviderError, type PaymentProviderType } from '../services/payment/types';
import { assertProviderConfigured, providerConfigured } from '../services/payment/config';
import { requirePermission, requireTenant, sendError, tenantOf } from '../server/tenancy/middleware';
import { rateLimit } from '../features/social-accounts/server/http';
import { billingInvoiceExists } from '../features/invoicing/server/providerPayments';
import { assertId } from '../server/data/docStore';
import { isExplicitDevOrTest } from '../server/runtimeEnv';

const router = Router();
const PROVIDERS: PaymentProviderType[] = ['stripe', 'square'];
const isProvider = (v: unknown): v is PaymentProviderType => v === 'stripe' || v === 'square';
const NAME: Record<PaymentProviderType, string> = { stripe: 'Stripe', square: 'Square' };
const SETTINGS_URL = '/?view=proposals&subtab=payment_providers';

/** Messages we authored; anything else (provider/SDK text) is replaced by a generic sentence. */
const FRIENDLY: Partial<Record<string, string>> = {
  PROVIDER_NOT_CONFIGURED: 'This payment provider isn’t set up on this server yet. An administrator adds its keys.',
  PROVIDER_NOT_CONNECTED: 'Connect this payment provider first.',
  PROVIDER_AUTH_EXPIRED: 'The connection to the payment provider expired. Reconnect it.',
  PROVIDER_AUTH_REVOKED: 'The payment provider didn’t accept the connection. Try connecting again.',
  CSRF_STATE_INVALID: 'The connection link expired or was changed. Start connecting again.',
};

export function sendPaymentError(res: Response, err: unknown, tag: string) {
  if (err instanceof PaymentProviderError) {
    const status = err.statusCode || 400;
    const code = err.code === 'PROVIDER_NOT_CONFIGURED' && err.provider ? `${err.provider}_not_configured` : err.code;
    const message = FRIENDLY[err.code] || (err.code === 'PROVIDER_VALIDATION_ERROR' ? err.message : 'The payment provider request failed. Try again.');
    return res.status(status).json({ success: false, code, errorCode: err.code, error: message });
  }
  return sendError(res, err, tag);
}

/**
 * The public base URL for OAuth redirect URIs. Production requires APP_URL: the request's Host header is
 * client-controlled, so it is only used as a fallback in explicit development/test mode.
 */
export function hostUrl(req: Request): string {
  const configured = (process.env.APP_URL || '').trim();
  if (configured) return configured.replace(/\/+$/, '');
  if (!isExplicitDevOrTest()) throw new PaymentProviderError('PROVIDER_NOT_CONFIGURED', 'APP_URL must be set to connect payment providers.', undefined, undefined, 503);
  return `${req.protocol}://${req.get('host') || 'localhost:3000'}`;
}

export const connectLimiter = rateLimit({ name: 'payments-connect', windowMs: 60_000, max: 15, key: (req) => tenantOf(req).orgId });
const writeLimiter = rateLimit({ name: 'payments-write', windowMs: 60_000, max: 60, key: (req) => tenantOf(req).orgId });

/* ------------------------------------------------------------------ OAuth return (public) */

/** OAuth return handler (also used by the legacy /api/payments/stripe/callback alias). */
export const oauthCallback = (fixed?: PaymentProviderType): RequestHandler => async (req: Request, res: Response) => {
  const p = fixed ?? req.params.provider;
  if (!isProvider(p)) return res.status(404).json({ success: false, code: 'not_found', error: 'Unknown provider.' });
  if (req.query.error) return res.redirect(`${SETTINGS_URL}&error=${encodeURIComponent(`${NAME[p]} connection was cancelled.`)}`);
  const { code, state } = req.query;
  if (typeof state !== 'string' || !state) return res.status(400).send('Missing OAuth state.');
  try {
    const orgId = assertId(validateOAuthState(state, p).userId); // the state carries the organization id, HMAC-signed
    assertProviderConfigured(p);
    if (typeof code !== 'string' || !code) throw new PaymentProviderError('PROVIDER_VALIDATION_ERROR', `${NAME[p]} didn't return an authorization code.`, p);
    await getPaymentProvider(orgId, p).connect(code, `${hostUrl(req)}/api/integrations/${p}/callback`);
    return res.redirect(`${SETTINGS_URL}&connected=${p}&status=success`);
  } catch (err: any) {
    console.error(`[payments] ${p} callback failed:`, err?.code || err?.name || 'error');
    const msg = err instanceof PaymentProviderError ? (FRIENDLY[err.code] || `${NAME[p]} connection failed.`) : `${NAME[p]} connection failed.`;
    return res.redirect(`${SETTINGS_URL}&error=${encodeURIComponent(msg)}`);
  }
};
router.get('/:provider/callback', oauthCallback());

/* ------------------------------------------------------------------ everything else: signed-in members */

router.use(requireTenant);

router.get('/status', requirePermission('read'), async (req: Request, res: Response) => {
  try {
    const orgId = tenantOf(req).orgId;
    const providers: Record<string, unknown> = {};
    for (const p of PROVIDERS) {
      const acc = await getPaymentProvider(orgId, p).getAccount();
      providers[p] = { ...acc, configured: providerConfigured(p) };
    }
    res.json({ success: true, providers });
  } catch (err) { sendPaymentError(res, err, 'integrations.status'); }
});

/** Starts OAuth for the signed-in member's organization (managers and up). */
export const oauthConnect = (fixed?: PaymentProviderType): RequestHandler => async (req: Request, res: Response) => {
  const p = fixed ?? req.params.provider;
  if (!isProvider(p)) return res.status(404).json({ success: false, code: 'not_found', error: 'Unknown provider.' });
  try {
    assertProviderConfigured(p);
    const state = generateOAuthState(tenantOf(req).orgId, p);
    const redirectUri = `${hostUrl(req)}/api/integrations/${p}/callback`;
    let authUrl: string;
    if (p === 'stripe') {
      authUrl = `https://connect.stripe.com/oauth/authorize?${new URLSearchParams({ response_type: 'code', client_id: process.env.STRIPE_CLIENT_ID!, scope: 'read_write', redirect_uri: redirectUri, state })}`;
    } else {
      const base = process.env.SQUARE_ENVIRONMENT === 'production' ? 'https://connect.squareup.com' : 'https://connect.squareupsandbox.com';
      const scope = ['INVOICES_WRITE', 'INVOICES_READ', 'ORDERS_WRITE', 'ORDERS_READ', 'CUSTOMERS_WRITE', 'CUSTOMERS_READ', 'MERCHANT_PROFILE_READ'].join('+');
      authUrl = `${base}/oauth2/authorize?client_id=${encodeURIComponent(process.env.SQUARE_APPLICATION_ID!)}&scope=${scope}&session=false&state=${encodeURIComponent(state)}&redirect_uri=${encodeURIComponent(redirectUri)}`;
    }
    if (req.headers.accept?.includes('application/json') || req.query.format === 'json') return res.json({ success: true, provider: p, authUrl });
    return res.redirect(authUrl);
  } catch (err) { sendPaymentError(res, err, 'integrations.connect'); }
};
router.get('/:provider/connect', requirePermission('manage_org'), connectLimiter, oauthConnect());

export const providerDisconnect = (fixed?: PaymentProviderType): RequestHandler => async (req: Request, res: Response) => {
  const p = fixed ?? req.params.provider;
  if (!isProvider(p)) return res.status(404).json({ success: false, code: 'not_found', error: 'Unknown provider.' });
  try {
    await getPaymentProvider(tenantOf(req).orgId, p).disconnect();
    res.json({ success: true, message: `${NAME[p]} disconnected.` });
  } catch (err) { sendPaymentError(res, err, 'integrations.disconnect'); }
};
router.post('/:provider/disconnect', requirePermission('manage_org'), providerDisconnect());

/* ------------------------------------------------------------------ provider invoices */

function requireNonEmpty(v: unknown, field: string): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) throw new PaymentProviderError('PROVIDER_VALIDATION_ERROR', `${field} is required.`);
  return s;
}

router.post('/invoices/create', requirePermission('write'), writeLimiter, async (req: Request, res: Response) => {
  try {
    const orgId = tenantOf(req).orgId;
    const b = req.body ?? {};
    if (!isProvider(b.provider)) throw new PaymentProviderError('PROVIDER_VALIDATION_ERROR', 'Choose Stripe or Square.');
    if (!Array.isArray(b.items) || b.items.length === 0) throw new PaymentProviderError('PROVIDER_VALIDATION_ERROR', 'Add at least one line item.');
    assertProviderConfigured(b.provider);
    let billingInvoiceId: string | undefined;
    if (b.billingInvoiceId !== undefined) {
      billingInvoiceId = assertId(String(b.billingInvoiceId));
      if (!(await billingInvoiceExists(orgId, billingInvoiceId))) return res.status(404).json({ success: false, code: 'not_found', error: 'That invoice doesn’t exist in this organization.' });
    }
    const provider = getPaymentProvider(orgId, b.provider);

    let customerId: string | undefined;
    if (typeof b.customerId === 'string' && b.customerId) {
      const existing = await paymentDb.getCustomer(orgId, b.customerId);
      if (!existing) return res.status(404).json({ success: false, code: 'not_found', error: 'That customer doesn’t exist in this organization.' });
      customerId = existing.id;
    } else {
      const c = b.customer ?? {};
      const email = requireNonEmpty(c.email, 'Customer email');
      const name = requireNonEmpty(c.name, 'Customer name');
      const a = c.billing_address;
      customerId = (await provider.createCustomer({ name, email, billing_address: a && typeof a === 'object' ? a : undefined })).id;
    }

    const invoiceNumber = requireNonEmpty(b.invoiceNumber, 'Invoice number');
    const invoice = await provider.createInvoice({
      customerId,
      invoiceNumber,
      currency: typeof b.currency === 'string' && b.currency ? b.currency : 'USD',
      dueDate: requireNonEmpty(b.dueDate, 'Due date'),
      description: typeof b.description === 'string' ? b.description : undefined,
      items: b.items.map((it: any) => ({ description: String(it.description || ''), quantity: Number(it.quantity) || 1, unit_price: Number(it.unit_price ?? it.price) || 0, tax_rate: Number(it.tax_rate) || 0 })),
      idempotencyKey: typeof req.headers['idempotency-key'] === 'string' ? req.headers['idempotency-key'] : undefined,
      billingInvoiceId,
    });
    const final = b.autoSend ? await provider.sendInvoice(invoice.id) : invoice;
    res.status(201).json({ success: true, provider: b.provider, invoice: final });
  } catch (err) { sendPaymentError(res, err, 'integrations.invoiceCreate'); }
});

async function ownedInvoice(req: Request) {
  const orgId = tenantOf(req).orgId;
  const inv = await paymentDb.getInvoice(orgId, assertId(req.params.id));
  return { orgId, inv };
}

router.post('/invoices/:id/send', requirePermission('write'), writeLimiter, async (req: Request, res: Response) => {
  try {
    const { orgId, inv } = await ownedInvoice(req);
    if (!inv) return res.status(404).json({ success: false, code: 'not_found', error: 'Invoice not found.' });
    const sent = await getPaymentProvider(orgId, inv.provider).sendInvoice(inv.id);
    res.json({ success: true, provider: inv.provider, invoice: sent });
  } catch (err) { sendPaymentError(res, err, 'integrations.invoiceSend'); }
});

router.post('/invoices/:id/void', requirePermission('write'), writeLimiter, async (req: Request, res: Response) => {
  try {
    const { orgId, inv } = await ownedInvoice(req);
    if (!inv) return res.status(404).json({ success: false, code: 'not_found', error: 'Invoice not found.' });
    const voided = await getPaymentProvider(orgId, inv.provider).voidInvoice(inv.id);
    res.json({ success: true, invoice: voided });
  } catch (err) { sendPaymentError(res, err, 'integrations.invoiceVoid'); }
});

router.get('/invoices', requirePermission('read'), async (req: Request, res: Response) => {
  try {
    const p = req.query.provider;
    res.json({ success: true, invoices: await paymentDb.listInvoices(tenantOf(req).orgId, isProvider(p) ? p : undefined) });
  } catch (err) { sendPaymentError(res, err, 'integrations.invoiceList'); }
});

router.get('/invoices/:id', requirePermission('read'), async (req: Request, res: Response) => {
  try {
    const { inv } = await ownedInvoice(req);
    if (!inv) return res.status(404).json({ success: false, code: 'not_found', error: 'Invoice not found.' });
    res.json({ success: true, invoice: inv });
  } catch (err) { sendPaymentError(res, err, 'integrations.invoiceGet'); }
});

export default router;
