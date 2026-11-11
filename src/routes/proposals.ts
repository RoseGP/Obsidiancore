/**
 * /api/proposals
 *
 * Staff (signed-in organization members):
 *   GET    /                  list          POST   /           create
 *   GET    /:id               one           PUT    /:id        update (until accepted/declined)
 *   DELETE /:id               delete        POST   /:id/share  create/replace the client link (returns it once)
 *   DELETE /:id/share         withdraw the link
 *   GET    /:id/document      printable document
 *
 * Client (public, only with the share link's token; see PUBLIC.proposals):
 *   GET   /share/:token                    view (marks it viewed)
 *   PATCH /share/:token/items/:itemId      choose optional items
 *   POST  /share/:token/accept             accept with a typed signature
 *   POST  /share/:token/decline
 *   POST  /share/:token/checkout           Stripe Checkout for the accepted total (503 if Stripe isn't configured)
 *   GET   /share/:token/document           printable document
 */
import { Router, type Request, type Response } from 'express';
import { rateLimit } from '../features/social-accounts/server/http';
import { requirePermission, requireTenant, sendError, tenantOf } from '../server/tenancy/middleware';
import { getOrg } from '../server/tenancy/orgs';
import {
  ProposalError, acceptShared, clientView, createProposal, declineShared, deleteProposal, getProposal, listProposals, openShared,
  renderDocument, revokeShare, selectOption, shareProposal, strip, totals, updateProposal, type Proposal,
} from '../features/proposals/server/proposals';

const router = Router();

function fail(res: Response, err: unknown, tag: string) {
  if (err instanceof ProposalError) return res.status(err.status).json({ success: false, code: err.code, error: err.message, ...(err.extra ?? {}) });
  return sendError(res, err, tag);
}
const orgName = async (orgId: string) => (await getOrg(orgId))?.name || 'Your service provider';
const ipOf = (req: Request) => String((req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0] || req.socket.remoteAddress || '').trim();

// ---------------------------------------------------------------------------
// Client (public by share token)
// ---------------------------------------------------------------------------
const publicLimiter = rateLimit({ name: 'proposal-share', windowMs: 60_000, max: 60, key: (req) => req.ip || 'anon' });

/** The org of a share (for its name) without exposing ids. */
async function shareOrgName(token: string) {
  const p = await openShared(token);
  return { p, from: await orgName(p.orgId) };
}

router.get('/share/:token', publicLimiter, async (req, res) => {
  try { const { p, from } = await shareOrgName(req.params.token); res.json({ success: true, proposal: clientView(p, from) }); }
  catch (err) { fail(res, err, 'proposals.share.get'); }
});

router.patch('/share/:token/items/:itemId', publicLimiter, async (req, res) => {
  try {
    if (typeof req.body?.selected !== 'boolean') return res.status(400).json({ success: false, code: 'invalid_input', field: 'selected', error: 'selected must be true or false.' });
    const p = await selectOption(req.params.token, req.params.itemId, req.body.selected);
    res.json({ success: true, proposal: clientView(p, await orgName(p.orgId)) });
  } catch (err) { fail(res, err, 'proposals.share.select'); }
});

router.post('/share/:token/accept', publicLimiter, async (req, res) => {
  try {
    const p = await acceptShared(req.params.token, req.body ?? {}, { ip: ipOf(req), userAgent: String(req.headers['user-agent'] || '') });
    res.json({ success: true, proposal: clientView(p, await orgName(p.orgId)) });
  } catch (err) { fail(res, err, 'proposals.share.accept'); }
});

router.post('/share/:token/decline', publicLimiter, async (req, res) => {
  try {
    const p = await declineShared(req.params.token, req.body?.reason);
    res.json({ success: true, proposal: clientView(p, await orgName(p.orgId)) });
  } catch (err) { fail(res, err, 'proposals.share.decline'); }
});

