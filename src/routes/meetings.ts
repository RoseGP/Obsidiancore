/**
 * /api/meetings: meeting subscriptions, live meeting sessions (server-enforced plan limits), scheduled and
 * recurring meetings, analytics, branding and the AI recap.
 *
 * Every limit is enforced here (src/server/meetings/*); the UI only mirrors it. See docs/meetings/PLANS.md.
 */
import { Router, Request, Response } from 'express';
import crypto from 'crypto';
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
  answerRecordingConsent, muteParticipant,
} from '../server/meetings/sessions';
import {
  GreetError, announce, canEdit, getMeeting, hostOf, isInvited, lastEnd, meetingView, occurrencesFor, outcomeSchema, patchSchema,
  resolveInvitees, scheduleSchema, startOf, validateAssociations, type GreetActor,
} from '../server/greet/scheduled';
import { createInvites, invitesConfigured, listInvites, revokeInvite } from '../server/greet/invites';
import { recordAudit } from '../server/greet/audit';
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
  try { res.json({ success: true, session: view(req, await setRecording(actorOf(req), assertId(req.params.id), req.body?.action, { target: req.body?.target })) }); }
  catch (err) { sendMeetingError(res, err, 'meetings.recording'); }
});

/** POST /api/meetings/sessions/:id/recording/consent { consent: boolean }: your answer to the host's request to record. */
router.post('/sessions/:id/recording/consent', requireTenant, requirePermission('read'), sessionLimiter, async (req, res) => {
  try {
    const a = actorOf(req);
    const s = await answerRecordingConsent(a.orgId, assertId(req.params.id), { userId: a.userId }, req.body?.consent);
    await recordAudit(a.orgId, { actorId: a.userId, action: req.body?.consent ? 'greet.recording.consent_given' : 'greet.recording.consent_declined', target: s.id });
    res.json({ success: true, session: view(req, s) });
  } catch (err) { sendMeetingError(res, err, 'meetings.recording.consent'); }
});

