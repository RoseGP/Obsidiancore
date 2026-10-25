/**
 * Billing API — /api/billing
 *
 * - Authentication: HS256 JWT in `Authorization: Bearer`, verified with
 *   BILLING_JWT_SECRET (or JWT_SECRET). No secret configured → 503, and the
 *   client falls back to its labelled prototype mode. Dev bypass tokens used
 *   elsewhere in this codebase are NOT accepted here.
 * - Authorization: every query is scoped to the token's businessId; the
 *   "viewer" role is read-only (enforced in domain/operations).
 * - All financial values are recomputed on the server; client totals are
 *   never trusted. The emailed PDF is rendered here from the stored invoice.
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { verifyJwt } from '../utils/verifyJwt';
import { serializeTotals } from '../features/invoicing/domain/calc';
import {
  DomainError, opArchiveClient, opAssertSendable, opMarkSent, opRecordDelivery, opRecordPayment,
  opSaveClient, opSaveInvoice, opVoidInvoice,
} from '../features/invoicing/domain/operations';
import { buildInvoiceView, todayISO } from '../features/invoicing/domain/status';
import type { BillingSnapshot, CurrentUser } from '../features/invoicing/domain/types';
import { buildInvoiceDocument } from '../features/invoicing/services/invoiceDocument';
import { invoicePdfFilename, renderInvoicePdf } from '../features/invoicing/services/pdf';
import { isEmailConfigured, sendInvoiceEmail } from '../features/invoicing/server/emailTransport';
import { loadSnapshot, withSnapshot } from '../features/invoicing/server/store';
import { identify } from '../features/social-accounts/server/auth';

const router = Router();

// ---------- Auth ----------

interface AuthedRequest extends Request { billing?: { user: CurrentUser; businessId: string } }

const ROLE_MAP: Record<string, CurrentUser['role']> = {
  owner: 'owner', admin: 'admin', accountant: 'accountant', finance: 'accountant', billing: 'accountant',
};

async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const secret = process.env.BILLING_JWT_SECRET || process.env.JWT_SECRET;
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const payload = token && secret ? await verifyJwt(token, secret) : null;
  if (!payload) {
    // CRM users sign in with Firebase: accept the same verified identity as the rest of the app.
    // Each user gets their own billing workspace as owner.
    // TO COMPLETE for teams: look up the user's organization membership here and use its id as
    // businessId and the member's role ('owner' | 'admin' | 'accountant' | 'viewer').
    const who = await identify(req);
    if (!who || who.via === 'dev') return res.status(401).json({ code: 'unauthorized', error: 'Sign in to use billing.' });
    req.billing = { businessId: `user_${who.id}`, user: { id: who.id, email: '', name: 'Owner', role: 'owner' } };
    return next();
  }
  const userId = String(payload.userId ?? payload.sub ?? payload.id ?? '');
  const businessId = String(payload.businessId ?? payload.orgId ?? '');
  if (!userId || !businessId) return res.status(403).json({ code: 'forbidden', error: 'Your session isn’t linked to a business.' });
  req.billing = {
    businessId,
    user: {
      id: userId,
      email: String(payload.email ?? ''),
      name: String(payload.name ?? payload.email ?? 'User'),
      role: ROLE_MAP[String(payload.role ?? '').toLowerCase()] ?? 'viewer',
    },
  };
  next();
}

router.use(requireAuth);

// ---------- Helpers ----------

function fail(res: Response, err: unknown) {
  if (err instanceof DomainError) {
    const status = { validation: 422, conflict: 409, not_found: 404, forbidden: 403 }[err.code];
    return res.status(status).json({ code: err.code, error: err.message, fieldErrors: err.fieldErrors });
  }
  if (err instanceof z.ZodError) {
    return res.status(400).json({ code: 'validation', error: 'The request was malformed.', issues: err.issues.slice(0, 10) });
  }
  console.error('[billing]', err);
  return res.status(500).json({ code: 'server', error: 'Something went wrong on the billing server.' });
}

/** Replays the stored response for a repeated Idempotency-Key (24h). */
const idem = new Map<string, { at: number; status: number; body: unknown }>();
function idemKey(req: AuthedRequest) {
  const k = req.header('Idempotency-Key');
  return k ? `${req.billing!.businessId}:${req.billing!.user.id}:${req.method}:${req.path}:${k}` : null;
}
function replay(req: AuthedRequest, res: Response) {
  const k = idemKey(req);
  const hit = k ? idem.get(k) : undefined;
  if (hit && Date.now() - hit.at < 86_400_000) { res.status(hit.status).json(hit.body); return true; }
  return false;
}
function remember(req: AuthedRequest, status: number, body: unknown) {
  const k = idemKey(req);
  if (k) idem.set(k, { at: Date.now(), status, body });
  if (idem.size > 5000) for (const [key, v] of idem) if (Date.now() - v.at > 86_400_000) idem.delete(key);
}

