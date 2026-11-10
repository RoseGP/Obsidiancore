/**
 * GREET: scheduling with CRM associations and invitees, reschedule/cancel permissions, the meeting ↔ session
 * lifecycle, guest invitation links (waiting room, media tokens), host mute, consent-first recording, outcome,
 * history import and cross-tenant refusals.
 * Run: npx tsx src/server/greet/__tests__/greet.test.ts
 */
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { TokenVerifier } from 'livekit-server-sdk';

let passed = 0; const ok = (n: string) => { passed++; console.log('  ✓', n); };
Object.assign(process.env, { NODE_ENV: 'test', SOCIAL_ACCOUNTS_DEV_AUTH: 'true', CRM_STORE: 'memory', PLATFORM_ADMIN_USER_IDS: 'root', APP_URL: 'https://crm.example.com' });
delete process.env.LIVEKIT_URL; delete process.env.LIVEKIT_API_KEY; delete process.env.LIVEKIT_API_SECRET;
delete process.env.GREET_INVITE_SECRET; delete process.env.JWT_SECRET; delete process.env.LIVEKIT_EGRESS_ENABLED;

const { MemoryDocStore, setDocStore } = await import('../../data/docStore');
const store = new MemoryDocStore(); setDocStore(store);
const { setRoomServiceForTests, setEgressServiceForTests } = await import('../../meetings/media');
const { guard, PUBLIC } = await import('../../routeGuards');
const meetings = (await import('../../../routes/meetings')).default;
const greet = (await import('../../../routes/greetApi')).default;
const admin = (await import('../../../routes/meetingAdminApi')).default;
const app = express(); app.use(express.json());
app.use('/api/meetings', guard(PUBLIC.none), meetings);
app.use('/api/greet', guard(PUBLIC.greet), greet);
app.use('/api/admin/meetings', guard(PUBLIC.none), admin);
const as = (uid: string) => ({
  get: (p: string) => request(app).get(p).set('X-Dev-User-Id', uid),
  post: (p: string, b: any = {}) => request(app).post(p).set('X-Dev-User-Id', uid).send(b),
  patch: (p: string, b: any = {}) => request(app).patch(p).set('X-Dev-User-Id', uid).send(b),
  put: (p: string, b: any = {}) => request(app).put(p).set('X-Dev-User-Id', uid).send(b),
  del: (p: string) => request(app).delete(p).set('X-Dev-User-Id', uid),
});
const anon = { get: (p: string, key?: string) => { const r = request(app).get(p); return key ? r.set('X-Greet-Guest-Key', key) : r; },
  post: (p: string, b: any = {}, key?: string) => { const r = request(app).post(p); return (key ? r.set('X-Greet-Guest-Key', key) : r).send(b); } };

const muted: string[] = [];
setRoomServiceForTests({
  async deleteRoom() {}, async removeParticipant() {},
  async getParticipant(_room, identity) { return { tracks: [{ sid: `TR_${identity}`, type: 0, muted: false }, { sid: `TV_${identity}`, type: 1 }] }; },
  async mutePublishedTrack(room, identity, sid, m) { muted.push(`${room}:${identity}:${sid}:${m}`); return {}; },
});

// Organizations: olivia owns A (premium), bea owns B; sam (SALES_REP) and mia (MANAGER) are in A.
await as('olivia').get('/api/meetings/subscription');
await as('bea').get('/api/meetings/subscription');
await as('root').get('/api/admin/meetings/me');
const orgA = (await store.get('crm_user_memberships/olivia')).defaultOrgId;
const orgB = (await store.get('crm_user_memberships/bea')).defaultOrgId;
await request(app).put(`/api/admin/meetings/subscriptions/${orgA}`).set('X-Dev-User-Id', 'root').send({ tier: 'enterprise' });
for (const [uid, role] of [['sam', 'SALES_REP'], ['mia', 'MANAGER']] as const) {
  await store.set(`organizations/${orgA}/members/${uid}`, { userId: uid, role, email: `${uid}@a.test`, name: uid, joinedAt: new Date().toISOString() });
  await store.set(`crm_user_memberships/${uid}`, { userId: uid, orgs: { [orgA]: role }, defaultOrgId: orgA });
}
await store.set(`organizations/${orgA}/leads/lead_a1`, { id: 'lead_a1', name: 'Avery Lee', company: 'Northwind', status: 'new', createdAt: new Date().toISOString() });
await store.set(`organizations/${orgB}/leads/lead_b1`, { id: 'lead_b1', name: 'Other tenant lead', status: 'new', createdAt: new Date().toISOString() });
const future = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
const base = { title: 'Proposal review', date: future, time: '15:00', duration: 45, guests: ['guest@client.test'] };

