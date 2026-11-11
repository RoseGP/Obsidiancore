/**
 * /api/admin/meetings: platform administration of meeting plans and subscriptions.
 *
 * Platform administrators are the people who run this CRM service (not organization owners). They're listed
 * by user id in PLATFORM_ADMIN_USER_IDS (comma-separated). Everything here is refused (403) for anyone else;
 * GET /me tells the UI whether to show the panel.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { requireTenant, tenantOf } from '../server/tenancy/middleware';
import { assertId, getDocStore } from '../server/data/docStore';
import { isMeetingPlanTier, MEETING_PLAN_TIERS } from '../lib/meetingPlans';
import {
  decideChangeRequest, getPlanConfigs, getSubscription, planUpdateSchema, setSubscription, subscriptionChangeSchema, updatePlanConfig,
} from '../server/meetings/plans';
import { endMeeting } from '../server/meetings/sessions';
import { activeMeetings, platformStats } from '../server/meetings/stats';
import { actorOf, sendMeetingError } from './meetings';

const router = Router();

export function platformAdminIds(): Set<string> {
  return new Set((process.env.PLATFORM_ADMIN_USER_IDS || '').split(',').map((s) => s.trim()).filter(Boolean));
}
export const isPlatformAdmin = (userId: string) => platformAdminIds().has(userId);

function requirePlatformAdmin(req: Request, res: Response, next: NextFunction) {
  if (!isPlatformAdmin(tenantOf(req).userId)) {
    return res.status(403).json({ success: false, code: 'not_platform_admin', error: 'Only platform administrators can do this.' });
  }
  next();
}

router.use(requireTenant);

router.get('/me', (req, res) => {
  res.json({ success: true, isPlatformAdmin: isPlatformAdmin(tenantOf(req).userId), configured: platformAdminIds().size > 0 });
});

router.use(requirePlatformAdmin);

// Plans -----------------------------------------------------------------------
router.get('/plans', async (_req, res) => {
  try { res.json({ success: true, plans: await getPlanConfigs() }); }
  catch (err) { sendMeetingError(res, err, 'admin.plans.get'); }
});

/** PUT /api/admin/meetings/plans/:tier { label?, limits?, features?, warnMinutesBefore?, capacityWarnPercent? } */
router.put('/plans/:tier', async (req, res) => {
  try {
    if (!isMeetingPlanTier(req.params.tier)) return res.status(404).json({ success: false, code: 'not_found', error: 'Unknown plan.' });
    const patch = planUpdateSchema.parse(req.body ?? {});
    const plan = await updatePlanConfig(req.params.tier, patch, tenantOf(req).userId);
    res.json({ success: true, plan, note: 'New meetings use these settings. Running meetings keep theirs unless the change raises them.' });
  } catch (err) { sendMeetingError(res, err, 'admin.plans.put'); }
});

// Statistics and monitoring ----------------------------------------------------
router.get('/stats', async (req, res) => {
  try {
    const days = Math.min(365, Math.max(1, parseInt(String(req.query.days ?? '30'), 10) || 30));
    res.json({ success: true, stats: await platformStats(days) });
  } catch (err) { sendMeetingError(res, err, 'admin.stats'); }
});

router.get('/active', async (_req, res) => {
  try { res.json({ success: true, meetings: await activeMeetings() }); }
  catch (err) { sendMeetingError(res, err, 'admin.active'); }
});

router.post('/active/:orgId/:id/end', async (req, res) => {
  try {
    const s = await endMeeting(actorOf(req), assertId(req.params.id), { asPlatformAdmin: true, orgId: assertId(req.params.orgId) });
    res.json({ success: true, meeting: { id: s.id, status: s.status, endedReason: s.endedReason } });
  } catch (err) { sendMeetingError(res, err, 'admin.active.end'); }
});

// Subscriptions -----------------------------------------------------------------
router.get('/subscriptions', async (req, res) => {
  try {
    const st = await getDocStore();
    const q = String(req.query.q ?? '').trim().toLowerCase();
    const tier = String(req.query.tier ?? '');
    const orgs = await st.list('organizations', { limit: 2000 });
    const rows = [];
    for (const o of orgs) {
      if (q && !String(o.name || '').toLowerCase().includes(q) && !String(o.id).includes(q)) continue;
      const sub = await getSubscription(o.id, st);
      if (isMeetingPlanTier(tier) && sub.tier !== tier) continue;
      rows.push({ orgId: o.id, name: o.name, createdAt: o.createdAt, tier: sub.tier, customLimits: sub.customLimits, customFeatures: sub.customFeatures, updatedAt: sub.updatedAt, updatedBy: sub.updatedBy });
    }
    res.json({ success: true, subscriptions: rows.slice(0, 500), total: rows.length });
  } catch (err) { sendMeetingError(res, err, 'admin.subscriptions'); }
});

/** PUT /api/admin/meetings/subscriptions/:orgId { tier, customLimits?, customFeatures?, reason? }: upgrade, downgrade or adjust. */
router.put('/subscriptions/:orgId', async (req, res) => {
  try {
    const change = subscriptionChangeSchema.parse(req.body ?? {});
    const sub = await setSubscription(assertId(req.params.orgId), change, tenantOf(req).userId);
    res.json({ success: true, subscription: sub, note: 'Upgrades apply to running meetings now; downgrades apply to the next meeting.' });
  } catch (err) { sendMeetingError(res, err, 'admin.subscriptions.put'); }
});

router.get('/subscriptions/:orgId/history', async (req, res) => {
  try {
    const rows = await (await getDocStore()).list('subscription_events', { where: [['orgId', '==', assertId(req.params.orgId)]] });
    res.json({ success: true, events: rows.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 100) });
  } catch (err) { sendMeetingError(res, err, 'admin.subscriptions.history'); }
});

// Change requests ---------------------------------------------------------------
router.get('/requests', async (req, res) => {
  try {
    const status = ['pending', 'approved', 'declined', 'cancelled'].includes(String(req.query.status)) ? String(req.query.status) : 'pending';
    const rows = await (await getDocStore()).list('subscription_requests', { where: [['status', '==', status]] });
    res.json({ success: true, requests: rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 200), tiers: MEETING_PLAN_TIERS });
  } catch (err) { sendMeetingError(res, err, 'admin.requests'); }
});

router.post('/requests/:id/:decision', async (req, res) => {
  try {
    const decision = req.params.decision;
    if (decision !== 'approve' && decision !== 'decline') return res.status(404).json({ success: false, code: 'not_found', error: 'Unknown action.' });
    const r = await decideChangeRequest(assertId(req.params.id), decision, tenantOf(req).userId, typeof req.body?.note === 'string' ? req.body.note.slice(0, 500) : undefined);
    res.json({ success: true, request: r });
  } catch (err) { sendMeetingError(res, err, 'admin.requests.decide'); }
});

export default router;
