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
 *   POST /invoices/create              billing:create  { provider, customer|customerId, items, billingInvoiceId? … }
 *   GET  /stripe/billing-invoices/:id  billing:view    Stripe state for one Invoicing invoice (connection, linked invoices, eligibility)
 *   POST /stripe/billing-invoices/:id  billing:create  creates a DRAFT Stripe invoice from that Invoicing invoice (server-side totals)
 *   POST /invoices/:id/send            billing:edit    finalize + email through the provider (explicit user action)
 *   POST /invoices/:id/refresh         billing:view    re-read the provider invoice (missed webhooks)
 *   POST /invoices/:id/void            billing:edit
 *   GET  /invoices                     billing:view
 *
 * OAuth: the state is signed (organization, provider, the member who started it, expiry 15 min), bound to the
 * starting browser by an HttpOnly cookie, and single use; a forwarded or replayed callback link can't connect.
 *
 * Nothing is simulated: without provider credentials every provider operation answers 503.
 */
import crypto from 'node:crypto';
import { Router, Request, Response, RequestHandler } from 'express';
import { z } from 'zod';
import { generateOAuthState, validateOAuthState } from '../services/payment/encryption';
import * as paymentDb from '../services/payment/paymentDb';
import { getPaymentProvider } from '../services/payment/providerFactory';
import { PaymentProviderError, type PaymentProviderType } from '../services/payment/types';
import { assertProviderConfigured, providerConfigured } from '../services/payment/config';
import { requirePermission, requireTenant, sendError, tenantOf } from '../server/tenancy/middleware';
import { rateLimit } from '../features/social-accounts/server/http';
import { billingInvoiceExists, loadBillingInvoiceForCollection, markBillingInvoiceSentByProvider } from '../features/invoicing/server/providerPayments';
import { requireAccess } from '../server/security/permissions';
import { StripeProvider, stripeLinesFromTotals } from '../services/payment/stripeProvider';
import { STRIPE_CURRENCY_EXPONENT, stripeMode } from '../services/payment/stripeClient';
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
    // Our own sentences (and Stripe's validation text, see stripeUserMessage) are shown; anything else is generic.
    const OWN = ['PROVIDER_VALIDATION_ERROR', 'INVOICE_STATE_CONFLICT', 'INVOICE_CREATION_FAILED', 'INVOICE_SEND_FAILED', 'CUSTOMER_CREATION_FAILED'];
    const message = FRIENDLY[err.code] || (OWN.includes(err.code) ? err.message : 'The payment provider request failed. Try again.');
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

/* ------------------------------------------------------------------ OAuth browser binding */

const bindCookie = (p: PaymentProviderType) => `obs_oauth_${p}`;
const sha = (v: string) => crypto.createHash('sha256').update(v).digest('hex');
function readCookie(req: Request, name: string): string {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return '';
}
function setBindCookie(res: Response, p: PaymentProviderType, value: string, maxAgeSec: number) {
  const secure = !isExplicitDevOrTest() || (process.env.APP_URL || '').startsWith('https://');
  // Lax: sent on the top-level redirect back from Stripe; HttpOnly: page scripts can't read it.
  res.append('Set-Cookie', `${bindCookie(p)}=${encodeURIComponent(value)}; Path=/api; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure ? '; Secure' : ''}`);
}

/* ------------------------------------------------------------------ OAuth return (public) */

