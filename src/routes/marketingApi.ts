/**
 * Marketing workspaces, subscribers, campaigns and API tokens (/api/marketing, alias /api/v1/marketing).
 *
 * Access (server-side, in this order):
 *   1. guard() in server.ts: a verified user;
 *   2. requireTenant + the organization role matrix for the `marketing` module
 *      (view: GET; create/edit/delete for writes): OWNER, ADMIN, MANAGER and MARKETER may change things,
 *      SALES_REP may look, SUPPORT_AGENT / READ_ONLY / GUEST have no access;
 *   3. workspace membership for workspace data (x-workspace-id / ?workspaceId honoured only for members);
 *      only workspace owners and admins invite people, and only owners invite admins.
 * Input: every body is validated with zod (unknown fields dropped, sizes bounded), path ids are checked.
 * Nothing is simulated: sending isn't connected to an email provider yet, so it answers 501 instead of
 * inventing delivery statistics; the old command console (which printed a made-up package list) is 501 too.
 * The engine is still in memory (CLAUDE.md › Next 1).
 */
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { marketingEngine } from '../features/marketing/marketingEngine';
import { requireTenant } from '../server/tenancy/middleware';
import { methodPermission, requireAccessFor } from '../server/security/permissions';
import { validateBody } from '../server/http/middleware';

const router = Router();
router.use(requireTenant, requireAccessFor((req) => [['marketing', methodPermission(req.method)]]));

/** Verified caller (set by guard() in server.ts). Never falls back to a default user. */
const callerId = (req: Request): string => String((req as any).accountUser?.id || '');
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const checkId = (req: Request, res: Response, next: NextFunction) => (ID.test(req.params.id || '') ? next() : res.status(400).json({ success: false, code: 'invalid_input', error: 'Invalid id.' }));
const notAvailable = (res: Response, what: string) => res.status(501).json({ success: false, code: 'not_available', error: `${what} isn’t available yet: marketing email isn’t connected to an email provider.` });

const text = (max: number) => z.string().trim().min(1).max(max);
const email = z.string().trim().toLowerCase().max(254).email();
const WorkspaceBody = z.object({ name: text(120) });
const InvitationBody = z.object({ email, role: z.enum(['admin', 'member']).default('member') });
const AcceptBody = z.object({ token: z.string().regex(/^[a-f0-9]{48}$/) });
const TokenBody = z.object({ name: text(80) });
const SubscriberBody = z.object({
  email,
  firstName: z.string().trim().max(80).optional(),
  lastName: z.string().trim().max(80).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
});
const CampaignBody = z.object({
  name: text(200), subject: text(300), content: z.string().min(1).max(200_000),
  fromName: z.string().trim().max(120).optional(), fromEmail: email,
});
const ListQuery = z.object({ tag: z.string().max(40).optional(), status: z.enum(['subscribed', 'unsubscribed', 'bounced']).optional() });

/**
 * Resolves the workspace for this request and checks the caller belongs to it.
 * The client may name a workspace (x-workspace-id header or ?workspaceId), but it is only
 * honoured if the verified user is a member or owner. Otherwise 403.
 */
const resolveWorkspace = (req: Request, res: Response): string | null => {
  const userId = callerId(req);
  if (!userId) { res.status(401).json({ success: false, error: 'Sign in to continue.' }); return null; }
  const mine = marketingEngine.listWorkspacesForUser(userId);
  const requested = (req.headers['x-workspace-id'] as string) || (req.query.workspaceId as string) || '';
  const ws = requested ? mine.find((w) => w.id === requested) : mine[0];
  if (!ws) {
    res.status(403).json({ success: false, code: 'forbidden', error: requested ? 'You don’t have access to this workspace.' : 'You aren’t a member of any marketing workspace yet.' });
    return null;
  }
  return ws.id;
};

// 1. Workspaces
router.get('/workspaces', (req: Request, res: Response) => {
  return res.json({ success: true, workspaces: marketingEngine.listWorkspacesForUser(callerId(req)) });
});

router.post('/workspaces', validateBody(WorkspaceBody), (req: Request, res: Response) => {
  const ws = marketingEngine.createWorkspace(req.body.name, callerId(req));
  return res.status(201).json({ success: true, workspace: ws });
});

// 2. Invitations: workspace owners and admins only; only owners may invite admins.
router.post('/workspaces/:id/invitations', checkId, validateBody(InvitationBody), (req: Request, res: Response) => {
  const role = marketingEngine.roleIn(req.params.id, callerId(req));
  if (!role) return res.status(403).json({ success: false, code: 'forbidden', error: 'You don’t have access to this workspace.' });
  if (role === 'member') return res.status(403).json({ success: false, code: 'forbidden', error: 'Only workspace owners and admins can invite people.' });
  if (req.body.role === 'admin' && role !== 'owner') return res.status(403).json({ success: false, code: 'forbidden', error: 'Only the workspace owner can invite admins.' });
  const inv = marketingEngine.createInvitation(req.params.id, req.body.email, req.body.role);
  return res.status(201).json({ success: true, invitation: inv });
});