// ---- Scheduling ----
let r = await as('olivia').post('/api/meetings/create', { ...base, inviteeIds: ['sam'], associations: { leadId: 'lead_a1' } });
assert.equal(r.status, 201, JSON.stringify(r.body));
const m1 = r.body.meeting;
assert.equal(m1.status, 'SCHEDULED'); assert.equal(m1.hostId, 'olivia'); assert.equal(m1.invitees[0].userId, 'sam');
assert.equal(m1.associations.leadId, 'lead_a1'); assert.match(m1.associations.label, /Avery Lee/);
assert.doesNotMatch(JSON.stringify(m1), /secret|token/i);
const leadActs = await store.list(`organizations/${orgA}/leads/lead_a1/activities`);
assert.ok(leadActs.some((a: any) => a.type === 'meeting_scheduled'));
ok('schedules a GREET meeting linked to a lead, with an internal invitee; logged on the lead\'s timeline');

assert.equal((await as('olivia').post('/api/meetings/create', { ...base, associations: { leadId: 'lead_b1' } })).body.code, 'invalid_association');
assert.equal((await as('olivia').post('/api/meetings/create', { ...base, inviteeIds: ['bea'] })).body.code, 'invalid_invitee');
assert.equal((await as('olivia').post('/api/meetings/create', { ...base, associations: { dealId: 'nope' } })).status, 400);
ok('refuses another organization\'s lead, a non-member invitee and unknown deals');

// ---- Hub ----
let hub = (await as('sam').get('/api/meetings/hub')).body;
assert.equal(hub.invitations.length, 1); assert.equal(hub.invitations[0].id, m1.id); assert.equal(hub.invitations[0].yourRole, 'invitee');
hub = (await as('olivia').get('/api/meetings/hub')).body;
assert.equal(hub.upcoming[0].id, m1.id); assert.equal(hub.invitations.length, 0);
hub = (await as('mia').get('/api/meetings/hub')).body;
assert.equal(hub.upcoming.length, 0);
assert.equal((await as('bea').get('/api/meetings/hub')).body.upcoming.length, 0);
assert.equal((await request(app).get('/api/meetings/hub')).status, 401);
ok('hub: the host sees it as upcoming, the invitee as an invitation; colleagues, other tenants and anonymous users don\'t');

// ---- Reschedule / edit / cancel permissions ----
const later = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
assert.equal((await as('sam').patch(`/api/meetings/${m1.id}`, { date: later })).status, 403);
assert.equal((await as('bea').patch(`/api/meetings/${m1.id}`, { date: later })).status, 404);
r = await as('olivia').patch(`/api/meetings/${m1.id}`, { date: later, time: '10:30' });
assert.equal(r.status, 200); assert.equal(r.body.meeting.date, later); assert.match(r.body.meeting.startTime, new RegExp(`^${later}T10:30`));
r = await as('mia').patch(`/api/meetings/${m1.id}`, { title: 'Proposal review (v2)' });
assert.equal(r.status, 200); assert.equal(r.body.meeting.title, 'Proposal review (v2)');
assert.equal((await as('olivia').patch(`/api/meetings/${m1.id}`, { duration: 5000 })).body.code, 'duration_exceeds_plan');
assert.equal((await as('bea').get(`/api/meetings/${m1.id}`)).status, 404);
ok('reschedule/edit: host and managers only; other tenants get 404; durations beyond limits refused');

const m2 = (await as('olivia').post('/api/meetings/create', { ...base, title: 'To cancel' })).body.meeting;
assert.equal((await as('sam').post(`/api/meetings/${m2.id}/cancel`)).status, 403);
r = await as('olivia').post(`/api/meetings/${m2.id}/cancel`, { reason: 'Client asked to move it' });
assert.equal(r.body.meeting.status, 'CANCELLED');
r = await as('olivia').post('/api/meetings/sessions', { scheduledMeetingId: m2.id });
assert.equal(r.status, 409); assert.equal(r.body.code, 'meeting_cancelled');
ok('cancel: host only for a sales rep; a cancelled meeting can\'t be started');

