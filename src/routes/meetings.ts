/**
 * /api/meetings: meeting subscriptions, live meeting sessions (server-enforced plan limits), scheduled and
 * recurring meetings, analytics, branding and the AI recap.
 *
 * Every limit is enforced here (src/server/meetings/*); the UI only mirrors it. See docs/meetings/PLANS.md.
 */
import { Router, Request, Response } from 'express';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { rateLimit } from '../features/social-accounts/server/http';
import { requirePermission, requireTenant, sendError, tenantOf } from '../server/tenancy/middleware';
import { can, getOrg } from '../server/tenancy/orgs';
import { assertId, getDocStore, newId } from '../server/data/docStore';
import { FEATURE_KEYS, LIMIT_BOUNDS, planForNeeds, type PlanFeatures } from '../lib/meetingPlans';
import {
  PlanError, cancelChangeRequest, createChangeRequest, getPlanConfigs, getSubscription, pendingRequestFor, resolveOrgPlan,
} from '../server/meetings/plans';
import {
  MeetingError, addParticipants, admit, attendanceReport, deny, endMeeting, getByRoom, getSessionFor, joinByRoom, leave, leaveByRoom, randomRoomCode,
  mediaTokenFor, removeParticipant, sessionView, setRecording, setRole, startSession, updateSettings, type Actor,
} from '../server/meetings/sessions';
import { activeMeetings, orgAnalytics } from '../server/meetings/stats';
import { generateMeetingSummary, meetingSummaryInputSchema, MeetingSummaryError } from '../services/meetingSummary';

const router = Router();

export function actorOf(req: Request): Actor {
  const t = tenantOf(req);
  return { userId: t.userId, orgId: t.orgId, role: t.role, name: t.name, email: t.email };
}

/** Plan and meeting errors carry their own status and code (with upgrade hints); everything else goes to sendError. */
export function sendMeetingError(res: Response, err: unknown, tag: string) {
  if (err instanceof MeetingError || err instanceof PlanError) {
    const { session, ...rest } = (err.extra ?? {}) as any;
    return res.status(err.status).json({ success: false, code: err.code, error: err.message, ...rest });
  }
  return sendError(res, err, tag);
}

async function requireOrgFeature(req: Request, feature: keyof PlanFeatures) {
  const plan = await resolveOrgPlan(tenantOf(req).orgId);
  if (!plan.features[feature]) {
    const configs = await getPlanConfigs();
    const tier = planForNeeds(configs, { feature });
    throw new PlanError(403, 'feature_not_in_plan', `This isn't included in the ${plan.label} plan.`, { feature, ...(tier ? { upgradeTo: tier, upgradeLabel: configs[tier].label } : {}) });
  }
  return plan;
}

// ---------------------------------------------------------------------------
// Subscription (the organizer's plan)
// ---------------------------------------------------------------------------

/** GET /api/meetings/subscription: the organization's plan, what each plan includes, and any pending change request. */
router.get('/subscription', requireTenant, requirePermission('read'), async (req, res) => {
  try {
    const t = tenantOf(req);
    const [sub, plan, configs, pending] = await Promise.all([getSubscription(t.orgId), resolveOrgPlan(t.orgId), getPlanConfigs(), pendingRequestFor(t.orgId)]);
    res.json({
      success: true, tier: sub.tier, plan, plans: configs, customLimits: sub.customLimits, updatedAt: sub.updatedAt,
      canRequestChange: can(t.role, 'manage_org'), pendingRequest: pending,
      billing: { connected: false, message: 'Online payment isn\'t connected yet: plan changes are requested here and applied by your account manager.' },
    });
  } catch (err) { sendMeetingError(res, err, 'meetings.subscription'); }
});

/** Older clients: plan name and limits only. */
router.get('/plan', requireTenant, requirePermission('read'), async (req, res) => {
  try {
    const plan = await resolveOrgPlan(tenantOf(req).orgId);
    res.json({ success: true, plan: plan.tier, limits: plan.limits, features: plan.features, canChange: false });
  } catch (err) { sendMeetingError(res, err, 'meetings.plan'); }
});

