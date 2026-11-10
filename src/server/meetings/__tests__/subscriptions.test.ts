/**
 * Meeting subscriptions, server-enforced: plans (admin-configurable), subscriptions and change requests,
 * live sessions (capacity, time limit, features), upgrades/downgrades, scheduled and recurring meetings,
 * analytics, platform administration, and tenant isolation.
 * Run: npx tsx src/server/meetings/__tests__/subscriptions.test.ts
 */
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';

let passed = 0; const ok = (n: string) => { passed++; console.log('  ✓', n); };
Object.assign(process.env, { NODE_ENV: 'test', SOCIAL_ACCOUNTS_DEV_AUTH: 'true', CRM_STORE: 'memory', PLATFORM_ADMIN_USER_IDS: 'root', APP_URL: 'https://crm.example.com' });

const { MemoryDocStore, setDocStore } = await import('../../data/docStore');
const store = new MemoryDocStore(); setDocStore(store);
const { clearPlanCache } = await import('../plans');
const { sweepExpiredMeetings } = await import('../sessions');
const { guard, PUBLIC } = await import('../../routeGuards');
const meetings = (await import('../../../routes/meetings')).default;
const admin = (await import('../../../routes/meetingAdminApi')).default;
const app = express(); app.use(express.json());
app.use('/api/meetings', guard(PUBLIC.none), meetings);
app.use('/api/admin/meetings', guard(PUBLIC.none), admin);

const as = (uid: string) => ({
  get: (p: string) => request(app).get(p).set('X-Dev-User-Id', uid),
  post: (p: string, b: any = {}) => request(app).post(p).set('X-Dev-User-Id', uid).send(b),
  put: (p: string, b: any = {}) => request(app).put(p).set('X-Dev-User-Id', uid).send(b),
  patch: (p: string, b: any = {}) => request(app).patch(p).set('X-Dev-User-Id', uid).send(b),
  del: (p: string) => request(app).delete(p).set('X-Dev-User-Id', uid),
});
const emails = (n: number, prefix = 'g') => Array.from({ length: n }, (_, i) => `${prefix}${i}@example.com`);
const realNow = Date.now;
const at = (ms: number) => { Date.now = () => realNow() + ms; };
const reset = () => { Date.now = realNow; };
const MIN = 60_000;

// Organizations: olivia (owner of org A) and bea (owner of org B). Members are added to org A below.
await as('olivia').get('/api/meetings/subscription');
await as('bea').get('/api/meetings/subscription');
await as('root').get('/api/admin/meetings/me');
const orgA = (await store.get('crm_user_memberships/olivia')).defaultOrgId;
const orgB = (await store.get('crm_user_memberships/bea')).defaultOrgId;
const addMember = async (uid: string, role: string) => {
  await store.set(`organizations/${orgA}/members/${uid}`, { userId: uid, role, email: `${uid}@a.test`, name: uid, joinedAt: new Date().toISOString() });
  await store.set(`crm_user_memberships/${uid}`, { userId: uid, orgs: { [orgA]: role }, defaultOrgId: orgA });
};
await addMember('adam', 'ADMIN'); await addMember('sam', 'SALES_REP'); await addMember('rory', 'READ_ONLY');
const setTier = (orgId: string, body: any) => as('root').put(`/api/admin/meetings/subscriptions/${orgId}`, body);

