/**
 * Dashboard API: tenant-scoped (organizations/{orgId}/…). Mounted behind guard() in server.ts;
 * every route requires a resolved tenant and a role that allows the action.
 *
 * Changes from the previous version:
 *   - No global crm_* collections, no seeding at import time (that unawaited Firestore call crashed
 *     the server when Google credentials were missing), no sample data returned in place of real data.
 *   - Metrics this app doesn't measure (calls/meetings today, response time, SLA) are null, not invented.
 *   - Ticket replies are recorded on the ticket and reported as NOT delivered: no outbound channel is wired here.
 */
import { Router, Request, Response } from 'express';
import { CrmRepository } from '../server/crm/crmRepository';
import { DEAL_STAGE_PROBABILITY } from '../lib/pipelineStages';
import { requireReadOrWrite, requireTenant, sendError, tenantOf } from '../server/tenancy/middleware';
import { MissionInputError, loadMissions, parseDay } from '../server/crm/missions';
import { loadServiceStatus } from '../server/crm/serviceStatus';

const router = Router();

/** Lead score from profile completeness and qualification signals (0-100). */
export function calculateLeadScore(lead: any): number {
  let score = 20;
  const email = typeof lead.email === 'string' ? lead.email : '';
  if (email.includes('@') && !email.endsWith('@gmail.com') && !email.endsWith('@yahoo.com')) score += 20;
  if (typeof lead.phone === 'string' && lead.phone.length > 7) score += 15;
  if (typeof lead.company === 'string' && lead.company.length > 2) score += 15;
  if (typeof lead.title === 'string' && /director|vp|head|chief|exec|lead|founder|manager/i.test(lead.title)) score += 15;
  if (Number(lead.qualification?.budget) >= 20000) score += 15;
  return Math.min(score, 100);
}

/** Organization activity feed entry. */
export async function logCrmActivity(orgId: string, activity: { type: string; title: string; description: string; actor?: string; targetId?: string; targetType?: string }) {
  return (await CrmRepository.forOrg(orgId)).logActivity(activity);
}

// One pipeline vocabulary (shared with the Sales Pipeline board): see src/lib/pipelineStages.ts.
const PROBABILITY: Record<string, number> = DEAL_STAGE_PROBABILITY;
const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const repoFor = (req: Request) => CrmRepository.forOrg(tenantOf(req).orgId);
const actorOf = (req: Request) => { const t = tenantOf(req); return t.name || t.email || t.userId; };

router.use(requireTenant, requireReadOrWrite);

router.get('/stats', async (req: Request, res: Response) => {
  try {
    const repo = await repoFor(req);
    const [deals, tickets, leads] = await Promise.all([repo.listDeals(), repo.listTickets(), repo.listLeads()]);
    const openDeals = deals.filter((d) => d.stage !== 'lost' && d.stage !== 'won');
    const activeTickets = tickets.filter((t) => t.status !== 'resolved');
    const converted = leads.filter((l) => l.isConverted || l.status === 'converted').length;
    res.json({
      success: true,
      stats: {
        totalPipelineValue: Math.round(openDeals.reduce((s, d) => s + (Number(d.value) || 0), 0)),
        openDealsCount: openDeals.length,
        weightedForecastValue: Math.round(openDeals.reduce((s, d) => s + (Number(d.value) || 0) * ((Number(d.probability) || 0) / 100), 0)),
        activeTicketsCount: activeTickets.length,
        criticalTicketsCount: activeTickets.filter((t) => t.priority === 'critical').length,
        totalLeads: leads.length,
        qualifiedLeads: leads.filter((l) => l.status === 'qualified').length,
        convertedLeads: converted,
        conversionRate: leads.length ? Number(((converted / leads.length) * 100).toFixed(1)) : 0,
        // Not measured by this app yet: reported as unknown rather than made up.
        callsToday: null, meetingsToday: null, avgResponseMinutes: null, slaMetRate: null,
      },
    });
  } catch (err) { sendError(res, err, 'dashboard.stats'); }
});

router.get('/deals', async (req, res) => {
  try { res.json({ success: true, deals: await (await repoFor(req)).listDeals() }); }
  catch (err) { sendError(res, err, 'dashboard.deals'); }
});

router.post('/deals', async (req, res) => {
  try {
    const b = req.body || {};
    const name = str(b.name, 200), client = str(b.client, 160), value = Number(b.value);
    if (!name || !client || !Number.isFinite(value) || value < 0) {
      return res.status(400).json({ success: false, error: 'Name, client, and a non-negative value are required.' });
    }
    const stage = PROBABILITY[b.stage] !== undefined ? b.stage : 'discovery';
    const repo = await repoFor(req);
    const deal = await repo.createDeal({
      name, client, value, stage, probability: PROBABILITY[stage],
      expectedClose: str(b.expectedClose, 60) || 'This Month', momentum: 'hot',
      channelOrigin: str(b.channelOrigin, 40) || 'direct', owner: actorOf(req), ownerId: tenantOf(req).userId,
    });
    await repo.logActivity({ type: 'deal_created', title: `New Deal Created: ${name}`, description: `Registered $${value.toLocaleString()} opportunity for ${client}.`, actor: actorOf(req), targetId: deal.id, targetType: 'deal' });
    res.status(201).json({ success: true, deal });
  } catch (err) { sendError(res, err, 'dashboard.createDeal'); }
});