/** POST /api/meetings/subscription/requests { tier, note }: Owners/Admins ask for an upgrade or downgrade. */
router.post('/subscription/requests', requireTenant, requirePermission('manage_org'), async (req, res) => {
  try {
    const t = tenantOf(req);
    const org = await getOrg(t.orgId);
    const r = await createChangeRequest({ orgId: t.orgId, orgName: org?.name || t.orgId }, { userId: t.userId, email: t.email, name: t.name }, req.body?.tier, req.body?.note);
    res.status(201).json({ success: true, request: r });
  } catch (err) { sendMeetingError(res, err, 'meetings.requests.create'); }
});

router.delete('/subscription/requests/:id', requireTenant, requirePermission('manage_org'), async (req, res) => {
  try {
    const t = tenantOf(req);
    await cancelChangeRequest(t.orgId, assertId(req.params.id), t.userId);
    res.json({ success: true });
  } catch (err) { sendMeetingError(res, err, 'meetings.requests.cancel'); }
});

// ---------------------------------------------------------------------------
// Live meeting sessions
// ---------------------------------------------------------------------------

const sessionLimiter = rateLimit({ name: 'meeting-sessions', windowMs: 60_000, max: 240, key: (req) => tenantOf(req).userId });
const view = (req: Request, s: Parameters<typeof sessionView>[0]) => sessionView(s, actorOf(req));

/** POST /api/meetings/sessions { title?, roomCode?, scheduledMeetingId? }: start a meeting on the organizer's plan. */
router.post('/sessions', requireTenant, requirePermission('write'), sessionLimiter, async (req, res) => {
  try {
    const s = await startSession(actorOf(req), req.body ?? {});
    res.status(201).json({ success: true, session: view(req, s) });
  } catch (err) { sendMeetingError(res, err, 'meetings.sessions.start'); }
});

/** GET /api/meetings/sessions/:id: authoritative state (clock, limits, roster). Clients poll this. */
router.get('/sessions/:id', requireTenant, requirePermission('read'), sessionLimiter, async (req, res) => {
  try { res.json({ success: true, session: view(req, await getSessionFor(actorOf(req), assertId(req.params.id))) }); }
  catch (err) { sendMeetingError(res, err, 'meetings.sessions.get'); }
});

/** POST /api/meetings/sessions/:id/participants { emails: string[] } or { people: [{ email, name }] }. */
router.post('/sessions/:id/participants', requireTenant, requirePermission('write'), sessionLimiter, async (req, res) => {
  try {
    const people = Array.isArray(req.body?.people) ? req.body.people : Array.isArray(req.body?.emails) ? req.body.emails.map((email: unknown) => ({ email })) : [];
    const r = await addParticipants(actorOf(req), assertId(req.params.id), people);
    res.json({ success: true, added: r.added.map((p) => p.id), waiting: r.waiting.map((p) => p.id), refused: r.refused, upgradeTo: (r as any).upgradeTo, upgradeLabel: (r as any).upgradeLabel, session: view(req, r.session) });
  } catch (err) { sendMeetingError(res, err, 'meetings.participants.add'); }
});

router.post('/sessions/:id/admit', requireTenant, requirePermission('write'), sessionLimiter, async (req, res) => {
  try {
    const ids = req.body?.all === true ? 'all' : Array.isArray(req.body?.participantIds) ? req.body.participantIds : [];
    const r = await admit(actorOf(req), assertId(req.params.id), ids);
    res.json({ success: true, admitted: r.admitted, stillWaiting: r.stillWaiting, upgradeTo: (r as any).upgradeTo, upgradeLabel: (r as any).upgradeLabel, session: view(req, r.session) });
  } catch (err) { sendMeetingError(res, err, 'meetings.admit'); }
});

router.post('/sessions/:id/participants/:pid/deny', requireTenant, requirePermission('write'), async (req, res) => {
  try { res.json({ success: true, session: view(req, await deny(actorOf(req), assertId(req.params.id), req.params.pid)) }); }
  catch (err) { sendMeetingError(res, err, 'meetings.deny'); }
});