// ---------------------------------------------------------------------------
// Plans and subscriptions
// ---------------------------------------------------------------------------
{
  assert.equal((await request(app).get('/api/meetings/subscription')).status, 401);
  const r = await as('olivia').get('/api/meetings/subscription');
  assert.equal(r.body.tier, 'free');
  assert.deepEqual(r.body.plans.free.limits, { maxParticipants: 100, maxDurationMinutes: 60 });
  assert.deepEqual(r.body.plans.premium.limits, { maxParticipants: 250, maxDurationMinutes: 300 });
  assert.deepEqual(r.body.plans.enterprise.limits, { maxParticipants: 500, maxDurationMinutes: 720 });
  assert.equal(r.body.plans.free.warnMinutesBefore, 5);
  assert.equal(r.body.plans.free.features.recording, false); assert.equal(r.body.plans.premium.features.recording, true);
  assert.equal(r.body.plans.premium.features.waitingRoom, true); assert.equal(r.body.plans.premium.features.analytics, true);
  assert.equal(r.body.plans.premium.features.coHosts, false); assert.equal(r.body.plans.enterprise.features.coHosts, true);
  assert.equal(r.body.plans.enterprise.features.attendanceReports, true); assert.equal(r.body.plans.enterprise.features.customBranding, true);
  ok('new organizations are on Free (100 people, 60 min); Premium 250 / 5 h; Enterprise 500 / 12 h, with their features');

  await store.set(`organizations/${orgB}/settings/meetings`, { plan: 'standard' });
  assert.equal((await as('bea').get('/api/meetings/subscription')).body.tier, 'free'); ok('an older stored "standard" plan reads as Free');

  assert.equal((await as('olivia').put('/api/meetings/plan', { plan: 'enterprise' })).status, 404);
  assert.equal((await as('olivia').get('/api/meetings/subscription')).body.tier, 'free'); ok('organizations cannot change their own plan (no bypass)');

  assert.equal((await as('sam').post('/api/meetings/subscription/requests', { tier: 'premium' })).status, 403);
  let q = await as('olivia').post('/api/meetings/subscription/requests', { tier: 'premium', note: 'Need recordings' });
  assert.equal(q.status, 201); assert.equal(q.body.request.direction, 'upgrade');
  assert.equal((await as('olivia').post('/api/meetings/subscription/requests', { tier: 'enterprise' })).status, 409);
  assert.equal((await as('olivia').post('/api/meetings/subscription/requests', { tier: 'free' })).body.code, 'same_plan');
  assert.equal((await as('olivia').get('/api/meetings/subscription')).body.pendingRequest.requestedTier, 'premium');
  ok('owners request an upgrade (one pending at a time); sales reps cannot');
  assert.equal((await as('bea').del(`/api/meetings/subscription/requests/${q.body.request.id}`)).status, 404); ok('another organization cannot cancel the request');

  assert.equal((await as('olivia').get('/api/admin/meetings/requests')).status, 403);
  const list = await as('root').get('/api/admin/meetings/requests');
  assert.equal(list.body.requests.length, 1);
  const decided = await as('root').post(`/api/admin/meetings/requests/${q.body.request.id}/approve`, { note: 'Invoice paid' });
  assert.equal(decided.status, 200); assert.equal(decided.body.request.status, 'approved');
  assert.equal((await as('olivia').get('/api/meetings/subscription')).body.tier, 'premium');
  assert.equal((await as('root').post(`/api/admin/meetings/requests/${q.body.request.id}/approve`)).status, 409);
  ok('a platform administrator approves the request: the organization is on Premium');

  q = await as('olivia').post('/api/meetings/subscription/requests', { tier: 'free' });
  assert.equal(q.body.request.direction, 'downgrade');
  await as('root').post(`/api/admin/meetings/requests/${q.body.request.id}/decline`);
  assert.equal((await as('olivia').get('/api/meetings/subscription')).body.tier, 'premium'); ok('declined requests change nothing');

  const hist = await as('root').get(`/api/admin/meetings/subscriptions/${orgA}/history`);
  assert.equal(hist.body.events[0].direction, 'upgrade'); assert.equal(hist.body.events[0].source, 'request'); ok('every change is recorded with who, when and why');
  await setTier(orgA, { tier: 'free', reason: 'reset' });
}