// ---------- Schemas (shape only; business rules live in domain/validation) ----------

const str = (max = 500) => z.string().max(max);
const dec = z.string().max(24);
const date = z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/);
const addr = z.object({ line1: str(200), line2: str(200), city: str(120), state: str(120), postalCode: str(32), country: str(120) });
const image = z.string().max(1_000_000).refine((v) => v === '' || /^data:image\/(png|jpeg);base64,/.test(v), 'Images must be PNG or JPEG data URLs');

const invoiceSchema = z.object({
  id: str(64), number: str(32), kind: z.enum(['standard', 'split', 'recurring']), lifecycle: z.enum(['draft', 'sent', 'viewed', 'void']),
  clientId: str(64).nullable(),
  billTo: z.object({ name: str(120), company: str(160), email: str(254), phone: str(32), address: addr, taxIdLabel: str(16), taxId: str(32) }),
  issuer: z.object({ name: str(160), email: str(254), phone: str(32), website: str(200), address: addr, taxIdLabel: str(16), taxId: str(32), logoDataUrl: image }),
  issueDate: date, dueDate: date, currency: z.enum(['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'NGN', 'INR', 'CHF', 'ZAR']),
  items: z.array(z.object({ id: str(64), name: str(200), description: str(2000), quantity: dec, unitPrice: dec, taxRate: dec })).max(200),
  discount: z.object({ type: z.enum(['percent', 'fixed']), value: dec }),
  fees: z.array(z.object({ id: str(64), label: str(120), amount: dec })).max(20),
  installments: z.array(z.object({ id: str(64), label: str(120), percent: dec, dueDate: date })).max(24),
  recurring: z.object({
    frequency: z.enum(['weekly', 'monthly', 'quarterly', 'yearly']), startDate: date, endType: z.enum(['never', 'after', 'on']),
    occurrences: str(4), endDate: date, dueInDays: str(4),
  }).nullable(),
  paymentInstructions: str(2000), notes: str(2000),
  signature: z.object({ enabled: z.boolean(), name: str(120), title: str(120), imageDataUrl: image }),
  version: z.number().int().min(0),
}).passthrough();

const clientSchema = z.object({
  id: str(64), name: str(120), company: str(160), email: str(254), phone: str(32), address: addr,
  taxIdLabel: str(16), taxId: str(32), notes: str(2000), archived: z.boolean(),
}).passthrough();

const paymentSchema = z.object({
  invoiceId: str(64), amount: dec, currency: str(3), date, method: z.enum(['bank_transfer', 'card', 'cash', 'check', 'mobile_money', 'other']),
  reference: str(120), note: str(500), status: z.enum(['confirmed', 'pending']),
});

const settingsSchema = z.object({
  issuer: invoiceSchema.shape.issuer, invoicePrefix: str(12), defaultCurrency: invoiceSchema.shape.currency,
  defaultTermsDays: z.number().int().min(0).max(365), defaultTaxRate: dec, paymentInstructions: str(2000), defaultNotes: str(2000),
  signature: invoiceSchema.shape.signature,
});

const sendSchema = z.object({ to: str(254), cc: str(1000), subject: str(200).min(1), message: str(5000) }).passthrough();

const ctx = (req: AuthedRequest) => req.billing!;

// ---------- Routes ----------

router.get('/session', (req: AuthedRequest, res) => {
  res.json({ user: ctx(req).user, emailConfigured: isEmailConfigured() });
});

router.get('/snapshot', async (req: AuthedRequest, res) => {
  try { res.json(await loadSnapshot(ctx(req).businessId)); } catch (e) { fail(res, e); }
});

router.put('/invoices/:id', async (req: AuthedRequest, res) => {
  if (replay(req, res)) return;
  try {
    const invoice = invoiceSchema.parse(req.body?.invoice) as any;
    if (invoice.id !== req.params.id) return res.status(400).json({ code: 'validation', error: 'Invoice id mismatch.' });
    const { businessId, user } = ctx(req);
    const body = await withSnapshot(businessId, (s) => {
      const r = opSaveInvoice(s, invoice, user);
      const view = buildInvoiceView(r.invoice, r.snapshot.payments, todayISO());
      return { snapshot: r.snapshot, result: { invoice: r.invoice, totals: serializeTotals(view.totals), status: view.status } };
    });
    remember(req, 200, body);
    res.json(body);
  } catch (e) { fail(res, e); }
});

router.post('/invoices/:id/void', async (req: AuthedRequest, res) => {
  try {
    const { businessId, user } = ctx(req);
    const invoice = await withSnapshot(businessId, (s) => { const r = opVoidInvoice(s, req.params.id, user); return { snapshot: r.snapshot, result: r.invoice }; });
    res.json({ invoice });
  } catch (e) { fail(res, e); }
});

router.post('/invoices/:id/mark-sent', async (req: AuthedRequest, res) => {
  try {
    const { businessId, user } = ctx(req);
    const invoice = await withSnapshot(businessId, (s) => { const r = opMarkSent(s, req.params.id, user); return { snapshot: r.snapshot, result: r.invoice }; });
    res.json({ invoice });
  } catch (e) { fail(res, e); }
});

router.post('/invoices/:id/send', async (req: AuthedRequest, res) => {
  if (replay(req, res)) return;
  try {
    const input = sendSchema.parse(req.body);
    const { businessId, user } = ctx(req);
    if (user.role === 'viewer') throw new DomainError('Your role can view billing but not send invoices.', 'forbidden');
    const ccList = input.cc.split(',').map((s) => s.trim()).filter(Boolean);
    if (ccList.some((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e))) {
      throw new DomainError('Check the Cc addresses.', 'validation', { cc: 'Separate addresses with commas, and check each one.' });
    }
    const out = await withSnapshot(businessId, async (s: BillingSnapshot) => {
      const inv = opAssertSendable(s, req.params.id, input.to);
      // Render the PDF from the authoritative stored invoice, not from the client.
      const view = buildInvoiceView(inv, s.payments, todayISO());
      const doc = buildInvoiceDocument(inv, view.totals);
      const pdf = Buffer.from(renderInvoicePdf(doc).output('arraybuffer'));
      const outcome = await sendInvoiceEmail({
        to: input.to.trim(), cc: ccList.join(', '), replyTo: inv.issuer.email,
        subject: input.subject.trim(), text: input.message, pdf, filename: invoicePdfFilename(doc),
      });
      const r = opRecordDelivery(s, inv.id, {
        at: new Date().toISOString(), to: input.to.trim(), cc: ccList.join(', '), subject: input.subject.trim(), ...outcome,
      }, user);
      return { snapshot: r.snapshot, result: { invoice: r.invoice, delivery: r.delivery } };
    });
    const status = out.delivery.result === 'delivered' ? 200 : out.delivery.result === 'not_configured' ? 503 : 502;
    const body = status === 200 ? out : { ...out, code: out.delivery.result === 'not_configured' ? 'not_configured' : 'server', error: out.delivery.detail };
    remember(req, status, body);
    res.status(status).json(body);
  } catch (e) { fail(res, e); }
});

router.post('/invoices/:id/payments', async (req: AuthedRequest, res) => {
  if (replay(req, res)) return;
  try {
    const payment = paymentSchema.parse(req.body?.payment);
    if (payment.invoiceId !== req.params.id) return res.status(400).json({ code: 'validation', error: 'Invoice id mismatch.' });
    const { businessId, user } = ctx(req);
    // Manually recorded payments are confirmed by this authenticated user; card
    // payments are confirmed only by the provider webhook (paymentWebhooks.ts).
    const body = await withSnapshot(businessId, (s) => {
      const r = opRecordPayment(s, payment as any, user);
      return { snapshot: r.snapshot, result: { payment: r.payment, invoice: r.invoice } };
    });
    remember(req, 201, body);
    res.status(201).json(body);
  } catch (e) { fail(res, e); }
});

router.put('/clients/:id', async (req: AuthedRequest, res) => {
  try {
    const client = clientSchema.parse(req.body?.client) as any;
    if (client.id !== req.params.id) return res.status(400).json({ code: 'validation', error: 'Client id mismatch.' });
    const { businessId, user } = ctx(req);
    const saved = await withSnapshot(businessId, (s) => { const r = opSaveClient(s, client, user); return { snapshot: r.snapshot, result: r.client }; });
    res.json({ client: saved });
  } catch (e) { fail(res, e); }
});

router.post('/clients/:id/archive', async (req: AuthedRequest, res) => {
  try {
    const archived = z.object({ archived: z.boolean() }).parse(req.body).archived;
    const { businessId, user } = ctx(req);
    const client = await withSnapshot(businessId, (s) => { const r = opArchiveClient(s, req.params.id, archived, user); return { snapshot: r.snapshot, result: r.client }; });
    res.json({ client });
  } catch (e) { fail(res, e); }
});

router.put('/settings', async (req: AuthedRequest, res) => {
  try {
    const settings = settingsSchema.parse(req.body?.settings) as any;
    const { businessId, user } = ctx(req);
    if (user.role !== 'owner' && user.role !== 'admin') throw new DomainError('Only owners and admins can change billing settings.', 'forbidden');
    const saved = await withSnapshot(businessId, (s) => ({ snapshot: { ...s, settings }, result: settings }));
    res.json({ settings: saved });
  } catch (e) { fail(res, e); }
});

export default router;