/** OAuth return handler (also used by the legacy /api/payments/stripe/callback alias). */
export const oauthCallback = (fixed?: PaymentProviderType): RequestHandler => async (req: Request, res: Response) => {
  const p = fixed ?? req.params.provider;
  if (!isProvider(p)) return res.status(404).json({ success: false, code: 'not_found', error: 'Unknown provider.' });
  if (req.query.error) return res.redirect(`${SETTINGS_URL}&error=${encodeURIComponent(`${NAME[p]} connection was cancelled.`)}`);
  const { code, state } = req.query;
  if (typeof state !== 'string' || !state) return res.status(400).send('Missing OAuth state.');
  try {
    const st = validateOAuthState(state, p); // signed: organization, provider, member, expiry
    const orgId = assertId(st.userId);
    // Same browser that started the flow (cookie), and only once (a copied or replayed link can't connect).
    const cookie = readCookie(req, bindCookie(p));
    setBindCookie(res, p, '', 0);
    if (!st.bind || !cookie || sha(cookie) !== st.bind) throw new PaymentProviderError('CSRF_STATE_INVALID', 'Start connecting again from this browser.', p);
    if (!(await paymentDb.claimOAuthNonce(p, st.nonce))) throw new PaymentProviderError('CSRF_STATE_INVALID', 'This connection link was already used.', p);
    assertProviderConfigured(p);
    if (typeof code !== 'string' || !code) throw new PaymentProviderError('PROVIDER_VALIDATION_ERROR', `${NAME[p]} didn't return an authorization code.`, p);
    await (getPaymentProvider(orgId, p) as any).connect(code, `${hostUrl(req)}/api/integrations/${p}/callback`, st.actor);
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
      providers[p] = { ...acc, configured: providerConfigured(p), ...(p === 'stripe' ? { mode: stripeMode() } : {}) };
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
    const browserNonce = crypto.randomBytes(24).toString('base64url');
    setBindCookie(res, p, browserNonce, 15 * 60);
    const state = generateOAuthState(tenantOf(req).orgId, p, { actor: tenantOf(req).userId, bind: sha(browserNonce) });
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

const money = z.union([z.number(), z.string().trim().regex(/^\d+(\.\d{1,3})?$/)]).transform(Number).pipe(z.number().finite().min(0).max(1e11));
const CreateBody = z.object({
  provider: z.enum(['stripe', 'square']),
  items: z.array(z.object({
    description: z.string().trim().min(1, 'Each line needs a description.').max(500),
    quantity: z.union([z.number(), z.string().trim().regex(/^\d+(\.\d{1,3})?$/)]).transform(Number).pipe(z.number().finite().gt(0).max(1e6)).default(1),
    unit_price: money.optional(), price: money.optional(),
    tax_rate: z.union([z.number(), z.string().trim().regex(/^\d+(\.\d{1,3})?$/)]).transform(Number).pipe(z.number().min(0).max(100)).default(0),
  }).passthrough()).min(1, 'Add at least one line item.').max(250),
  customerId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).optional(),
  customer: z.object({ name: z.string().trim().min(1).max(200), email: z.string().trim().email().max(254), billing_address: z.any().optional() }).partial().optional(),
  invoiceNumber: z.string().trim().min(1, 'Invoice number is required.').max(100),
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/).transform((c) => c.toUpperCase()).default('USD'),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Due date must be YYYY-MM-DD.'),
  description: z.string().max(1500).optional(),
  billingInvoiceId: z.string().optional(),
  autoSend: z.boolean().optional(),
});

/** One clear sentence per invalid field (never zod's internal wording). */
function createBodyMessage(issue: { path: PropertyKey[]; message: string } | undefined): string {
  const path = (issue?.path || []).map(String);
  const field = path[path.length - 1] || '';
  const line = path[0] === 'items' && path[1] !== undefined ? `Line ${Number(path[1]) + 1}: ` : '';
  const BY_FIELD: Record<string, string> = {
    provider: 'Choose Stripe or Square.',
    quantity: `${line}the quantity must be above 0 (up to 3 decimals).`,
    unit_price: `${line}the price must be 0 or more (up to 3 decimals).`,
    price: `${line}the price must be 0 or more (up to 3 decimals).`,
    tax_rate: `${line}the tax rate must be between 0 and 100.`,
    description: path[0] === 'items' ? `${line}add a description (up to 500 characters).` : 'The description is too long (1,500 characters at most).',
    email: 'The customer email isn’t valid.',
    name: 'Add the customer’s name (up to 200 characters).',
    customerId: 'That customer id isn’t valid.',
    currency: 'Currency must be a 3-letter code, like USD.',
    items: issue?.message && /line item/.test(issue.message) ? issue.message : 'Add between 1 and 250 line items.',
  };
  if (BY_FIELD[field]) return BY_FIELD[field].charAt(0).toUpperCase() + BY_FIELD[field].slice(1);
  // Our own messages (invoice number, due date) are already sentences.
  if (issue?.message && /[.]$/.test(issue.message)) return issue.message;
  return 'Check the invoice details and try again.';
}