router.delete('/sessions/:id/participants/:pid', requireTenant, requirePermission('write'), async (req, res) => {
  try { res.json({ success: true, session: view(req, await removeParticipant(actorOf(req), assertId(req.params.id), req.params.pid)) }); }
  catch (err) { sendMeetingError(res, err, 'meetings.remove'); }
});

router.patch('/sessions/:id/participants/:pid', requireTenant, requirePermission('write'), async (req, res) => {
  try { res.json({ success: true, session: view(req, await setRole(actorOf(req), assertId(req.params.id), req.params.pid, req.body?.role)) }); }
  catch (err) { sendMeetingError(res, err, 'meetings.role'); }
});

/** PATCH /api/meetings/sessions/:id { waitingRoomEnabled?, locked? } */
router.patch('/sessions/:id', requireTenant, requirePermission('write'), async (req, res) => {
  try { res.json({ success: true, session: view(req, await updateSettings(actorOf(req), assertId(req.params.id), req.body ?? {})) }); }
  catch (err) { sendMeetingError(res, err, 'meetings.settings'); }
});

/** POST /api/meetings/sessions/:id/recording { action: 'start' | 'stop' }: the client records only after this succeeds. */
router.post('/sessions/:id/recording', requireTenant, requirePermission('write'), async (req, res) => {
  try { res.json({ success: true, session: view(req, await setRecording(actorOf(req), assertId(req.params.id), req.body?.action)) }); }
  catch (err) { sendMeetingError(res, err, 'meetings.recording'); }
});

router.post('/sessions/:id/leave', requireTenant, requirePermission('read'), async (req, res) => {
  try { res.json({ success: true, session: view(req, await leave(actorOf(req), assertId(req.params.id))) }); }
  catch (err) { sendMeetingError(res, err, 'meetings.leave'); }
});

router.post('/sessions/:id/end', requireTenant, requirePermission('write'), async (req, res) => {
  try { res.json({ success: true, session: view(req, await endMeeting(actorOf(req), assertId(req.params.id))) }); }
  catch (err) { sendMeetingError(res, err, 'meetings.end'); }
});

/** POST /api/meetings/rooms/:roomCode/join: signed-in people join by invitation code (capacity, lock, waiting room apply). */
router.post('/rooms/:roomCode/join', requireTenant, requirePermission('read'), sessionLimiter, async (req, res) => {
  try {
    const r = await joinByRoom(actorOf(req), req.params.roomCode);
    res.json({ success: true, you: { participantId: r.you.id, status: r.you.status }, session: view(req, r.session) });
  } catch (err) { sendMeetingError(res, err, 'meetings.join'); }
});

/** GET /api/meetings/rooms/:roomCode: the meeting as seen by a participant who joined by code. */
router.get('/rooms/:roomCode', requireTenant, requirePermission('read'), sessionLimiter, async (req, res) => {
  try { res.json({ success: true, session: view(req, await getByRoom(actorOf(req), req.params.roomCode)) }); }
  catch (err) { sendMeetingError(res, err, 'meetings.rooms.get'); }
});

router.post('/rooms/:roomCode/leave', requireTenant, requirePermission('read'), async (req, res) => {
  try { res.json({ success: true, session: view(req, await leaveByRoom(actorOf(req), req.params.roomCode)) }); }
  catch (err) { sendMeetingError(res, err, 'meetings.rooms.leave'); }
});

/**
 * POST /api/meetings/sessions/:id/media-token and /rooms/:roomCode/media-token: LiveKit token for audio/video.
 * Only for people the roster has let in; 503 media_not_configured when LiveKit isn't set up.
 */