router.post('/invitations/accept', validateBody(AcceptBody), (req: Request, res: Response) => {
  const au = (req as any).accountUser as { email?: string; emailVerified?: boolean } | undefined;
  const result = marketingEngine.acceptInvitation(req.body.token, callerId(req), au?.emailVerified ? au.email : undefined);
  if (!result.success) return res.status(400).json({ success: false, code: 'invalid_invitation', error: 'Invalid or expired invitation token.' });
  return res.json(result);
});

// 3. API Tokens
router.get('/api-tokens', (req: Request, res: Response) => {
  const wsId = resolveWorkspace(req, res);
  if (!wsId) return;
  return res.json({ success: true, tokens: marketingEngine.listApiTokens(wsId) });
});

router.post('/api-tokens', validateBody(TokenBody), (req: Request, res: Response) => {
  const wsId = resolveWorkspace(req, res);
  if (!wsId) return;
  if (marketingEngine.roleIn(wsId, callerId(req)) === 'member') return res.status(403).json({ success: false, code: 'forbidden', error: 'Only workspace owners and admins can create API tokens.' });
  return res.status(201).json({ success: true, ...marketingEngine.createApiToken(wsId, req.body.name) });
});

router.delete('/api-tokens/:id', checkId, (req: Request, res: Response) => {
  const wsId = resolveWorkspace(req, res);
  if (!wsId) return;
  if (marketingEngine.roleIn(wsId, callerId(req)) === 'member') return res.status(403).json({ success: false, code: 'forbidden', error: 'Only workspace owners and admins can revoke API tokens.' });
  const success = marketingEngine.deleteApiToken(req.params.id, wsId);
  return success ? res.json({ success }) : res.status(404).json({ success: false, code: 'not_found', error: 'Token not found.' });
});

// 4. Subscribers
router.get('/subscribers', (req: Request, res: Response) => {
  const wsId = resolveWorkspace(req, res);
  if (!wsId) return;
  const q = ListQuery.safeParse(req.query);
  if (!q.success) return res.status(400).json({ success: false, code: 'invalid_input', error: 'Filter by tag (up to 40 characters) or status (subscribed, unsubscribed, bounced).' });
  const subscribers = marketingEngine.listSubscribers(wsId, q.data);
  return res.json({ success: true, subscribers, total: subscribers.length });
});

router.post('/subscribers', validateBody(SubscriberBody), (req: Request, res: Response) => {
  const wsId = resolveWorkspace(req, res);
  if (!wsId) return;
  const sub = marketingEngine.addSubscriber(wsId, req.body);
  return res.status(201).json({ success: true, subscriber: sub });
});

router.delete('/subscribers/:id', checkId, (req: Request, res: Response) => {
  const wsId = resolveWorkspace(req, res);
  if (!wsId) return;
  const success = marketingEngine.deleteSubscriber(req.params.id, wsId);
  return success ? res.json({ success }) : res.status(404).json({ success: false, code: 'not_found', error: 'Subscriber not found.' });
});

// 5. Campaigns
router.get('/campaigns', (req: Request, res: Response) => {
  const wsId = resolveWorkspace(req, res);
  if (!wsId) return;
  const campaigns = marketingEngine.listCampaigns(wsId);
  return res.json({ success: true, campaigns, total: campaigns.length });
});

router.post('/campaigns', validateBody(CampaignBody), (req: Request, res: Response) => {
  const wsId = resolveWorkspace(req, res);
  if (!wsId) return;
  const { name, subject, content, fromName, fromEmail } = req.body as z.infer<typeof CampaignBody>;
  const camp = marketingEngine.createCampaign(wsId, { name, subject, content, fromName: fromName || name, fromEmail });
  return res.status(201).json({ success: true, campaign: camp });
});

router.post('/campaigns/:id/send', checkId, (req: Request, res: Response) => {
  const wsId = resolveWorkspace(req, res);
  if (!wsId) return;
  if (!marketingEngine.listCampaigns(wsId).some((c) => c.id === req.params.id)) return res.status(404).json({ success: false, code: 'not_found', error: 'Campaign not found.' });
  // It used to mark the campaign "sent" with invented open/click statistics.
  return notAvailable(res, 'Sending campaigns');
});

// 6. Status for the caller's workspace only (no runtime or memory details).
router.get('/engine/status', (req: Request, res: Response) => {
  const wsId = resolveWorkspace(req, res);
  if (!wsId) return;
  return res.json({
    success: true,
    health: { status: 'in_memory', sending: 'not_connected', subscribersCount: marketingEngine.listSubscribers(wsId).length, campaignsCount: marketingEngine.listCampaigns(wsId).length },
  });
});

// 7. The command console printed a fixed, made-up package list; it isn't a real feature.
router.post('/engine/command', (_req: Request, res: Response) => notAvailable(res, 'The command console'));

export default router;