router.post('/invoices/create', requirePermission('write'), requireAccess('billing', 'create'), writeLimiter, async (req: Request, res: Response) => {
  try {
    const orgId = tenantOf(req).orgId;
    const parsed = CreateBody.safeParse(req.body ?? {});
    if (!parsed.success) throw new PaymentProviderError('PROVIDER_VALIDATION_ERROR', createBodyMessage(parsed.error.issues[0]));
    const b: any = parsed.data;
    if (b.provider === 'stripe' && !Object.prototype.hasOwnProperty.call(STRIPE_CURRENCY_EXPONENT, b.currency)) throw new PaymentProviderError('PROVIDER_VALIDATION_ERROR', `Stripe invoices can be created in ${Object.keys(STRIPE_CURRENCY_EXPONENT).join(', ')}.`);
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
      currency: b.currency,
      dueDate: b.dueDate,
      description: b.description,
      items: b.items.map((it: any) => ({ description: it.description, quantity: it.quantity, unit_price: it.unit_price ?? it.price ?? 0, tax_rate: it.tax_rate })),
      idempotencyKey: typeof req.headers['idempotency-key'] === 'string' && /^[\x21-\x7e]{8,255}$/.test(req.headers['idempotency-key']) ? req.headers['idempotency-key'] : undefined,
      billingInvoiceId,
      actorId: tenantOf(req).userId,
    } as any);
    const final = b.autoSend ? await provider.sendInvoice(invoice.id) : invoice;
    res.status(201).json({ success: true, provider: b.provider, invoice: final });
  } catch (err) { sendPaymentError(res, err, 'integrations.invoiceCreate'); }
});

async function ownedInvoice(req: Request) {
  const orgId = tenantOf(req).orgId;
  const inv = await paymentDb.getInvoice(orgId, assertId(req.params.id));
  return { orgId, inv };
}

router.post('/invoices/:id/send', requirePermission('write'), requireAccess('billing', 'edit'), writeLimiter, async (req: Request, res: Response) => {
  try {
    const { orgId, inv } = await ownedInvoice(req);
    if (!inv) return res.status(404).json({ success: false, code: 'not_found', error: 'Invoice not found.' });
    const sent = await getPaymentProvider(orgId, inv.provider).sendInvoice(inv.id);
    // The CRM invoice it collects is now "sent" (so payments can be recorded against it).
    if (sent.billing_invoice_id && sent.status === 'open') {
      const t = tenantOf(req);
      await markBillingInvoiceSentByProvider(orgId, sent.billing_invoice_id, { provider: inv.provider, providerReference: sent.provider_invoice_id, actorName: t.name || t.email || 'a team member' });
    }
    res.json({ success: true, provider: inv.provider, invoice: sent });
  } catch (err) { sendPaymentError(res, err, 'integrations.invoiceSend'); }
});

router.post('/invoices/:id/void', requirePermission('write'), requireAccess('billing', 'edit'), writeLimiter, async (req: Request, res: Response) => {
  try {
    const { orgId, inv } = await ownedInvoice(req);
    if (!inv) return res.status(404).json({ success: false, code: 'not_found', error: 'Invoice not found.' });
    const voided = await getPaymentProvider(orgId, inv.provider).voidInvoice(inv.id);
    res.json({ success: true, invoice: voided });
  } catch (err) { sendPaymentError(res, err, 'integrations.invoiceVoid'); }
});

router.get('/invoices', requirePermission('read'), requireAccess('billing', 'view'), async (req: Request, res: Response) => {
  try {
    const p = req.query.provider;
    res.json({ success: true, invoices: await paymentDb.listInvoices(tenantOf(req).orgId, isProvider(p) ? p : undefined) });
  } catch (err) { sendPaymentError(res, err, 'integrations.invoiceList'); }
});

router.get('/invoices/:id', requirePermission('read'), requireAccess('billing', 'view'), async (req: Request, res: Response) => {
  try {
    const { inv } = await ownedInvoice(req);
    if (!inv) return res.status(404).json({ success: false, code: 'not_found', error: 'Invoice not found.' });
    res.json({ success: true, invoice: inv });
  } catch (err) { sendPaymentError(res, err, 'integrations.invoiceGet'); }
});

router.post('/invoices/:id/refresh', requirePermission('read'), requireAccess('billing', 'view'), writeLimiter, async (req: Request, res: Response) => {
  try {
    const { orgId, inv } = await ownedInvoice(req);
    if (!inv) return res.status(404).json({ success: false, code: 'not_found', error: 'Invoice not found.' });
    if (inv.provider !== 'stripe') return res.status(501).json({ success: false, code: 'not_available', error: 'Refreshing is available for Stripe invoices.' });
    res.json({ success: true, invoice: await new StripeProvider(orgId).syncInvoice(inv.id) });
  } catch (err) { sendPaymentError(res, err, 'integrations.invoiceRefresh'); }
});

/* ------------------------------------------------------------------ Stripe ⇄ Invoicing invoices */