router.post('/share/:token/checkout', publicLimiter, async (req, res) => {
  try {
    const { p, from } = await shareOrgName(req.params.token);
    if (p.status !== 'accepted') return res.status(409).json({ success: false, code: 'not_accepted', error: 'Accept the proposal before paying.' });
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) return res.status(503).json({ success: false, code: 'payments_not_configured', error: 'Online payment isn\'t set up for this proposal. Contact the sender to pay.' });
    const { default: Stripe } = await import('stripe');
    const stripe = new Stripe(key);
    const base = (process.env.APP_URL || '').replace(/\/+$/, '');
    const back = `${base}/?proposal=${encodeURIComponent(req.params.token)}`;
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: p.client.email,
      line_items: [{ quantity: 1, price_data: { currency: p.currency.toLowerCase(), unit_amount: totals(p).total, product_data: { name: `${p.number} ${p.title}`, description: `Proposal from ${from}` } } }],
      success_url: `${back}&payment=success`, cancel_url: `${back}&payment=cancelled`,
      metadata: { proposalId: p.id, orgId: p.orgId },
    });
    res.json({ success: true, checkoutUrl: session.url });
  } catch (err) { fail(res, err, 'proposals.share.checkout'); }
});

router.get('/share/:token/document', publicLimiter, async (req, res) => {
  try { const { p, from } = await shareOrgName(req.params.token); res.type('html').setHeader('Cache-Control', 'no-store').send(renderDocument(p, from)); }
  catch (err) { fail(res, err, 'proposals.share.document'); }
});

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------
router.use(requireTenant);

const appUrl = () => (process.env.APP_URL || '').replace(/\/+$/, '');
const shareUrl = (token: string) => `${appUrl()}/?proposal=${encodeURIComponent(token)}`;
const staff = (p: Proposal) => ({ ...strip(p), totals: totals(p) });

router.get('/', requirePermission('read'), async (req, res) => {
  try { res.json({ success: true, proposals: await listProposals(tenantOf(req).orgId) }); }
  catch (err) { fail(res, err, 'proposals.list'); }
});

router.post('/', requirePermission('write'), async (req, res) => {
  try { const t = tenantOf(req); res.status(201).json({ success: true, proposal: staff(await createProposal(t.orgId, t.userId, req.body)) }); }
  catch (err) { fail(res, err, 'proposals.create'); }
});

router.get('/:id', requirePermission('read'), async (req, res) => {
  try { res.json({ success: true, proposal: staff(await getProposal(tenantOf(req).orgId, req.params.id)) }); }
  catch (err) { fail(res, err, 'proposals.get'); }
});

router.put('/:id', requirePermission('write'), async (req, res) => {
  try { res.json({ success: true, proposal: staff(await updateProposal(tenantOf(req).orgId, req.params.id, req.body)) }); }
  catch (err) { fail(res, err, 'proposals.update'); }
});

router.delete('/:id', requirePermission('manage_records'), async (req, res) => {
  try { await deleteProposal(tenantOf(req).orgId, req.params.id); res.json({ success: true }); }
  catch (err) { fail(res, err, 'proposals.delete'); }
});

router.post('/:id/share', requirePermission('write'), async (req, res) => {
  try {
    const { proposal, token } = await shareProposal(tenantOf(req).orgId, req.params.id);
    res.json({ success: true, proposal: staff(proposal), url: shareUrl(token), note: 'Copy this link now: for security it isn\'t stored and can\'t be shown again. Creating a new link withdraws the old one.' });
  } catch (err) { fail(res, err, 'proposals.share'); }
});

router.delete('/:id/share', requirePermission('write'), async (req, res) => {
  try { res.json({ success: true, proposal: staff(await revokeShare(tenantOf(req).orgId, req.params.id)) }); }
  catch (err) { fail(res, err, 'proposals.unshare'); }
});

router.get('/:id/document', requirePermission('read'), async (req, res) => {
  try {
    const orgId = tenantOf(req).orgId;
    res.type('html').setHeader('Cache-Control', 'no-store').send(renderDocument(await getProposal(orgId, req.params.id), await orgName(orgId)));
  } catch (err) { fail(res, err, 'proposals.document'); }
});

export default router;