router.patch('/deals/:id/stage', async (req, res) => {
  try {
    const stage = req.body?.stage;
    if (PROBABILITY[stage] === undefined) return res.status(400).json({ success: false, error: `Stage must be one of: ${Object.keys(PROBABILITY).join(', ')}.` });
    const repo = await repoFor(req);
    const deal = await repo.getDeal(req.params.id);
    if (!deal) return res.status(404).json({ success: false, error: 'Deal not found' });
    // Stage history (additive): lets reports measure time in stage and win rates by the furthest stage reached.
    const at = new Date().toISOString();
    const history = [...(Array.isArray(deal.stageHistory) ? deal.stageHistory : []), { stage, from: deal.stage ?? null, at }].slice(-100);
    const closing = (stage === 'won' || stage === 'lost') && deal.stage !== stage;
    await repo.updateDeal(deal.id, {
      stage, probability: PROBABILITY[stage], updatedAt: at, ...(deal.stage !== stage ? { stageHistory: history, stageEnteredAt: at } : {}),
      ...(closing ? { closedAt: at } : {}), ...(stage === 'lost' && deal.stage !== 'lost' && deal.stage !== 'won' ? { lostFromStage: deal.stage ?? null } : {}),
    });
    await repo.logActivity({ type: 'stage_advanced', title: `Deal Stage Changed: ${deal.name}`, description: `Stage moved to ${stage.toUpperCase()} (${PROBABILITY[stage]}% probability).`, actor: actorOf(req), targetId: deal.id, targetType: 'deal' });
    res.json({ success: true, id: deal.id, stage });
  } catch (err) { sendError(res, err, 'dashboard.dealStage'); }
});

router.get('/leads', async (req, res) => {
  try {
    const channel = str(req.query.channel, 40);
    let leads = await (await repoFor(req)).listLeads();
    if (channel && channel !== 'all') leads = leads.filter((l) => l.source === channel);
    res.json({ success: true, leads });
  } catch (err) { sendError(res, err, 'dashboard.leads'); }
});

router.get('/tickets', async (req, res) => {
  try { res.json({ success: true, tickets: await (await repoFor(req)).listTickets() }); }
  catch (err) { sendError(res, err, 'dashboard.tickets'); }
});

router.post('/tickets/:id/resolve', async (req, res) => {
  try {
    const repo = await repoFor(req);
    const ticket = await repo.getTicket(req.params.id);
    if (!ticket) return res.status(404).json({ success: false, error: 'Ticket not found.' });
    await repo.updateTicket(ticket.id, { status: 'resolved', updatedAt: new Date().toISOString() });
    await repo.logActivity({ type: 'ticket_resolved', title: 'Support Ticket Resolved', description: `Resolved ticket "${ticket.subject || ticket.id}"${ticket.customerName ? ` for ${ticket.customerName}` : ''}.`, actor: actorOf(req), targetId: ticket.id, targetType: 'ticket' });
    res.json({ success: true, id: ticket.id });
  } catch (err) { sendError(res, err, 'dashboard.resolveTicket'); }
});

router.post('/tickets/:id/reply', async (req, res) => {
  try {
    const replyText = str(req.body?.replyText, 5000);
    if (!replyText) return res.status(400).json({ success: false, error: 'Reply text is required' });
    const repo = await repoFor(req);
    const ticket = await repo.getTicket(req.params.id);
    if (!ticket) return res.status(404).json({ success: false, error: 'Ticket not found.' });
    const reply = { text: replyText, author: actorOf(req), at: new Date().toISOString(), delivered: false };
    await repo.updateTicket(ticket.id, { replies: [...(Array.isArray(ticket.replies) ? ticket.replies : []), reply], updatedAt: reply.at });
    // Honest result: the reply is saved, but this endpoint has no outbound channel to the customer.
    res.json({ success: true, id: ticket.id, delivered: false, message: 'Reply saved to the ticket. It was not sent: no outbound channel is connected for tickets yet.' });
  } catch (err) { sendError(res, err, 'dashboard.replyTicket'); }
});

router.get('/activities', async (req, res) => {
  try { res.json({ success: true, activities: await (await repoFor(req)).listActivities(20) }); }
  catch (err) { sendError(res, err, 'dashboard.activities'); }
});

/** Personal daily missions computed from real records (see server/crm/missions.ts). */
router.get('/missions', async (req, res) => {
  try {
    const t = tenantOf(req);
    let day;
    try { day = parseDay(req.query.date, req.query.dayStart); }
    catch (e) { if (e instanceof MissionInputError) return res.status(400).json({ success: false, code: e.code, error: e.message }); throw e; }
    res.json(await loadMissions(t.orgId, { userId: t.userId, actor: actorOf(req) }, day.date, day.dayStart));
  } catch (err) { sendError(res, err, 'dashboard.missions'); }
});

/** Service monitoring: SLA, unanswered, missed calls, channel and AI status (see server/crm/serviceStatus.ts). */
router.get('/service', async (req, res) => {
  try { res.json(await loadServiceStatus(tenantOf(req).orgId)); }
  catch (err) { sendError(res, err, 'dashboard.service'); }
});

export default router;