// ---------------------------------------------------------------------------
// Live sessions: capacity, features, time limit
// ---------------------------------------------------------------------------
let sid = '';
{
  assert.equal((await as('rory').post('/api/meetings/sessions', { title: 'x' })).status, 403); ok('read-only members cannot start meetings');
  const r = await as('sam').post('/api/meetings/sessions', { title: 'Sales kickoff', roomCode: 'kickoff-1' });
  assert.equal(r.status, 201); sid = r.body.session.id;
  const s = r.body.session;
  assert.equal(s.tier, 'free'); assert.equal(s.limits.maxParticipants, 100); assert.equal(s.participantCount, 1);
  assert.equal(s.endsAt - s.startedAt, 60 * MIN); assert.ok(s.remainingSeconds > 3590 && s.remainingSeconds <= 3600);
  ok('a meeting takes the organizer\'s plan: Free, 1/100, 60:00 countdown from the server clock');
  assert.equal((await as('olivia').post('/api/meetings/sessions', { roomCode: 'kickoff-1' })).body.code, 'room_in_use'); ok('one running meeting per room code');

  const add = await as('sam').post(`/api/meetings/sessions/${sid}/participants`, { emails: [...emails(150), 'g0@example.com', 'nope'] });
  assert.equal(add.body.added.length, 99); assert.equal(add.body.session.participantCount, 100);
  assert.equal(add.body.refused.filter((x: any) => x.reason === 'full').length, 51);
  assert.equal(add.body.refused.find((x: any) => x.email === 'nope').reason, 'invalid');
  assert.equal(add.body.upgradeTo, 'premium'); assert.equal(add.body.session.capacityState, 'full');
  ok('150 invited at once: 99 join (100 with the host), 51 refused as full, with an upgrade suggestion');
  const join = await as('bea').post('/api/meetings/rooms/kickoff-1/join');
  assert.equal(join.status, 409); assert.equal(join.body.code, 'meeting_full'); assert.equal(join.body.upgradeTo, 'premium');
  ok('joining a full meeting by link is refused on the server');

  assert.equal((await as('rory').post(`/api/meetings/sessions/${sid}/participants`, { emails: ['x@y.test'] })).status, 403);
  assert.equal((await as('olivia').post(`/api/meetings/sessions/${sid}/participants`, { emails: ['x@y.test'] })).body.refused[0].reason, 'full');
  ok('only the host, co-hosts or org admins manage the roster');

  for (const [path, body, feature] of [
    [`/api/meetings/sessions/${sid}/recording`, { action: 'start' }, 'recording'],
    [`/api/meetings/sessions/${sid}`, { waitingRoomEnabled: true }, 'waitingRoom'],
    [`/api/meetings/sessions/${sid}`, { locked: true }, 'securityControls'],
  ] as const) {
    const res = path.endsWith('/recording') ? await as('sam').post(path, body) : await as('sam').patch(path, body);
    assert.equal(res.status, 403); assert.equal(res.body.code, 'feature_not_in_plan'); assert.equal(res.body.feature, feature); assert.equal(res.body.upgradeTo, 'premium');
  }
  const someone = add.body.session.participants.find((p: any) => p.role === 'guest').id;
  assert.equal((await as('sam').del(`/api/meetings/sessions/${sid}/participants/${someone}`)).body.code, 'feature_not_in_plan');
  ok('Free: recording, waiting room, meeting lock and removing people are refused by the server, naming Premium');

  // Countdown and automatic end
  at(56 * MIN);
  let g = await as('sam').get(`/api/meetings/sessions/${sid}`);
  assert.equal(g.body.session.durationState, 'warning'); assert.ok(g.body.session.remainingSeconds <= 240 && g.body.session.remainingSeconds > 200);
  ok('at 56 minutes the server reports the 5-minute warning and ~4 minutes left');
  at(61 * MIN);
  g = await as('sam').get(`/api/meetings/sessions/${sid}`);
  assert.equal(g.body.session.status, 'ended'); assert.equal(g.body.session.endedReason, 'time_limit'); assert.equal(g.body.session.participantCount, 0);
  const late = await as('sam').post(`/api/meetings/sessions/${sid}/participants`, { emails: ['late@example.com'] });
  assert.equal(late.status, 409); assert.equal(late.body.code, 'meeting_time_limit');
  assert.equal((await as('bea').post('/api/meetings/rooms/kickoff-1/join')).status, 404);
  reset();
  ok('at 60 minutes the meeting is over on the server: no more changes, the room code is released');
  const usage = await store.get(`meeting_usage/${sid}`);
  assert.equal(usage.endedReason, 'time_limit'); assert.equal(usage.peakParticipants, 100); assert.equal(usage.durationSeconds, 3600);
  assert.equal(await store.get(`meeting_active/${sid}`), null); ok('usage is recorded (peak 100, 60 minutes) and the meeting leaves the active list');
}

// Sweeper ends meetings nobody is polling
{
  const r = await as('olivia').post('/api/meetings/sessions', { title: 'Forgotten' });
  at(70 * MIN);
  assert.equal(await sweepExpiredMeetings(), 1);
  reset();
  assert.equal((await store.get(`organizations/${orgA}/meeting_sessions/${r.body.session.id}`)).status, 'ended');
  ok('the background sweeper ends expired meetings even with nobody connected');
}