async function sendMediaToken(req: Request, res: Response, s: Parameters<typeof mediaTokenFor>[1]) {
  const t = await mediaTokenFor(actorOf(req), s);
  if (!t) return res.status(503).json({ success: false, code: 'media_not_configured', error: 'Audio and video between people aren\'t connected on this server yet (LiveKit isn\'t configured).' });
  res.json({ success: true, ...t });
}
router.post('/sessions/:id/media-token', requireTenant, requirePermission('read'), sessionLimiter, async (req, res) => {
  try { await sendMediaToken(req, res, await getSessionFor(actorOf(req), assertId(req.params.id))); }
  catch (err) { sendMeetingError(res, err, 'meetings.media'); }
});
router.post('/rooms/:roomCode/media-token', requireTenant, requirePermission('read'), sessionLimiter, async (req, res) => {
  try { await sendMediaToken(req, res, await getByRoom(actorOf(req), req.params.roomCode)); }
  catch (err) { sendMeetingError(res, err, 'meetings.rooms.media'); }
});

/** GET /api/meetings/sessions/:id/attendance: Enterprise attendance report. */
router.get('/sessions/:id/attendance', requireTenant, requirePermission('read'), async (req, res) => {
  try {
    await requireOrgFeature(req, 'attendanceReports');
    const s = await getSessionFor(actorOf(req), assertId(req.params.id));
    res.json({ success: true, meeting: { id: s.id, title: s.title, startedAt: s.startedAt, endedAt: s.endedAt }, rows: attendanceReport(s) });
  } catch (err) { sendMeetingError(res, err, 'meetings.attendance'); }
});

// ---------------------------------------------------------------------------
// Analytics, organization dashboard, branding
// ---------------------------------------------------------------------------

router.get('/analytics', requireTenant, requirePermission('read'), async (req, res) => {
  try {
    await requireOrgFeature(req, 'analytics');
    const days = Math.min(365, Math.max(1, parseInt(String(req.query.days ?? '30'), 10) || 30));
    res.json({ success: true, analytics: await orgAnalytics(tenantOf(req).orgId, days) });
  } catch (err) { sendMeetingError(res, err, 'meetings.analytics'); }
});

/** Enterprise: the organization's meeting dashboard (running meetings + usage). Owners/Admins. */
router.get('/dashboard', requireTenant, requirePermission('manage_org'), async (req, res) => {
  try {
    await requireOrgFeature(req, 'adminDashboard');
    const orgId = tenantOf(req).orgId;
    res.json({ success: true, active: await activeMeetings({ orgId }), analytics: await orgAnalytics(orgId, 30) });
  } catch (err) { sendMeetingError(res, err, 'meetings.dashboard'); }
});

const brandingPath = (orgId: string) => `organizations/${orgId}/settings/branding`;
const brandingSchema = z.object({
  displayName: z.string().trim().max(60).optional(),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex color like #4f46e5.').optional(),
});

router.get('/branding', requireTenant, requirePermission('read'), async (req, res) => {
  try {
    const orgId = tenantOf(req).orgId;
    const plan = await resolveOrgPlan(orgId);
    const doc = plan.features.customBranding ? await (await getDocStore()).get(brandingPath(orgId)) : null;
    res.json({ success: true, enabled: plan.features.customBranding, branding: doc ? { displayName: doc.displayName || '', accentColor: doc.accentColor || '' } : null });
  } catch (err) { sendMeetingError(res, err, 'meetings.branding.get'); }
});

router.put('/branding', requireTenant, requirePermission('manage_org'), async (req, res) => {
  try {
    await requireOrgFeature(req, 'customBranding');
    const b = brandingSchema.parse(req.body ?? {});
    const t = tenantOf(req);
    await (await getDocStore()).set(brandingPath(t.orgId), { ...b, updatedAt: new Date().toISOString(), updatedBy: t.userId });
    res.json({ success: true, branding: b });
  } catch (err) { sendMeetingError(res, err, 'meetings.branding.put'); }
});

// ---------------------------------------------------------------------------
// Scheduled and recurring meetings (validated against the organizer's plan)
// ---------------------------------------------------------------------------

