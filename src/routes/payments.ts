/**
 * Legacy payment routes, kept so existing links and clients keep working. They are thin aliases over the
 * single payments stack (/api/integrations + paymentDb), scoped by the signed-in member's organization.
 * The business / user is never taken from a header, the query string, the body or an unverified token.
 *
 * Mounted at /api/payments and /api/invoices (no longer on the bare /api prefix).
 *   GET  /api/payments/status                      Stripe connection of this organization
 *   GET  /api/payments/stripe/connect              → same as /api/integrations/stripe/connect
 *   GET  /api/payments/stripe/callback             → same as /api/integrations/stripe/callback (signed state)
 *   POST /api/payments/stripe/disconnect           → same as /api/integrations/stripe/disconnect
 *   GET  /api/payments/invoices | /api/invoices    provider invoices of this organization
 *   GET  /api/payments/invoices/:id | /api/invoices/:id
 *   POST /api/payments/invoices/:id/payment | /api/invoices/:id/payment   hosted payment link (finalizes it)
 */
import { Router, Request, Response } from 'express';
import * as paymentDb from '../services/payment/paymentDb';
import { getPaymentProvider } from '../services/payment/providerFactory';
import { providerConfigured } from '../services/payment/config';
import { requirePermission, requireTenant, tenantOf } from '../server/tenancy/middleware';
import { assertId } from '../server/data/docStore';
import { connectLimiter, oauthCallback, oauthConnect, providerDisconnect, sendPaymentError } from './paymentIntegrations';

const router = Router();

// OAuth return is public (the organization is in the HMAC-signed state).
router.get('/stripe/callback', oauthCallback('stripe'));

router.use(requireTenant);

router.get('/status', requirePermission('read'), async (req: Request, res: Response) => {
  try {
    const acc = await getPaymentProvider(tenantOf(req).orgId, 'stripe').getAccount();
    res.json({ success: true, provider: 'stripe', configured: providerConfigured('stripe'), connected: acc.connected, status: acc.connected ? 'active' : 'disconnected', account: acc.connected ? acc : null });
  } catch (err) { sendPaymentError(res, err, 'payments.status'); }
});

router.get('/stripe/connect', requirePermission('manage_org'), connectLimiter, oauthConnect('stripe'));
router.post('/stripe/disconnect', requirePermission('manage_org'), providerDisconnect('stripe'));

async function listInvoices(req: Request, res: Response) {
  try { res.json({ success: true, invoices: await paymentDb.listInvoices(tenantOf(req).orgId) }); }
  catch (err) { sendPaymentError(res, err, 'payments.invoiceList'); }
}

async function getInvoice(req: Request, res: Response) {
  try {
    const inv = await paymentDb.getInvoice(tenantOf(req).orgId, assertId(req.params.invoiceId));
    if (!inv) return res.status(404).json({ success: false, code: 'not_found', error: 'Invoice not found.' });
    res.json({ success: true, invoice: inv });
  } catch (err) { sendPaymentError(res, err, 'payments.invoiceGet'); }
}

/** Returns the hosted payment link, finalizing the provider invoice if it hasn't been yet. Paid only after the provider's webhook. */
async function paymentLink(req: Request, res: Response) {
  try {
    const orgId = tenantOf(req).orgId;
    const inv = await paymentDb.getInvoice(orgId, assertId(req.params.invoiceId));
    if (!inv) return res.status(404).json({ success: false, code: 'not_found', error: 'Invoice not found.' });
    if (inv.status === 'void') return res.status(409).json({ success: false, code: 'invoice_void', error: 'This invoice was voided.' });
    const ready = inv.status === 'draft' || !inv.hosted_invoice_url ? await getPaymentProvider(orgId, inv.provider).sendInvoice(inv.id) : inv;
    res.json({ success: true, provider: ready.provider, payment_url: ready.hosted_invoice_url, payment_status: ready.status, invoice: ready });
  } catch (err) { sendPaymentError(res, err, 'payments.paymentLink'); }
}

router.get('/invoices', requirePermission('read'), listInvoices);
router.get('/invoices/:invoiceId', requirePermission('read'), getInvoice);
router.post('/invoices/:invoiceId/payment', requirePermission('write'), paymentLink);

/** /api/invoices aliases (same handlers, same tenant scoping). */
export const invoicesRouter = Router();
invoicesRouter.use(requireTenant);
invoicesRouter.get('/', requirePermission('read'), listInvoices);
invoicesRouter.get('/:invoiceId', requirePermission('read'), getInvoice);
invoicesRouter.post('/:invoiceId/payment', requirePermission('write'), paymentLink);

export default router;