// ---- Invitations (guest links) ----
r = await as('olivia').post(`/api/meetings/${m1.id}/invites`);
assert.equal(r.status, 503); assert.equal(r.body.code, 'invites_not_configured');
process.env.GREET_INVITE_SECRET = 'test-invite-secret-0123456789abcdef';
r = await as('olivia').post(`/api/meetings/${m1.id}/invites`);
assert.equal(r.status, 201, JSON.stringify(r.body)); assert.equal(r.body.invites.length, 1);
const link = new URL(r.body.invites[0].link); const token = link.searchParams.get('greet_invite')!;
assert.equal(link.origin, 'https://crm.example.com');
assert.equal((await as('sam').post(`/api/meetings/${m1.id}/invites`)).status, 403);
const detail = (await as('olivia').get(`/api/meetings/${m1.id}`)).body;
assert.equal(detail.invites.length, 1); assert.doesNotMatch(JSON.stringify(detail), new RegExp(token.split('.')[1]));
ok('invitation links: need a server secret; host only; the token is never stored or listed');

r = await anon.get(`/api/greet/invite/${token}`);
assert.equal(r.status, 200); assert.equal(r.body.meeting.title, 'Proposal review (v2)'); assert.equal(r.body.meeting.live, false);
assert.equal((await anon.get(`/api/greet/invite/${token.slice(0, -2)}xx`)).status, 404);
const [p, sig] = token.split('.');
const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, 'base64url').toString()), o: orgB })).toString('base64url');
assert.equal((await anon.get(`/api/greet/invite/${forged}.${sig}`)).status, 404);
assert.equal((await anon.post(`/api/greet/invite/${token}/join`, { name: 'Gail Guest' })).body.code, 'meeting_not_started');
ok('the public invite page shows the meeting; tampered or forged tokens are refused; joining before it starts is refused');

// ---- Lifecycle: start from the schedule → LIVE ----
r = await as('olivia').post('/api/meetings/sessions', { scheduledMeetingId: m1.id });
assert.equal(r.status, 201); const s1 = r.body.session;
assert.equal(s1.roomCode, m1.roomCode); assert.equal(s1.title, 'Proposal review (v2)'); assert.equal(s1.scheduledMeetingId, m1.id);
let got = (await as('olivia').get(`/api/meetings/${m1.id}`)).body.meeting;
assert.equal(got.status, 'LIVE'); assert.ok(got.actualStart);
assert.equal((await as('bea').post('/api/meetings/sessions', { scheduledMeetingId: m1.id })).status, 404);
ok('starting from the schedule uses its room code and title and marks it LIVE; another tenant can\'t start it');

// ---- Guest joins → waiting room → admitted → token ----
r = await anon.post(`/api/greet/invite/${token}/join`, { name: 'Gail Guest' });
assert.equal(r.status, 200); const guestKey = r.body.guestKey; assert.equal(r.body.session.you.status, 'waiting');
assert.equal((await anon.post(`/api/greet/invite/${token}/media-token`, {}, guestKey)).body.code, 'not_admitted');
assert.equal((await anon.post(`/api/greet/invite/${token}/media-token`, {})).status, 401);
assert.equal((await anon.post(`/api/greet/invite/${token}/media-token`, {}, 'x'.repeat(32))).body.code, 'not_a_participant');
let sv = (await as('olivia').get(`/api/meetings/sessions/${s1.id}`)).body.session;
const guestP = sv.participants.find((x: any) => x.external);
assert.ok(guestP && guestP.status === 'waiting');
assert.equal((await as('olivia').post(`/api/meetings/sessions/${s1.id}/admit`, { participantIds: [guestP.id] })).body.admitted[0], guestP.id);
assert.equal((await anon.post(`/api/greet/invite/${token}/media-token`, {}, guestKey)).body.code, 'media_not_configured');
Object.assign(process.env, { LIVEKIT_URL: 'wss://media.example.com', LIVEKIT_API_KEY: 'APItestkey', LIVEKIT_API_SECRET: 'test-secret-that-is-long-enough-123456' });
const verifier = new TokenVerifier('APItestkey', 'test-secret-that-is-long-enough-123456');
r = await anon.post(`/api/greet/invite/${token}/media-token`, {}, guestKey);
assert.equal(r.status, 200);
const claims: any = await verifier.verify(r.body.token);
assert.equal(claims.sub, guestP.id); assert.equal(claims.video.room, s1.id); assert.equal(claims.video.roomAdmin, false);
assert.ok(claims.exp * 1000 <= sv.endsAt + 61_000);
ok('guest: waiting room until the host admits; then a participant-specific, room-scoped, expiring token without admin rights');