const scheduledPath = (orgId: string) => `organizations/${orgId}/scheduled_meetings`;
const scheduleSchema = z.object({
  title: z.string().trim().min(1, 'Add a title.').max(200),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-12-01.'),
  time: z.string().trim().min(1, 'Add a start time.').max(10),
  ampm: z.enum(['AM', 'PM']).optional(),
  timezone: z.string().max(64).optional(),
  duration: z.coerce.number().int().min(5, 'Meetings are at least 5 minutes.').max(LIMIT_BOUNDS.maxDurationMinutes.max),
  guests: z.array(z.string().trim().email('One of the guest addresses isn\'t valid.')).max(LIMIT_BOUNDS.maxParticipants.max).default([]),
  locations: z.array(z.string().trim().max(120)).max(20).default([]),
  permissions: z.object({ modify: z.boolean().optional(), inviteOther: z.boolean().optional(), seeGuestList: z.boolean().optional() }).partial().optional(),
  availability: z.string().max(40).optional(),
  visibility: z.string().max(40).optional(),
  additionalNotes: z.string().max(5000).optional(),
  recurrence: z.object({
    frequency: z.enum(['none', 'daily', 'weekly', 'monthly']),
    count: z.coerce.number().int().min(1).max(52, 'A series can have at most 52 meetings.'),
  }).optional(),
});

function startOf(input: z.infer<typeof scheduleSchema>): DateTime {
  const zone = input.timezone || 'utc';
  let time = input.time;
  if (input.ampm && !/am|pm/i.test(time)) time = `${time} ${input.ampm}`;
  for (const fmt of ['yyyy-MM-dd HH:mm', 'yyyy-MM-dd h:mm a', 'yyyy-MM-dd hh:mm a']) {
    const dt = DateTime.fromFormat(`${input.date} ${time}`, fmt, { zone });
    if (dt.isValid) return dt;
  }
  throw new MeetingError(400, 'invalid_input', 'That start time isn\'t valid. Use a time like 14:30.', { field: 'time' });
}

/** Problems a meeting would have under a plan's limits (scheduling, and re-checks after a downgrade). */
async function planIssues(orgId: string, minutes: number, attendees: number) {
  const plan = await resolveOrgPlan(orgId);
  const issues: Array<{ code: string; message: string }> = [];
  if (minutes > plan.limits.maxDurationMinutes) issues.push({ code: 'duration_exceeds_plan', message: `${minutes}-minute meetings are longer than the ${plan.label} plan allows (${plan.limits.maxDurationMinutes} minutes).` });
  if (attendees > plan.limits.maxParticipants) issues.push({ code: 'participants_exceed_plan', message: `${attendees} people is more than the ${plan.label} plan allows (${plan.limits.maxParticipants}, including the host).` });
  return { plan, issues };
}

