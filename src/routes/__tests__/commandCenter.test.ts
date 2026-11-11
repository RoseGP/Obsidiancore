/**
 * Dashboard command center endpoints: daily missions from real records (with streaks and badges),
 * service monitoring (SLA, unanswered, missed calls, channels, AI), voicemail review, isolation.
 * Run: npx tsx src/routes/__tests__/commandCenter.test.ts
 */
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';

let passed = 0; const ok = (n: string) => { passed++; console.log('  ✓', n); };
Object.assign(process.env, { NODE_ENV: 'test', SOCIAL_ACCOUNTS_DEV_AUTH: 'true', CRM_STORE: 'memory' });
const ENV_KEYS = ['GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER',
  'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'SMTP_HOST', 'CLOUDFLARE_SMTP_RELAY_HOST', 'SLA_FIRST_RESPONSE_MINUTES'];
for (const k of ENV_KEYS) delete process.env[k];

const { MemoryDocStore, setDocStore } = await import('../../server/data/docStore');
const store = new MemoryDocStore(); setDocStore(store);
const { guard, PUBLIC } = await import('../../server/routeGuards');
const dashboard = (await import('../dashboardApi')).default;
const leads = (await import('../leadsApi')).default;
const comm = (await import('../communication')).default;
const { resetInboxCacheForTests } = await import('../messagingPlatform');
const { userKeyOf, summarizeHistory, computeMissions } = await import('../../server/crm/missions');
const { overallStatus, unansweredInbound, channelStatuses } = await import('../../server/crm/serviceStatus');
const { createProposal, shareProposal } = await import('../../features/proposals/server/proposals');

const app = express(); app.use(express.json());
app.use('/api/dashboard', guard(PUBLIC.none), dashboard);
app.use('/api/leads', guard(PUBLIC.leads), leads);
app.use('/api/communication', guard(PUBLIC.communication), comm);
const as = (uid: string) => ({
  get: (p: string) => request(app).get(p).set('X-Dev-User-Id', uid),
  post: (p: string, b: any = {}) => request(app).post(p).set('X-Dev-User-Id', uid).send(b),
  patch: (p: string, b: any = {}) => request(app).patch(p).set('X-Dev-User-Id', uid).send(b),
});
const anon = request(app);
const DAY = 86_400_000;
const local = new Date(); const midnight = new Date(local.getFullYear(), local.getMonth(), local.getDate());
const pad = (n: number) => String(n).padStart(2, '0');
const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = isoDay(midnight);
const dayStart = midnight.toISOString();
const missionsUrl = `/api/dashboard/missions?date=${today}&dayStart=${encodeURIComponent(dayStart)}`;

// ---- Sign-in ----
assert.equal((await anon.get(missionsUrl)).status, 401);
assert.equal((await anon.get('/api/dashboard/service')).status, 401);
assert.equal((await anon.post('/api/communication/voicemails/vm_x/reviewed')).status, 401);
ok('missions, service status and voicemail review require sign-in');

// ---- Validation ----
assert.equal((await as('olivia').get(`/api/dashboard/missions?date=2026-13-45&dayStart=${encodeURIComponent(dayStart)}`)).status, 400);
assert.equal((await as('olivia').get(`/api/dashboard/missions?date=${today}&dayStart=${encodeURIComponent(new Date(Date.now() - 5 * DAY).toISOString())}`)).status, 400);
assert.equal((await as('olivia').get(`/api/dashboard/missions?date=${today}`)).status, 400);
ok('missions need a valid local date and a local midnight within the last 36 hours');

// ---- Empty organization: nothing measurable, nothing invented ----
let r = await as('olivia').get(missionsUrl);
assert.equal(r.status, 200);
assert.deepEqual(r.body.missions, []); assert.equal(r.body.totalCount, 0); assert.equal(r.body.completionPct, 0);
assert.equal(r.body.xpToday, 0); assert.deepEqual(r.body.streak, { current: 0, best: 0 });
assert.equal(r.body.badges.every((b: any) => !b.earned), true);
ok('an organization with no records gets no missions, 0 XP and no badges');

// ---- Real work, done through the real routes ----
const orgA = (await store.get('crm_user_memberships/olivia')).defaultOrgId;
const mk = async (name: string, hot: boolean) => (await as('olivia').post('/api/leads', hot
  ? { name, email: `${name.toLowerCase()}@acme.test`, phone: '+15550100', company: 'Acme', title: 'Director' }
  : { name, email: `${name.toLowerCase()}@gmail.com` })).body.lead;
const H1 = await mk('Hot1', true), H2 = await mk('Hot2', true);
const L1 = await mk('Cold1', false), L2 = await mk('Cold2', false), L3 = await mk('Cold3', false);
assert.ok(H1.score >= 70 && L1.score < 70);
// An inactive lead: untouched for 40 days.
const old = new Date(Date.now() - 40 * DAY).toISOString();
await store.set(`organizations/${orgA}/leads/lead_old1`, { id: 'lead_old1', orgId: orgA, name: 'Old Friend', email: 'old@gmail.com', status: 'new', score: 20, isConverted: false, createdAt: old, updatedAt: old });

await as('olivia').patch(`/api/leads/${H1.id}/status`, { status: 'contacted' });
await as('olivia').patch(`/api/leads/${L1.id}/status`, { status: 'qualified' });
await as('olivia').patch(`/api/leads/${L2.id}/status`, { status: 'qualified' });
await as('olivia').patch('/api/leads/lead_old1/status', { status: 'contacted' });

const proposalBody = { title: 'Website', client: { name: 'Ada', email: 'ada@acme.test' }, currency: 'USD', items: [{ title: 'Design', quantity: 1, unitPrice: 100000 }] };
const p1 = await createProposal(orgA, 'olivia', proposalBody);
await createProposal(orgA, 'olivia', proposalBody);
await shareProposal(orgA, p1.id);
await store.set(`organizations/${orgA}/scheduled_meetings/smt_1`, { id: 'smt_1', orgId: orgA, title: 'Demo', createdBy: 'olivia', createdAt: new Date().toISOString(), startTime: new Date(Date.now() + DAY).toISOString() });
await store.set(`organizations/${orgA}/scheduled_meetings/smt_old`, { id: 'smt_old', orgId: orgA, title: 'Old', createdBy: 'olivia', createdAt: new Date(Date.now() - 3 * DAY).toISOString() });

r = await as('olivia').get(missionsUrl);
const m = Object.fromEntries(r.body.missions.map((x: any) => [x.id, x]));
// qualify: 2 done today; still new: Hot2, Cold3 → target min(5, 2 + 2) = 4
assert.deepEqual([m.qualify_leads.progress, m.qualify_leads.target, m.qualify_leads.done], [2, 4, false]);
// follow-up: Hot1 contacted; Hot2 waiting → target 2
assert.deepEqual([m.follow_up_high_value.progress, m.follow_up_high_value.target], [1, 2]);
// proposals: 1 shared today, 1 draft → target 2
assert.deepEqual([m.send_proposals.progress, m.send_proposals.target], [1, 2]);
// meetings: 1 scheduled today (the older one doesn't count); prospects: Hot1, Cold1, Cold2, Old → target 3
assert.deepEqual([m.schedule_meetings.progress, m.schedule_meetings.target], [1, 3]);
// reconnect: Old Friend (40 days untouched) contacted today; nothing else inactive → 1/1 done
assert.deepEqual([m.reconnect_inactive.progress, m.reconnect_inactive.target, m.reconnect_inactive.done], [1, 1, true]);
assert.equal(m.review_voicemails, undefined); // no voicemails: not measurable, not shown
assert.equal(r.body.completedCount, 1); assert.equal(r.body.xpToday, m.reconnect_inactive.xp);
assert.equal(r.body.completionPct, Math.round(100 / r.body.totalCount));
assert.equal(m.qualify_leads.action.view, 'leads'); assert.equal(m.send_proposals.action.view, 'proposals');
ok('missions count my real actions today against the work actually available; unmeasurable ones are left out');

// ---- Voicemails: review route + mission ----
await store.set(`organizations/${orgA}/voicemails/vm_1`, { id: 'vm_1', from: '+15557770000', durationSeconds: 12, at: new Date().toISOString() });
await store.set(`organizations/${orgA}/voicemails/vm_2`, { id: 'vm_2', from: '+15557770001', durationSeconds: 8, at: new Date().toISOString() });
assert.equal((await as('bea').post('/api/communication/voicemails/vm_1/reviewed')).status, 404);
assert.equal((await as('olivia').post('/api/communication/voicemails/../x/reviewed')).status === 200, false);
r = await as('olivia').post('/api/communication/voicemails/vm_1/reviewed');
assert.equal(r.status, 200); assert.equal(r.body.voicemail.reviewedBy, 'olivia');
r = await as('olivia').get(missionsUrl);
const vm = r.body.missions.find((x: any) => x.id === 'review_voicemails');
assert.deepEqual([vm.progress, vm.target, vm.done], [1, 2, false]);
await as('olivia').post('/api/communication/voicemails/vm_2/reviewed');
r = await as('olivia').get(missionsUrl);
assert.equal(r.body.missions.find((x: any) => x.id === 'review_voicemails').done, true);
ok('voicemails can be marked reviewed (own organization only) and the review mission tracks it');

// ---- Streaks, XP history, badges ----
const key = userKeyOf('olivia');
const back = (n: number) => isoDay(new Date(midnight.getTime() - n * DAY + 12 * 3_600_000));
await store.set(`organizations/${orgA}/mission_days/${key}__${back(1)}`, { userKey: key, date: back(1), completed: 2, total: 5, xp: 200, updatedAt: '' });
await store.set(`organizations/${orgA}/mission_days/${key}__${back(2)}`, { userKey: key, date: back(2), completed: 1, total: 4, xp: 100, updatedAt: '' });
await store.set(`organizations/${orgA}/mission_days/${key}__${back(5)}`, { userKey: key, date: back(5), completed: 1, total: 4, xp: 800, updatedAt: '' });
await store.set(`organizations/${orgA}/mission_days/${userKeyOf('someone-else')}__${back(3)}`, { userKey: userKeyOf('someone-else'), date: back(3), completed: 3, total: 3, xp: 5000, updatedAt: '' });
r = await as('olivia').get(missionsUrl);
assert.deepEqual(r.body.streak, { current: 3, best: 3 });
assert.equal(r.body.totalXp, 200 + 100 + 800 + r.body.xpToday);
const badges = Object.fromEntries(r.body.badges.map((b: any) => [b.id, b.earned]));
assert.deepEqual(badges, { first_mission: true, streak_3: true, streak_7: false, streak_30: false, xp_1000: true });
const saved = await store.get(`organizations/${orgA}/mission_days/${key}__${today}`);
assert.equal(saved.completed, r.body.completedCount); assert.equal(saved.xp, r.body.xpToday);
ok('today is stored; streak, total XP and badges come from my own history only');

// Pure history rules
assert.deepEqual(summarizeHistory([{ date: '2026-03-01', completed: 1, total: 1, xp: 50 }, { date: '2026-03-02', completed: 1, total: 1, xp: 50 }], '2026-03-03').streak, { current: 2, best: 2 });
assert.deepEqual(summarizeHistory([{ date: '2026-03-01', completed: 1, total: 1, xp: 50 }], '2026-03-03').streak, { current: 0, best: 1 });
assert.deepEqual(summarizeHistory([{ date: '2026-02-28', completed: 1, total: 1, xp: 0 }, { date: '2026-03-01', completed: 1, total: 1, xp: 0 }, { date: '2026-03-01', completed: 0, total: 1, xp: 0 }], '2026-03-01').streak.best, 2);
assert.deepEqual(computeMissions({ me: { userId: 'u', actor: 'U' }, dayStart: Date.now(), leads: [], leadActivities: {}, orgActivities: [], proposals: [], scheduledMeetings: [], voicemails: [] }), []);
ok('streak rules: a missed yesterday breaks it; today counts once done; across month ends');

// ---- Cross-organization ----
r = await as('bea').get(missionsUrl);
assert.deepEqual(r.body.missions, []); assert.equal(r.body.totalXp, 0);
ok('another organization sees none of these missions, XP or history');

// ---- Service status ----
const conv = async (org: string, id: string, status: string, msgs: [string, number][]) => {
  await store.set(`organizations/${org}/inbox_conversations/${id}`, { id, orgId: org, type: 'widget', channel: 'widget', title: id, participantIds: [], participants: [], unreadCount: 0, status, priority: 'medium', tags: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  for (const [i, [who, minsAgo]] of msgs.entries()) {
    await store.set(`organizations/${org}/inbox_conversations/${id}/messages/${id}_m${i}`, { id: `${id}_m${i}`, conversationId: id, senderId: who, senderType: who, senderName: who, content: 'hi', contentType: 'text', status: 'delivered', createdAt: new Date(Date.now() - minsAgo * 60_000).toISOString() });
  }
};
await conv(orgA, 'c1', 'open', [['visitor', 120], ['user', 115]]);            // 5 min: met
await conv(orgA, 'c2', 'open', [['visitor', 180], ['system', 179], ['user', 140]]); // 40 min (AI/system reply ignored): miss
await conv(orgA, 'c3', 'open', [['visitor', 60]]);                              // unanswered past target: miss + unanswered
await conv(orgA, 'c4', 'pending', [['visitor', 5]]);                            // unanswered, not measured yet
await conv(orgA, 'c5', 'resolved', [['visitor', 10 * 24 * 60], ['user', 10 * 24 * 60 - 1]]); // outside the 7-day window
await store.set(`organizations/${orgA}/inbound_messages/in1`, { id: 'in1', channel: 'WHATSAPP', from: '15551234567', body: 'Hello?', at: new Date(Date.now() - 60 * 60_000).toISOString() });
await store.set(`organizations/${orgA}/outbound_messages/out1`, { id: 'out1', channel: 'WHATSAPP', to: '+1 555 123 4567', body: 'earlier', at: new Date(Date.now() - 120 * 60_000).toISOString() });
await store.set(`organizations/${orgA}/inbound_messages/in2`, { id: 'in2', channel: 'SMS', from: '15559876543', body: 'Thanks', at: new Date(Date.now() - 90 * 60_000).toISOString() });
await store.set(`organizations/${orgA}/outbound_messages/out2`, { id: 'out2', channel: 'SMS', to: '15559876543', body: 'reply', at: new Date(Date.now() - 30 * 60_000).toISOString() });
resetInboxCacheForTests();

r = await as('olivia').get('/api/dashboard/service');
assert.equal(r.status, 200);
assert.equal(r.body.windowDays, 7); assert.equal(r.body.slaTargetMinutes, 15);
assert.equal(r.body.measuredConversations, 3);
assert.equal(r.body.slaMetRate, 33.3);
assert.equal(r.body.avgFirstResponseMinutes, 22.5);
assert.equal(r.body.unansweredCount, 3); // c3, c4 + one WhatsApp contact waiting
assert.deepEqual(r.body.missedCalls, { count: null, windowHours: 24, unreviewed: null }); // no phone number connected
assert.deepEqual(r.body.ai, { claude: { configured: false }, gemini: { configured: false } });
assert.equal(r.body.overall, 'red');
const ch = Object.fromEntries(r.body.channels.map((c: any) => [c.id, c.status]));
assert.deepEqual(ch, { website_chat: 'not_configured', whatsapp: 'not_configured', sms: 'not_configured', voice: 'not_configured', email: 'not_configured', telegram: 'not_available', instagram: 'not_available' });
ok('service: SLA met rate and first-response time from real conversations; unanswered includes WhatsApp/SMS; unmeasured is null');

// With configuration (and secret-looking values that must never be returned)
Object.assign(process.env, { TWILIO_ACCOUNT_SID: 'AC-secret-sid-123', TWILIO_AUTH_TOKEN: 'supersecret-token-xyz', TWILIO_PHONE_NUMBER: '+15550001111', SMTP_HOST: 'smtp.secret-host.test', GEMINI_API_KEY: 'gm-secret-key-999', SLA_FIRST_RESPONSE_MINUTES: '60' });
await store.set(`organizations/${orgA}/inbound_routes/phone_15550001111`, { id: 'phone_15550001111', kind: 'phone', number: '15550001111', orgId: orgA });
await store.set(`organizations/${orgA}/inbox_widgets/acme_chat`, { widgetKey: 'acme_chat', orgId: orgA, businessName: 'Acme', isActive: true });
resetInboxCacheForTests();
r = await as('olivia').get('/api/dashboard/service');
const text = JSON.stringify(r.body);
for (const secret of ['AC-secret-sid-123', 'supersecret-token-xyz', 'smtp.secret-host.test', 'gm-secret-key-999', '+15550001111']) assert.equal(text.includes(secret), false, secret);
const ch2 = Object.fromEntries(r.body.channels.map((c: any) => [c.id, c.status]));
assert.deepEqual([ch2.website_chat, ch2.sms, ch2.voice, ch2.email, ch2.whatsapp], ['connected', 'connected', 'connected', 'connected', 'not_configured']);
assert.deepEqual(r.body.missedCalls, { count: 2, windowHours: 24, unreviewed: 0 }); // both voicemails reviewed above
assert.equal(r.body.slaTargetMinutes, 60);
assert.equal(r.body.slaMetRate, 66.7); // 5 and 40 min within 60; c3 has waited just over 60 min unanswered: a miss
assert.equal(r.body.ai.gemini.configured, true);
assert.equal(r.body.overall, 'red'); // SLA below 80%
ok('channels reflect server configuration and the organization\'s own setup; no secret or env value is returned');

r = await as('bea').get('/api/dashboard/service');
assert.equal(r.body.measuredConversations, 0); assert.equal(r.body.slaMetRate, null); assert.equal(r.body.avgFirstResponseMinutes, null);
assert.equal(r.body.unansweredCount, 0); assert.equal(r.body.missedCalls.count, null);
assert.equal(r.body.channels.find((c: any) => c.id === 'website_chat').status, 'not_configured');
assert.equal(r.body.overall, 'green'); // AI configured, nothing measured, nothing waiting
ok('another organization sees none of these conversations, messages or voicemails');

// Overall status rules
assert.equal(overallStatus({ aiConfigured: false, slaMetRate: 100, unansweredCount: 0, unreviewedMissedCalls: 0 }), 'red');
assert.equal(overallStatus({ aiConfigured: true, slaMetRate: 79.9, unansweredCount: 0, unreviewedMissedCalls: 0 }), 'red');
assert.equal(overallStatus({ aiConfigured: true, slaMetRate: 95, unansweredCount: 0, unreviewedMissedCalls: 0 }), 'yellow');
assert.equal(overallStatus({ aiConfigured: true, slaMetRate: 100, unansweredCount: 1, unreviewedMissedCalls: 0 }), 'yellow');
assert.equal(overallStatus({ aiConfigured: true, slaMetRate: null, unansweredCount: 0, unreviewedMissedCalls: 2 }), 'yellow');
assert.equal(overallStatus({ aiConfigured: true, slaMetRate: 99.5, unansweredCount: 0, unreviewedMissedCalls: 0 }), 'green');
assert.equal(unansweredInbound([{ from: '1555', at: '2026-01-01T10:00:00Z' }, { from: '1555', at: '2026-01-01T11:00:00Z' }], [], 0), 1);
assert.equal(channelStatuses({ TWILIO_ACCOUNT_SID: 'placeholder', TWILIO_AUTH_TOKEN: 'x', TWILIO_PHONE_NUMBER: 'y' } as any, { hasActiveWidget: false, hasPhoneRoute: true, hasWhatsappRoute: false }).find((c) => c.id === 'sms')!.status, 'not_configured');
ok('overall colour: red (no AI or SLA < 80%), yellow (SLA < 99%, anything waiting, unreviewed voicemail), green otherwise');

for (const k of ENV_KEYS) delete process.env[k];
console.log(`\n${passed} passed (command center)`);
process.exit(0);