/** Why an Invoicing invoice can't be collected through Stripe right now (null = it can). */
function collectionBlocker(c: NonNullable<Awaited<ReturnType<typeof loadBillingInvoiceForCollection>>>): string | null {
  const { invoice, view } = c;
  if (invoice.lifecycle === 'void') return 'This invoice is void.';
  if (view.totals.balanceDue <= 0n) return 'Nothing is due on this invoice.';
  if (!Object.prototype.hasOwnProperty.call(STRIPE_CURRENCY_EXPONENT, invoice.currency)) return `Stripe invoices can be created in ${Object.keys(STRIPE_CURRENCY_EXPONENT).join(', ')}.`;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(invoice.billTo.email || '').trim())) return 'Add the client’s email address: Stripe emails the invoice to it.';
  if (!(invoice.billTo.name || invoice.billTo.company)) return 'Add the client’s name.';
  return null;
}

router.get('/stripe/billing-invoices/:billingInvoiceId', requirePermission('read'), requireAccess('billing', 'view'), async (req: Request, res: Response) => {
  try {
    const orgId = tenantOf(req).orgId;
    const c = await loadBillingInvoiceForCollection(orgId, assertId(req.params.billingInvoiceId));
    if (!c) return res.status(404).json({ success: false, code: 'not_found', error: 'Invoice not found.' });
    const account = await new StripeProvider(orgId).getAccount();
    res.json({
      success: true, configured: providerConfigured('stripe'), mode: stripeMode(), account,
      invoices: await paymentDb.listInvoicesForBillingInvoice(orgId, c.invoice.id),
      blocker: collectionBlocker(c), balanceDue: c.view.totals.balanceDue.toString(), currency: c.invoice.currency,
    });
  } catch (err) { sendPaymentError(res, err, 'integrations.billingStripeStatus'); }
});

/** Creates a DRAFT Stripe invoice for an Invoicing invoice. Amounts come from the stored invoice, not the request. */
router.post('/stripe/billing-invoices/:billingInvoiceId', requirePermission('write'), requireAccess('billing', 'create'), writeLimiter, async (req: Request, res: Response) => {
  try {
    const orgId = tenantOf(req).orgId;
    assertProviderConfigured('stripe');
    const c = await loadBillingInvoiceForCollection(orgId, assertId(req.params.billingInvoiceId));
    if (!c) return res.status(404).json({ success: false, code: 'not_found', error: 'Invoice not found.' });
    const blocker = collectionBlocker(c);
    if (blocker) throw new PaymentProviderError('PROVIDER_VALIDATION_ERROR', blocker, 'stripe', null, 400);
    // One live Stripe invoice per CRM invoice: return the existing draft/open one instead of a duplicate.
    const live = (await paymentDb.listInvoicesForBillingInvoice(orgId, c.invoice.id)).find((i) => i.provider === 'stripe' && (i.status === 'draft' || i.status === 'open'));
    if (live) return res.status(200).json({ success: true, existing: true, invoice: live });
    const provider = new StripeProvider(orgId);
    const { invoice, client, view } = c;
    const customer = await provider.resolveCustomer({
      crmRef: invoice.clientId ? `billing_client:${invoice.clientId}` : `email:${invoice.billTo.email.trim().toLowerCase()}`,
      name: invoice.billTo.company || invoice.billTo.name,
      email: (client?.email || invoice.billTo.email).trim(),
      address: invoice.billTo.address?.line1 ? { address: [invoice.billTo.address.line1, invoice.billTo.address.line2].filter(Boolean).join(', '), city: invoice.billTo.address.city || '', state: invoice.billTo.address.state || '', postal_code: invoice.billTo.address.postalCode || '', country: /^[A-Za-z]{2}$/.test(invoice.billTo.address.country || '') ? invoice.billTo.address.country.toUpperCase() : '' } : undefined,
    });
    const created = await provider.createDraftInvoice({
      customer, currency: invoice.currency, dueDate: invoice.dueDate, number: invoice.number,
      description: `Invoice ${invoice.number}${invoice.notes ? ` · ${invoice.notes.slice(0, 200)}` : ''}`,
      lines: stripeLinesFromTotals(view.totals, invoice.items, invoice.currency),
      billingInvoiceId: invoice.id, actorId: tenantOf(req).userId,
    });
    res.status(201).json({ success: true, invoice: created });
  } catch (err) { sendPaymentError(res, err, 'integrations.billingStripeCreate'); }
});

export default router;