// ---------------------------------------------------------------------------
// Upgrades and downgrades during a meeting
// ---------------------------------------------------------------------------
{
  const r = await as('olivia').post('/api/meetings/sessions', { title: 'Board review' });
  const id = r.body.session.id;
  await as('olivia').post(`/api/meetings/sessions/${id}/participants`, { emails: emails(120, 'u') });
  await setTier(orgA, { tier: 'premium', reason: 'upgrade mid-meeting' });
  let g = await as('olivia').get(`/api/meetings/sessions/${id}`);
  assert.equal(g.body.session.tier, 'premium'); assert.equal(g.body.session.limits.maxParticipants, 250);
  assert.equal(g.body.session.endsAt - g.body.session.startedAt, 300 * MIN);
  const more = await as('olivia').post(`/api/meetings/sessions/${id}/participants`, { emails: emails(30, 'm') });
  assert.equal(more.body.added.length, 30);
  assert.equal((await as('olivia').post(`/api/meetings/sessions/${id}/recording`, { action: 'request' })).status, 200);
  ok('upgrading mid-meeting extends the running meeting at once (250 people, 5 hours, recording)');

  await setTier(orgA, { tier: 'free', reason: 'downgrade mid-meeting' });
  g = await as('olivia').get(`/api/meetings/sessions/${id}`);
  assert.equal(g.body.session.limits.maxParticipants, 250); assert.equal(g.body.session.endsAt - g.body.session.startedAt, 300 * MIN);
  assert.equal(g.body.session.features.recording, true);
  ok('downgrading never cuts a running meeting short');
  const next = await as('adam').post('/api/meetings/sessions', { title: 'Next' });
  assert.equal(next.body.session.limits.maxParticipants, 100); assert.equal(next.body.session.features.recording, false);
  ok('the next meeting uses the lower plan');
  await as('olivia').post(`/api/meetings/sessions/${id}/end`); await as('adam').post(`/api/meetings/sessions/${next.body.session.id}/end`);
}