/** POST /api/meetings/sessions/:id/participants/:pid/mute and /mute-all: host mutes microphones through LiveKit. */
router.post('/sessions/:id/participants/:pid/mute', requireTenant, requirePermission('write'), sessionLimiter, async (req, res) => {
  try { const r = await muteParticipant(actorOf(req), assertId(req.params.id), req.params.pid); res.json({ success: true, results: r.results, session: view(req, r.session) }); }
  catch (err) { sendMeetingError(res, err, 'meetings.mute'); }
});
router.post('/sessions/:id/mute-all', requireTenant, requirePermission('write'), sessionLimiter, async (req, res) => {
  try { const r = await muteParticipant(actorOf(req), assertId(req.params.id), 'all'); res.json({ success: true, results: r.results, session: view(req, r.session) }); }
  catch (err) { sendMeetingError(res, err, 'meetings.mute_all'); }
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
const greetActor = (req: Request): GreetActor => actorOf(req);

/** Problems a meeting would have under a plan's limits (scheduling, and re-checks after a downgrade). */
async function planIssues(orgId: string, minutes: number, attendees: number) {
  const plan = await resolveOrgPlan(orgId);
  const issues: Array<{ code: string; message: string }> = [];
  if (minutes > plan.limits.maxDurationMinutes) issues.push({ code: 'duration_exceeds_plan', message: `${minutes}-minute meetings are longer than the ${plan.label} plan allows (${plan.limits.maxDurationMinutes} minutes).` });
  if (attendees > plan.limits.maxParticipants) issues.push({ code: 'participants_exceed_plan', message: `${attendees} people is more than the ${plan.label} plan allows (${plan.limits.maxParticipants}, including the host).` });
  return { plan, issues };
}
async function refusePlan(res: Response, plan: Awaited<ReturnType<typeof resolveOrgPlan>>, issues: Array<{ code: string; message: string }>, minutes: number, attendees: number) {
  const configs = await getPlanConfigs();
  const tier = planForNeeds(configs, { minutes, participants: attendees });
  return res.status(403).json({ success: false, code: issues[0].code, error: issues.map((i) => i.message).join(' '), issues, plan: { tier: plan.tier, label: plan.label, limits: plan.limits }, ...(tier ? { upgradeTo: tier, upgradeLabel: configs[tier].label } : {}) });
}
const attendeeCount = (guests: string[], invitees: Array<{ email: string }>) =>
  new Set([...guests.map((g) => g.toLowerCase()), ...invitees.map((i) => i.email.toLowerCase() || Math.random().toString())]).size + 1;

/** Sends GreetError/MeetingError/PlanError with their own status; validation errors as 400; others via sendError. */
function sendGreetError(res: Response, err: unknown, tag: string) {
  if (err instanceof GreetError) return res.status(err.status).json({ success: false, code: err.code, error: err.message, ...(err.extra ?? {}) });
  if (err instanceof z.ZodError) return res.status(400).json({ success: false, code: 'invalid_input', error: err.issues[0]?.message || 'Check the form and try again.', field: err.issues[0]?.path?.join('.') });
  return sendMeetingError(res, err, tag);
}

/** POST /api/meetings/create: schedule a GREET meeting or a recurring series. Every occurrence must fit the plan. */
router.post('/create', requireTenant, requirePermission('write'), async (req, res) => {
  try {
    const input = scheduleSchema.parse(req.body ?? {});
    const t = tenantOf(req);
    const invitees = await resolveInvitees(t.orgId, input.inviteeIds, t.userId);
    const associations = await validateAssociations(t.orgId, input.associations);
    const attendees = attendeeCount(input.guests, invitees);
    const { plan, issues } = await planIssues(t.orgId, input.duration, attendees);
    if (issues.length) return refusePlan(res, plan, issues, input.duration, attendees);
    const freq = input.recurrence?.frequency ?? 'none';
    const count = freq === 'none' ? 1 : input.recurrence!.count;
    const occurrences = occurrencesFor(startOf(input), input.duration, freq, count);
    const roomCode = randomRoomCode();
    const base = (process.env.APP_URL || '').replace(/\/+$/, '');
    const now = new Date().toISOString();
    const meeting = {
      id: newId('smt'), orgId: t.orgId, title: input.title, guests: [...new Set(input.guests.map((g) => g.toLowerCase()))], invitees, associations,
      locations: input.locations,
      permissions: { modify: !!input.permissions?.modify, inviteOther: input.permissions?.inviteOther !== false, seeGuestList: !!input.permissions?.seeGuestList },
      date: input.date, time: input.time, ampm: input.ampm ?? null, timezone: input.timezone || 'utc', duration: input.duration,
      availability: input.availability || 'Busy', visibility: input.visibility || 'Default Visibility',
      additionalNotes: input.additionalNotes || '', recurrence: { frequency: freq, count }, occurrences,
      startTime: occurrences[0].startTime, endTime: occurrences[0].endTime,
      roomCode, videoLink: `${base}/?view=greet&meet=${roomCode}`, status: 'SCHEDULED',
      plan: { tier: plan.tier, maxParticipants: plan.limits.maxParticipants, maxDurationMinutes: plan.limits.maxDurationMinutes },
      hostId: t.userId, hostName: t.name || t.email || 'Host', createdBy: t.userId, createdAt: now, updatedAt: now,
      actualStart: null, actualEnd: null, sessionIds: [], participants: [], outcome: null,
    };
    await (await getDocStore()).set(`${scheduledPath(t.orgId)}/${meeting.id}`, meeting);
    await announce(t.orgId, meeting, 'scheduled', t.name || t.email || 'Someone');
    res.status(201).json({ success: true, message: count > 1 ? `Scheduled ${count} GREET meetings.` : 'GREET meeting scheduled.', meeting: meetingView(meeting, greetActor(req)) });
  } catch (err) { sendGreetError(res, err, 'meetings.schedule'); }
});

/** GET /api/meetings: the organization's scheduled meetings (?mine=true: hosted by or inviting you), re-checked against the current plan. */
router.get('/', requireTenant, requirePermission('read'), async (req, res) => {
  try {
    const orgId = tenantOf(req).orgId;
    const a = greetActor(req);
    const rows = await (await getDocStore()).list(scheduledPath(orgId), { orderBy: 'startTime', direction: 'asc', limit: 500 });
    const plan = await resolveOrgPlan(orgId);
    const mine = req.query.mine === 'true';
    const meetings = rows.filter((m) => !mine || hostOf(m) === a.userId || isInvited(m, a)).map((m) => {
      const issues = [] as string[];
      if (m.duration > plan.limits.maxDurationMinutes) issues.push(`Longer than the ${plan.label} plan allows (${plan.limits.maxDurationMinutes} min): it will end at the limit.`);
      if ((m.guests?.length || 0) + (m.invitees?.length || 0) + 1 > plan.limits.maxParticipants) issues.push(`More guests than the ${plan.label} plan allows (${plan.limits.maxParticipants}).`);
      return { ...meetingView(m, a), planCheck: { ok: issues.length === 0, issues } };
    });
    res.json({ success: true, plan: { tier: plan.tier, label: plan.label, limits: plan.limits }, meetings });
  } catch (err) { sendGreetError(res, err, 'meetings.list'); }
});

/**
 * GET /api/meetings/hub: everything the GREET page shows for you, from the server.
 *   upcoming     your meetings (host or invited) that haven't finished, soonest first
 *   invitations  meetings you were invited to by someone else
 *   history      meetings you took part in (live sessions), newest first, plus history you imported from this browser
 *   live         meetings of your organization running right now
 */
router.get('/hub', requireTenant, requirePermission('read'), sessionLimiter, async (req, res) => {
  try {
    const a = greetActor(req);
    const st = await getDocStore();
    const now = Date.now();
    const rows = await st.list(scheduledPath(a.orgId), { orderBy: 'startTime', direction: 'asc', limit: 500 });
    const views = rows.map((m) => meetingView(m, a, now));
    const relevant = views.filter((m) => m.yourRole !== 'member');
    const upcoming = relevant.filter((m) => m.status === 'SCHEDULED' || m.status === 'LIVE')
      .sort((x, y) => Date.parse(x.nextOccurrence?.startTime || x.startTime) - Date.parse(y.nextOccurrence?.startTime || y.startTime)).slice(0, 50);
    const invitations = upcoming.filter((m) => m.yourRole === 'invitee');
    const sessions = await st.list(`organizations/${a.orgId}/meeting_sessions`, { orderBy: 'startedAt', direction: 'desc', limit: 200 });
    const byScheduled = new Map(rows.map((m) => [m.id, m]));
    const history = sessions
      .filter((s) => s.status === 'ended' && (s.hostUserId === a.userId || (s.participants || []).some((p: any) => p.userId === a.userId && p.joinedAt != null)))
      .slice(0, 60)
      .map((s) => {
        const sm = s.scheduledMeetingId ? byScheduled.get(s.scheduledMeetingId) : null;
        return {
          id: s.id, source: 'server' as const, title: s.title, roomCode: s.roomCode, startedAt: s.startedAt, endedAt: s.endedAt,
          minutes: Math.round(((s.endedAt ?? s.startedAt) - s.startedAt) / 60_000), hostName: s.hostName, youHosted: s.hostUserId === a.userId,
          participants: (s.participants || []).filter((p: any) => p.joinedAt != null).map((p: any) => ({ name: p.name, role: p.role })),
          recordingUsed: !!s.recording?.used, scheduledMeetingId: s.scheduledMeetingId ?? null,
          associations: sm?.associations || {}, outcome: sm?.outcome ?? null,
        };
      });
    const imported = (await st.list(`organizations/${a.orgId}/greet_history_imports`, { where: [['ownerId', '==', a.userId]], limit: 200 }))
      .map((h) => ({ ...h, source: 'imported' as const }));
    const live = (await st.list(`organizations/${a.orgId}/meeting_sessions`, { where: [['status', '==', 'active']], limit: 50 }))
      .filter((s) => s.endsAt > now)
      .map((s) => ({ id: s.id, title: s.title, roomCode: s.roomCode, hostName: s.hostName, startedAt: s.startedAt, participantCount: (s.participants || []).filter((p: any) => p.status === 'in').length, scheduledMeetingId: s.scheduledMeetingId ?? null }));
    res.json({ success: true, upcoming, invitations, history: [...history, ...imported].sort((x: any, y: any) => (y.startedAt || 0) - (x.startedAt || 0)), live, serverNow: now });
  } catch (err) { sendGreetError(res, err, 'meetings.hub'); }
});

/** POST /api/meetings/history/import { records: [...] }: moves meeting history kept in this browser to the server (idempotent per record id). */
const importSchema = z.object({
  records: z.array(z.object({
    id: z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/),
    title: z.string().trim().max(200).default('Meeting'),
    startedAt: z.coerce.number().int().nonnegative(),
    endedAt: z.coerce.number().int().nonnegative().optional(),
    durationSeconds: z.coerce.number().int().nonnegative().max(7 * 86_400).optional(),
    participants: z.array(z.string().trim().max(120)).max(500).optional(),
    notes: z.string().max(20_000).optional(),
  })).max(500),
});
router.post('/history/import', requireTenant, requirePermission('write'), sessionLimiter, async (req, res) => {
  try {
    const { records } = importSchema.parse(req.body ?? {});
    const a = greetActor(req);
    const st = await getDocStore();
    let imported = 0;
    for (const r of records) {
      const key = crypto.createHash('sha256').update(`${a.userId}:${r.id}`).digest('hex').slice(0, 40);
      const path = `organizations/${a.orgId}/greet_history_imports/${key}`;
      if (await st.get(path)) continue;
      const endedAt = r.endedAt ?? (r.durationSeconds != null ? r.startedAt + r.durationSeconds * 1000 : r.startedAt);
      await st.set(path, {
        id: key, ownerId: a.userId, title: r.title || 'Meeting', startedAt: r.startedAt, endedAt,
        minutes: Math.round((endedAt - r.startedAt) / 60_000), participants: (r.participants || []).map((name) => ({ name, role: 'guest' })),
        notes: r.notes || '', importedAt: new Date().toISOString(),
      });
      imported++;
    }
    res.json({ success: true, imported, skipped: records.length - imported });
  } catch (err) { sendGreetError(res, err, 'meetings.history.import'); }
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

/** GET /api/meetings/:id: one scheduled meeting with its invitations, attendance and outcome. */
router.get('/:id', requireTenant, requirePermission('read'), async (req, res) => {
  try {
    const a = greetActor(req);
    const m = await getMeeting(a.orgId, assertId(req.params.id));
    const view = meetingView(m, a);
    const invites = view.canEdit ? (await listInvites(a.orgId, m.id)).map((i: any) => ({ id: i.id, email: i.email, name: i.name, createdAt: i.createdAt, expiresAt: i.expiresAt, revoked: !!i.revoked, lastUsedAt: i.lastUsedAt })) : undefined;
    res.json({ success: true, meeting: view, invites, invitesConfigured: invitesConfigured() });
  } catch (err) { sendGreetError(res, err, 'meetings.get'); }
});

/** PATCH /api/meetings/:id: edit or reschedule (owner or manage_records). Plan limits are checked again. */
router.patch('/:id', requireTenant, requirePermission('write'), async (req, res) => {
  try {
    const a = greetActor(req);
    const input = patchSchema.parse(req.body ?? {});
    const st = await getDocStore();
    const m = await getMeeting(a.orgId, assertId(req.params.id));
    if (!canEdit(m, a)) return res.status(403).json({ success: false, code: 'not_meeting_owner', error: 'Only the meeting\'s host or a manager can change it.' });
    if (m.status === 'CANCELLED') return res.status(409).json({ success: false, code: 'meeting_cancelled', error: 'This meeting was cancelled.' });
    if (m.status === 'LIVE') return res.status(409).json({ success: false, code: 'meeting_live', error: 'This meeting is running. Change it after it ends.' });
    const next: any = { ...m };
    for (const k of ['title', 'locations', 'availability', 'visibility', 'additionalNotes', 'permissions'] as const) if (input[k] !== undefined) next[k] = input[k];
    if (input.guests) next.guests = [...new Set(input.guests.map((g) => g.toLowerCase()))];
    if (input.inviteeIds) next.invitees = await resolveInvitees(a.orgId, input.inviteeIds, hostOf(m));
    if (input.associations !== undefined) next.associations = await validateAssociations(a.orgId, input.associations);
    const timing = input.date !== undefined || input.time !== undefined || input.duration !== undefined || input.timezone !== undefined || input.ampm !== undefined;
    if (timing) {
      Object.assign(next, {
        date: input.date ?? m.date, time: input.time ?? m.time, ampm: input.ampm ?? m.ampm ?? undefined,
        timezone: input.timezone ?? m.timezone ?? 'utc', duration: input.duration ?? m.duration,
      });
      next.occurrences = occurrencesFor(startOf({ date: next.date, time: next.time, ampm: next.ampm || undefined, timezone: next.timezone }), next.duration, m.recurrence?.frequency || 'none', m.recurrence?.count || 1);
      next.startTime = next.occurrences[0].startTime; next.endTime = next.occurrences[0].endTime;
      if (Date.parse(next.endTime) > Date.now()) { next.status = 'SCHEDULED'; next.actualStart = null; next.actualEnd = null; }
    }
    const attendees = attendeeCount(next.guests || [], next.invitees || []);
    const { plan, issues } = await planIssues(a.orgId, next.duration, attendees);
    if (issues.length) return refusePlan(res, plan, issues, next.duration, attendees);
    next.updatedAt = new Date().toISOString(); next.updatedBy = a.userId;
    await st.set(`${scheduledPath(a.orgId)}/${m.id}`, next);
    if (timing) await announce(a.orgId, next, 'rescheduled', a.name || a.email || 'Someone');
    await recordAudit(a.orgId, { actorId: a.userId, action: timing ? 'greet.meeting.rescheduled' : 'greet.meeting.updated', target: m.id });
    res.json({ success: true, message: timing ? 'Meeting rescheduled.' : 'Meeting updated.', meeting: meetingView(next, a) });
  } catch (err) { sendGreetError(res, err, 'meetings.update'); }
});

/** POST /api/meetings/:id/cancel { reason? }: cancels the meeting (owner or manage_records). Invitation links stop working. */
router.post('/:id/cancel', requireTenant, requirePermission('write'), async (req, res) => {
  try {
    const a = greetActor(req);
    const m = await getMeeting(a.orgId, assertId(req.params.id));
    if (!canEdit(m, a)) return res.status(403).json({ success: false, code: 'not_meeting_owner', error: 'Only the meeting\'s host or a manager can cancel it.' });
    if (m.status === 'LIVE') return res.status(409).json({ success: false, code: 'meeting_live', error: 'This meeting is running. End it for everyone instead.' });
    if (m.status === 'CANCELLED') return res.json({ success: true, meeting: meetingView(m, a) });
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 500) : '';
    const next = { ...m, status: 'CANCELLED', cancelledAt: new Date().toISOString(), cancelledBy: a.userId, cancelReason: reason, updatedAt: new Date().toISOString() };
    await (await getDocStore()).set(`${scheduledPath(a.orgId)}/${m.id}`, next);
    await announce(a.orgId, next, 'cancelled', a.name || a.email || 'Someone', reason ? `Reason: ${reason}` : '');
    await recordAudit(a.orgId, { actorId: a.userId, action: 'greet.meeting.cancelled', target: m.id });
    res.json({ success: true, message: 'Meeting cancelled.', meeting: meetingView(next, a) });
  } catch (err) { sendGreetError(res, err, 'meetings.cancel'); }
});

/** POST /api/meetings/:id/outcome { result, summary? }: how the meeting went (host, invitee or manager). Logged to the CRM. */
router.post('/:id/outcome', requireTenant, requirePermission('write'), async (req, res) => {
  try {
    const a = greetActor(req);
    const input = outcomeSchema.parse(req.body ?? {});
    const m = await getMeeting(a.orgId, assertId(req.params.id));
    if (!canEdit(m, a) && !isInvited(m, a)) return res.status(403).json({ success: false, code: 'not_meeting_owner', error: 'Only people in this meeting or a manager can record its outcome.' });
    const outcome = { result: input.result, summary: input.summary, at: new Date().toISOString(), by: a.userId, byName: a.name || a.email || '' };
    const next = { ...m, outcome, updatedAt: outcome.at, ...(m.status === 'SCHEDULED' && lastEnd(m) < Date.now() ? { status: 'ENDED' } : {}) };
    await (await getDocStore()).set(`${scheduledPath(a.orgId)}/${m.id}`, next);
    await announce(a.orgId, next, 'outcome', a.name || a.email || 'Someone', `${input.result.replace('_', ' ')}${input.summary ? `: ${input.summary.slice(0, 300)}` : ''}`);
    res.json({ success: true, meeting: meetingView(next, a) });
  } catch (err) { sendGreetError(res, err, 'meetings.outcome'); }
});

/** POST /api/meetings/:id/invites { guests?: [{ email, name? }] } (default: every external guest): secure, expiring guest links. */
const inviteSchema = z.object({ guests: z.array(z.object({ email: z.string().trim().email(), name: z.string().trim().max(120).optional() })).max(200).optional() });
router.post('/:id/invites', requireTenant, requirePermission('write'), sessionLimiter, async (req, res) => {
  try {
    const a = greetActor(req);
    const input = inviteSchema.parse(req.body ?? {});
    const m = await getMeeting(a.orgId, assertId(req.params.id));
    if (!canEdit(m, a)) return res.status(403).json({ success: false, code: 'not_meeting_owner', error: 'Only the meeting\'s host or a manager can invite guests.' });
    if (m.status === 'CANCELLED') return res.status(409).json({ success: false, code: 'meeting_cancelled', error: 'This meeting was cancelled.' });
    if (!invitesConfigured()) return res.status(503).json({ success: false, code: 'invites_not_configured', error: 'Guest invitation links need GREET_INVITE_SECRET (or JWT_SECRET) on the server.' });
    const people = input.guests ?? (m.guests || []).map((email: string) => ({ email }));
    if (!people.length) return res.status(400).json({ success: false, code: 'invalid_input', error: 'Add at least one guest email.', field: 'guests' });
    const guests = [...new Set([...(m.guests || []), ...people.map((p) => p.email.toLowerCase())])];
    const attendees = attendeeCount(guests, m.invitees || []);
    const { plan, issues } = await planIssues(a.orgId, m.duration, attendees);
    if (issues.length) return refusePlan(res, plan, issues, m.duration, attendees);
    const base = (process.env.APP_URL || '').replace(/\/+$/, '');
    const created = await createInvites(a.orgId, m, people, a.userId, base);
    if (guests.length !== (m.guests || []).length) await (await getDocStore()).update(`${scheduledPath(a.orgId)}/${m.id}`, { guests, updatedAt: new Date().toISOString() });
    await recordAudit(a.orgId, { actorId: a.userId, action: 'greet.invites.created', target: m.id, meta: { count: created.length } });
    res.status(201).json({ success: true, invites: created, message: created.length === 1 ? 'Invitation link created. Send it to your guest.' : `${created.length} invitation links created.` });
  } catch (err) { sendGreetError(res, err, 'meetings.invites.create'); }
});

router.delete('/:id/invites/:inviteId', requireTenant, requirePermission('write'), async (req, res) => {
  try {
    const a = greetActor(req);
    const m = await getMeeting(a.orgId, assertId(req.params.id));
    if (!canEdit(m, a)) return res.status(403).json({ success: false, code: 'not_meeting_owner', error: 'Only the meeting\'s host or a manager can withdraw invitations.' });
    await revokeInvite(a.orgId, m.id, req.params.inviteId);
    await recordAudit(a.orgId, { actorId: a.userId, action: 'greet.invite.revoked', target: m.id, meta: { inviteId: req.params.inviteId } });
    res.json({ success: true, message: 'Invitation withdrawn.' });
  } catch (err) { sendGreetError(res, err, 'meetings.invites.revoke'); }
});

export default router;