/** POST /api/meetings/create: schedule a meeting or a recurring series. Every occurrence must fit the plan. */
router.post('/create', requireTenant, requirePermission('write'), async (req, res) => {
  try {
    const input = scheduleSchema.parse(req.body ?? {});
    const t = tenantOf(req);
    const attendees = new Set(input.guests.map((g) => g.toLowerCase())).size + 1;
    const { plan, issues } = await planIssues(t.orgId, input.duration, attendees);
    if (issues.length) {
      const configs = await getPlanConfigs();
      const tier = planForNeeds(configs, { minutes: input.duration, participants: attendees });
      return res.status(403).json({ success: false, code: issues[0].code, error: issues.map((i) => i.message).join(' '), issues, plan: { tier: plan.tier, label: plan.label, limits: plan.limits }, ...(tier ? { upgradeTo: tier, upgradeLabel: configs[tier].label } : {}) });
    }
    const start = startOf(input);
    const freq = input.recurrence?.frequency ?? 'none';
    const count = freq === 'none' ? 1 : input.recurrence!.count;
    const step = freq === 'daily' ? { days: 1 } : freq === 'weekly' ? { weeks: 1 } : freq === 'monthly' ? { months: 1 } : { days: 0 };
    const occurrences = Array.from({ length: count }, (_, i) => {
      const s = start.plus(Object.fromEntries(Object.entries(step).map(([k, v]) => [k, v * i])));
      return { startTime: s.toUTC().toISO()!, endTime: s.plus({ minutes: input.duration }).toUTC().toISO()! };
    });
    const roomCode = randomRoomCode();
    const base = (process.env.APP_URL || '').replace(/\/+$/, '');
    const meeting = {
      id: newId('smt'), orgId: t.orgId, title: input.title, guests: [...new Set(input.guests)], locations: input.locations,
      permissions: { modify: !!input.permissions?.modify, inviteOther: input.permissions?.inviteOther !== false, seeGuestList: !!input.permissions?.seeGuestList },
      date: input.date, time: input.time, duration: input.duration, availability: input.availability || 'Busy', visibility: input.visibility || 'Default Visibility',
      additionalNotes: input.additionalNotes || '', recurrence: { frequency: freq, count }, occurrences,
      startTime: occurrences[0].startTime, endTime: occurrences[0].endTime,
      roomCode, videoLink: `${base}/?view=greet&meet=${roomCode}`, status: 'SCHEDULED',
      plan: { tier: plan.tier, maxParticipants: plan.limits.maxParticipants, maxDurationMinutes: plan.limits.maxDurationMinutes },
      createdBy: t.userId, createdAt: new Date().toISOString(),
    };
    await (await getDocStore()).set(`${scheduledPath(t.orgId)}/${meeting.id}`, meeting);
    res.status(201).json({ success: true, message: count > 1 ? `Scheduled ${count} meetings.` : 'Meeting scheduled.', meeting });
  } catch (err) { sendMeetingError(res, err, 'meetings.schedule'); }
});

/** GET /api/meetings: the organization's scheduled meetings, each re-checked against the current plan (downgrades). */
router.get('/', requireTenant, requirePermission('read'), async (req, res) => {
  try {
    const orgId = tenantOf(req).orgId;
    const rows = await (await getDocStore()).list(scheduledPath(orgId), { orderBy: 'startTime', direction: 'asc', limit: 500 });
    const plan = await resolveOrgPlan(orgId);
    const meetings = rows.map((m) => {
      const issues = [] as string[];
      if (m.duration > plan.limits.maxDurationMinutes) issues.push(`Longer than the ${plan.label} plan allows (${plan.limits.maxDurationMinutes} min): it will end at the limit.`);
      if (m.guests.length + 1 > plan.limits.maxParticipants) issues.push(`More guests than the ${plan.label} plan allows (${plan.limits.maxParticipants}).`);
      return { ...m, planCheck: { ok: issues.length === 0, issues } };
    });
    res.json({ success: true, plan: { tier: plan.tier, label: plan.label, limits: plan.limits }, meetings });
  } catch (err) { sendMeetingError(res, err, 'meetings.list'); }
});

/**
 * POST /api/meetings/ai-summary
 * AI recap of a meeting (summary, key points, decisions, action items, follow-up email draft).
 * Signed-in members who can write records only; CRM tools are off, so nothing is created or changed.
 */
const summaryLimiter = rateLimit({ name: 'meeting-summary', windowMs: 60_000, max: 10, key: (req) => tenantOf(req).userId });
router.post('/ai-summary', requireTenant, requirePermission('write'), summaryLimiter, async (req: Request, res: Response) => {
  const parsed = meetingSummaryInputSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return res.status(400).json({ success: false, code: 'invalid_input', field: i?.path?.join('.') || undefined, error: i?.message || 'Invalid input.' });
  }
  const ctrl = new AbortController();
  res.on('close', () => { if (!res.writableEnded) ctrl.abort(); });
  try {
    const result = await generateMeetingSummary(parsed.data, ctrl.signal);
    return res.json({ success: true, ...result });
  } catch (e) {
    const err = e instanceof MeetingSummaryError ? e : new MeetingSummaryError('The summary could not be generated.', 502, 'ai_error');
    return res.status(err.status).json({ success: false, code: err.code, error: err.message });
  }
});

export default router;