// ---------------------------------------------------------------------------
// Premium and Enterprise features
// ---------------------------------------------------------------------------
{
  await setTier(orgA, { tier: 'premium' });
  const r = await as('olivia').post('/api/meetings/sessions', { title: 'Webinar', roomCode: 'webinar-2' });
  const id = r.body.session.id;
  assert.equal((await as('olivia').patch(`/api/meetings/sessions/${id}`, { waitingRoomEnabled: true })).body.session.waitingRoomEnabled, true);
  const w = await as('olivia').post(`/api/meetings/sessions/${id}/participants`, { emails: emails(3, 'w') });
  assert.equal(w.body.waiting.length, 3); assert.equal(w.body.session.participantCount, 1); assert.equal(w.body.session.waitingCount, 3);
  const bj = await as('bea').post('/api/meetings/rooms/webinar-2/join');
  assert.equal(bj.body.you.status, 'waiting');
  assert.equal(bj.body.session.participants.some((p: any) => 'email' in p), false);
  ok('Premium waiting room: invitees and link joiners wait; outsiders never see other people\'s email addresses');
  const adm = await as('olivia').post(`/api/meetings/sessions/${id}/admit`, { all: true });
  assert.equal(adm.body.admitted.length, 4); assert.equal(adm.body.session.participantCount, 5);
  const guest = adm.body.session.participants.find((p: any) => p.email === 'w0@example.com').id;
  assert.equal((await as('olivia').del(`/api/meetings/sessions/${id}/participants/${guest}`)).status, 200);
  assert.equal((await as('olivia').patch(`/api/meetings/sessions/${id}/participants/${guest}`, { role: 'cohost' })).body.feature, 'coHosts');
  ok('admit all; host removes a participant; co-hosts need Enterprise');
  assert.equal((await as('olivia').patch(`/api/meetings/sessions/${id}`, { locked: true })).body.session.locked, true);
  const lj = await as('bea').post('/api/meetings/rooms/webinar-2/join');
  assert.equal(lj.body.you.status, 'in'); // admitted before the lock: still in
  await addMember('lee', 'SALES_REP');
  assert.equal((await as('lee').post('/api/meetings/rooms/webinar-2/join')).status, 423); ok('a locked meeting refuses new joiners (423)');
  assert.equal((await as('bea').get(`/api/meetings/sessions/${id}`)).status, 404);
  assert.equal((await as('bea').post(`/api/meetings/sessions/${id}/end`)).status, 404);
  assert.equal((await as('bea').post(`/api/meetings/sessions/${id}/participants`, { emails: ['z@z.test'] })).status, 404);
  ok('another organization cannot read, change or end this meeting by id');
  assert.equal((await as('rory').post(`/api/meetings/sessions/${id}/end`)).status, 403);
  const roomView = await as('bea').get('/api/meetings/rooms/webinar-2');
  assert.equal(roomView.status, 200); assert.equal(roomView.body.session.id, id);
  assert.equal((await as('bea').post('/api/meetings/rooms/webinar-2/leave')).body.session.participants.some((p: any) => p.name === 'bea'), false);
  assert.equal((await as('bea').get('/api/meetings/rooms/webinar-2')).status, 404);
  ok('someone who joined by code from another organization follows and leaves the meeting by its code; afterwards it\'s hidden');
  const hostLeaves = await as('olivia').post(`/api/meetings/sessions/${id}/leave`);
  assert.equal(hostLeaves.body.session.status, 'ended'); assert.equal(hostLeaves.body.session.endedReason, 'host');
  ok('when the host leaves and no co-host is in, the meeting ends');

  const an = await as('olivia').get('/api/meetings/analytics');
  assert.equal(an.status, 200); assert.ok(an.body.analytics.meetings >= 4); assert.ok(an.body.analytics.endedAtTimeLimit >= 2);
  assert.equal((await as('olivia').get(`/api/meetings/sessions/${id}/attendance`)).body.code, 'feature_not_in_plan');
  assert.equal((await as('bea').get('/api/meetings/analytics')).body.code, 'feature_not_in_plan');
  ok('Premium analytics for this organization only; attendance reports are Enterprise; Free has neither');

  await setTier(orgA, { tier: 'enterprise', customLimits: { maxParticipants: 800, maxDurationMinutes: 900 } });
  const e = await as('olivia').post('/api/meetings/sessions', { title: 'All hands' });
  assert.equal(e.body.session.limits.maxParticipants, 800); assert.equal(e.body.session.endsAt - e.body.session.startedAt, 900 * MIN);
  ok('Enterprise agreement: custom limits (800 people, 15 hours) apply');
  const eid = e.body.session.id;
  const ea = await as('olivia').post(`/api/meetings/sessions/${eid}/participants`, { emails: ['co@example.com'] });
  const co = ea.body.session.participants.find((p: any) => p.email === 'co@example.com').id;
  assert.equal((await as('olivia').patch(`/api/meetings/sessions/${eid}/participants/${co}`, { role: 'cohost' })).status, 200);
  await as('olivia').post(`/api/meetings/sessions/${eid}/end`);
  const att = await as('olivia').get(`/api/meetings/sessions/${eid}/attendance`);
  assert.equal(att.status, 200); assert.ok(att.body.rows.some((r: any) => r.email === 'co@example.com' && r.role === 'cohost'));
  assert.equal((await as('sam').put('/api/meetings/branding', { displayName: 'Acme' })).status, 403);
  assert.equal((await as('olivia').put('/api/meetings/branding', { displayName: 'Acme Live', accentColor: '#0f766e' })).status, 200);
  assert.equal((await as('sam').get('/api/meetings/branding')).body.branding.displayName, 'Acme Live');
  assert.equal((await as('olivia').put('/api/meetings/branding', { accentColor: 'red' })).status, 400);
  const dash = await as('adam').get('/api/meetings/dashboard');
  assert.equal(dash.status, 200); assert.ok(Array.isArray(dash.body.active));
  assert.equal((await as('sam').get('/api/meetings/dashboard')).status, 403);
  ok('Enterprise: co-hosts, attendance report, custom branding (owners/admins set it), organization dashboard');
  assert.equal((await setTier(orgA, { tier: 'premium', customLimits: { maxParticipants: 900 } })).status, 400);
  ok('custom limits are refused outside Enterprise');
}

// ---------------------------------------------------------------------------
// Scheduled and recurring meetings
// ---------------------------------------------------------------------------
{
  await setTier(orgA, { tier: 'free' });
  const base = { title: 'Weekly sync', date: '2026-12-01', time: '14:30', guests: ['a@x.test'] };
  let r = await as('sam').post('/api/meetings/create', { ...base, duration: 90 });
  assert.equal(r.status, 403); assert.equal(r.body.code, 'duration_exceeds_plan'); assert.equal(r.body.upgradeTo, 'premium');
  r = await as('sam').post('/api/meetings/create', { ...base, duration: 30, guests: emails(100, 's') });
  assert.equal(r.body.code, 'participants_exceed_plan');
  ok('Free: scheduling a 90-minute meeting or 101 people is refused, suggesting Premium');
  r = await as('sam').post('/api/meetings/create', { ...base, duration: 60, recurrence: { frequency: 'weekly', count: 4 } });
  assert.equal(r.status, 201); assert.equal(r.body.meeting.occurrences.length, 4);
  assert.equal(r.body.meeting.occurrences[1].startTime, '2026-12-08T14:30:00.000Z');
  assert.ok(r.body.meeting.videoLink.startsWith('https://crm.example.com/?view=greet&meet='));
  assert.equal((await as('sam').post('/api/meetings/create', { ...base, duration: 30, recurrence: { frequency: 'daily', count: 53 } })).status, 400);
  ok('a weekly series of 4 is scheduled with real links; series are capped at 52');
  await setTier(orgA, { tier: 'premium' });
  assert.equal((await as('sam').post('/api/meetings/create', { ...base, duration: 240 })).status, 201);
  await setTier(orgA, { tier: 'free' });
  const l = await as('sam').get('/api/meetings');
  const long = l.body.meetings.find((m: any) => m.duration === 240);
  assert.equal(long.planCheck.ok, false); assert.match(long.planCheck.issues[0], /end at the limit/);
  assert.equal(l.body.meetings.some((m: any) => m.orgId !== orgA), false);
  assert.equal((await as('bea').get('/api/meetings')).body.meetings.length, 0);
  ok('after a downgrade, scheduled meetings that no longer fit are flagged; lists are per organization');
}