// Token security for signed-in users
assert.equal((await as('sam').post(`/api/meetings/sessions/${s1.id}/media-token`)).body.code, 'not_a_participant');
assert.equal((await as('bea').post(`/api/meetings/sessions/${s1.id}/media-token`)).status, 404);
assert.equal((await request(app).post(`/api/meetings/sessions/${s1.id}/media-token`)).status, 401);
const hostTok: any = await verifier.verify((await as('olivia').post(`/api/meetings/sessions/${s1.id}/media-token`)).body.token);
assert.equal(hostTok.video.roomAdmin, true); assert.equal(hostTok.video.room, s1.id);
const audit = await store.list(`organizations/${orgA}/audit_log`);
assert.ok(audit.some((x: any) => x.action === 'greet.media_token.issued' && x.actorId === 'olivia'));
assert.ok(audit.some((x: any) => x.action === 'greet.media_token.issued' && String(x.actorId).startsWith('guest:')));
assert.doesNotMatch(JSON.stringify(audit), /eyJ/);
ok('token security: colleagues not in the meeting, other tenants and anonymous callers get nothing; issuance is audited without the token');

// ---- Host mute ----
assert.equal((await as('sam').post(`/api/meetings/sessions/${s1.id}/participants/${guestP.id}/mute`)).status, 403);
r = await as('olivia').post(`/api/meetings/sessions/${s1.id}/participants/${guestP.id}/mute`);
assert.equal(r.status, 200); assert.equal(r.body.results[guestP.id], 'muted');
assert.deepEqual(muted, [`${s1.id}:${guestP.id}:TR_${guestP.id}:true`]);
ok('host mute goes through LiveKit\'s server API (audio track only); non-hosts are refused');

// ---- Recording: consent first ----
r = await as('olivia').post(`/api/meetings/sessions/${s1.id}/recording`, { action: 'start' });
assert.equal(r.status, 409); assert.equal(r.body.code, 'consent_pending');
await as('olivia').post(`/api/meetings/sessions/${s1.id}/recording`, { action: 'request' });
r = await as('olivia').post(`/api/meetings/sessions/${s1.id}/recording`, { action: 'start' });
assert.equal(r.body.code, 'consent_pending'); assert.equal(r.body.waitingFor[0].id, guestP.id);
r = await anon.get(`/api/greet/invite/${token}/session`, guestKey);
assert.equal(r.body.session.recording.requested, true);
await anon.post(`/api/greet/invite/${token}/recording-consent`, { consent: true }, guestKey);
r = await as('olivia').post(`/api/meetings/sessions/${s1.id}/recording`, { action: 'start', target: 'cloud' });
assert.equal(r.status, 501); assert.equal(r.body.code, 'recording_not_configured');
r = await as('olivia').post(`/api/meetings/sessions/${s1.id}/recording`, { action: 'start' });
assert.equal(r.status, 200); assert.equal(r.body.session.recording.active, true); assert.equal(r.body.session.recording.mode, 'device');
await as('olivia').post(`/api/meetings/sessions/${s1.id}/recording`, { action: 'stop' });
ok('recording needs everyone\'s consent (guests included); cloud says 501 when not set up; otherwise the host records on their device');

// Cloud recording when configured and turned on by an admin
const egress: string[] = [];
setEgressServiceForTests({ async start(room, filepath) { egress.push(`start:${room}:${filepath}`); return { egressId: 'EG_1' }; }, async stop(id) { egress.push(`stop:${id}`); } });
assert.equal((await as('sam').put('/api/greet/settings', { recordingEnabled: true })).status, 403);
assert.equal((await as('olivia').put('/api/greet/settings', { recordingEnabled: true, recordingRetentionDays: 14 })).status, 200);
await as('olivia').post(`/api/meetings/sessions/${s1.id}/recording`, { action: 'request' });
await anon.post(`/api/greet/invite/${token}/recording-consent`, { consent: true }, guestKey);
r = await as('olivia').post(`/api/meetings/sessions/${s1.id}/recording`, { action: 'start' });
assert.equal(r.body.session.recording.mode, 'cloud');
assert.match(egress[0], new RegExp(`^start:${s1.id}:greet-recordings/${orgA}/${s1.id}/rec_`));
let recs = (await as('olivia').get('/api/greet/recordings')).body.recordings;
assert.equal(recs.length, 1); assert.equal(recs[0].status, 'recording'); assert.equal(recs[0].retentionDays, 14); assert.equal(recs[0].consents.length, 2);
assert.equal((await as('sam').get('/api/greet/recordings')).body.recordings.length, 0);
assert.equal((await as('bea').get(`/api/greet/recordings/${recs[0].id}`)).status, 404);
assert.equal((await as('sam').del(`/api/greet/recordings/${recs[0].id}`)).status, 404);
assert.equal((await as('olivia').del(`/api/greet/recordings/${recs[0].id}`)).body.code, 'recording_active');
ok('cloud recording via LiveKit Egress when configured and enabled; only the host and admins can see or delete it');