// ---------------------------------------------------------------------------
// Platform administration
// ---------------------------------------------------------------------------
{
  assert.equal((await as('olivia').get('/api/admin/meetings/me')).body.isPlatformAdmin, false);
  assert.equal((await as('root').get('/api/admin/meetings/me')).body.isPlatformAdmin, true);
  for (const [m, p] of [['get', '/plans'], ['get', '/stats'], ['get', '/active'], ['get', '/subscriptions'], ['put', '/plans/free'], ['put', `/subscriptions/${orgA}`]] as const) {
    assert.equal((await (as('adam') as any)[m](`/api/admin/meetings${p}`, { tier: 'enterprise' })).status, 403, p);
  }
  assert.equal((await request(app).get('/api/admin/meetings/plans')).status, 401);
  ok('organization admins are not platform administrators: every admin endpoint refuses them');

  let r = await as('root').put('/api/admin/meetings/plans/free', { limits: { maxDurationMinutes: 45 }, features: { recording: true } });
  assert.equal(r.status, 200); assert.equal(r.body.plan.limits.maxDurationMinutes, 45);
  clearPlanCache();
  const s = await as('sam').post('/api/meetings/sessions', { title: 'After config change' });
  assert.equal(s.body.session.endsAt - s.body.session.startedAt, 45 * MIN); assert.equal(s.body.session.features.recording, true);
  ok('administrators change a tier\'s duration and features without code changes; new meetings use them');
  assert.equal((await as('root').put('/api/admin/meetings/plans/free', { limits: { maxParticipants: 1 } })).status, 400);
  assert.equal((await as('root').put('/api/admin/meetings/plans/free', { warnMinutesBefore: 50 })).status, 400);
  assert.equal((await as('root').put('/api/admin/meetings/plans/gold', {})).status, 404);
  ok('out-of-range limits, a warning after the limit and unknown plans are rejected');

  const act = await as('root').get('/api/admin/meetings/active');
  const mine = act.body.meetings.find((m: any) => m.id === s.body.session.id);
  assert.ok(mine); assert.equal(mine.participantCount, 1);
  const stats = await as('root').get('/api/admin/meetings/stats');
  assert.equal(stats.body.stats.subscriptionsByTier.free + stats.body.stats.subscriptionsByTier.premium + stats.body.stats.subscriptionsByTier.enterprise, stats.body.stats.organizations);
  assert.ok(stats.body.stats.usage.meetings >= 5); assert.ok(stats.body.stats.activeMeetings >= 1);
  const ended = await as('root').post(`/api/admin/meetings/active/${orgA}/${s.body.session.id}/end`);
  assert.equal(ended.body.meeting.endedReason, 'admin');
  ok('administrators monitor active meetings and statistics, and can end a meeting');
  const subs = await as('root').get('/api/admin/meetings/subscriptions?tier=free');
  assert.ok(subs.body.subscriptions.every((x: any) => x.tier === 'free'));
  r = await setTier(orgB, { tier: 'enterprise', reason: 'signed agreement' });
  assert.equal(r.status, 200); assert.equal((await as('bea').get('/api/meetings/subscription')).body.tier, 'enterprise');
  assert.equal((await setTier('org_missing', { tier: 'premium' })).status, 404);
  ok('administrators list and change subscriptions (unknown organizations are refused)');
  await as('root').put('/api/admin/meetings/plans/free', { limits: { maxDurationMinutes: 60 }, features: { recording: false } });
}

console.log(`\n${passed} passed (meeting subscriptions)`);
process.exit(0);