// ---- End → ENDED with attendance; egress stopped ----
await as('olivia').post(`/api/meetings/sessions/${s1.id}/end`);
assert.ok(egress.includes('stop:EG_1'));
got = (await as('olivia').get(`/api/meetings/${m1.id}`)).body.meeting;
assert.equal(got.status, 'ENDED'); assert.ok(got.actualEnd);
assert.ok(got.participants.some((x: any) => x.name === 'Gail Guest'));
recs = (await as('olivia').get('/api/greet/recordings')).body.recordings;
assert.equal(recs[0].status, 'processing');
r = await as('olivia').get(`/api/greet/recordings/${recs[0].id}`);
assert.equal(r.body.downloadUrl, null);
r = await as('olivia').del(`/api/greet/recordings/${recs[0].id}`);
assert.equal(r.status, 200);
// Storage isn't configured in this test, so the file can't be removed yet: it's marked for deletion (retried by the retention sweeper).
assert.equal(r.body.fileDeleted, false); assert.equal((await as('olivia').get('/api/greet/recordings')).body.recordings[0].status, 'deletion_pending');
const actions = (await as('olivia').get('/api/greet/audit')).body.entries.map((e: any) => e.action);
for (const a of ['greet.recording.started', 'greet.recording.stopped', 'greet.recording.viewed', 'greet.recording.deleted', 'greet.recording.consent_given', 'greet.settings.updated', 'greet.invites.created'])
  assert.ok(actions.includes(a), a);
assert.equal((await as('sam').get('/api/greet/audit')).status, 403);
ok('ending marks the meeting ENDED with attendance and stops cloud recording; access and deletion are audited (admins read the log)');

hub = (await as('olivia').get('/api/meetings/hub')).body;
assert.ok(hub.history.some((h: any) => h.id === s1.id && h.scheduledMeetingId === m1.id && h.associations.leadId === 'lead_a1'));
assert.ok(!hub.upcoming.some((u: any) => u.id === m1.id));
ok('hub history lists the held meeting with its CRM link');

// ---- Outcome ----
assert.equal((await as('mia').post(`/api/meetings/${m1.id}/outcome`, { result: 'won', summary: 'Signed' })).status, 200);
assert.equal((await as('bea').post(`/api/meetings/${m1.id}/outcome`, { result: 'won' })).status, 404);
assert.equal((await as('olivia').post(`/api/meetings/${m1.id}/outcome`, { result: 'nope' })).status, 400);
assert.ok((await store.list(`organizations/${orgA}/leads/lead_a1/activities`)).some((a: any) => a.type === 'meeting_outcome'));
ok('meeting outcome is recorded and logged on the linked lead');

// ---- Revoked invitation ----
const inviteId = detail.invites[0].id;
await as('olivia').del(`/api/meetings/${m1.id}/invites/${inviteId}`);
assert.equal((await anon.get(`/api/greet/invite/${token}`)).status, 410);
ok('a withdrawn invitation stops working immediately');

// ---- History import (browser → server) ----
const recs2 = [{ id: 'local-1', title: 'Old call', startedAt: Date.now() - 86_400_000, durationSeconds: 600, participants: ['Kim'] }];
assert.equal((await as('olivia').post('/api/meetings/history/import', { records: recs2 })).body.imported, 1);
assert.equal((await as('olivia').post('/api/meetings/history/import', { records: recs2 })).body.imported, 0);
hub = (await as('olivia').get('/api/meetings/hub')).body;
assert.ok(hub.history.some((h: any) => h.source === 'imported' && h.title === 'Old call' && h.minutes === 10));
assert.ok(!(await as('mia').get('/api/meetings/hub')).body.history.some((h: any) => h.source === 'imported'));
ok('browser meeting history imports once and stays private to its owner');

// ---- Webhook signature ----
assert.equal((await request(app).post('/api/greet/livekit-webhook').set('Content-Type', 'application/webhook+json').send('{}')).status, 401);
ok('the LiveKit webhook rejects unsigned calls');

console.log(`\nGREET: ${passed} checks passed`);
process.exit(0);
