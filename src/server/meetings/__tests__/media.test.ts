/**
 * LiveKit media rules: tokens only for admitted participants, scoped to the meeting's room and plan time limit;
 * the room closes when the meeting ends (incl. the time limit); removed people are removed from media.
 * Run: npx tsx src/server/meetings/__tests__/media.test.ts
 */
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { TokenVerifier } from 'livekit-server-sdk';

let passed = 0; const ok = (n: string) => { passed++; console.log('  ✓', n); };
Object.assign(process.env, { NODE_ENV: 'test', SOCIAL_ACCOUNTS_DEV_AUTH: 'true', CRM_STORE: 'memory', PLATFORM_ADMIN_USER_IDS: 'root' });
delete process.env.LIVEKIT_URL; delete process.env.LIVEKIT_API_KEY; delete process.env.LIVEKIT_API_SECRET;

const { MemoryDocStore, setDocStore } = await import('../../data/docStore');
const store = new MemoryDocStore(); setDocStore(store);
const { setRoomServiceForTests } = await import('../media');
const { guard, PUBLIC } = await import('../../routeGuards');
const meetings = (await import('../../../routes/meetings')).default;
const admin = (await import('../../../routes/meetingAdminApi')).default;
const app = express(); app.use(express.json());
app.use('/api/meetings', guard(PUBLIC.none), meetings);
app.use('/api/admin/meetings', guard(PUBLIC.none), admin);
const as = (uid: string) => ({
  get: (p: string) => request(app).get(p).set('X-Dev-User-Id', uid),
  post: (p: string, b: any = {}) => request(app).post(p).set('X-Dev-User-Id', uid).send(b),
  patch: (p: string, b: any = {}) => request(app).patch(p).set('X-Dev-User-Id', uid).send(b),
  del: (p: string) => request(app).delete(p).set('X-Dev-User-Id', uid),
});

const calls: string[] = [];
setRoomServiceForTests({
  async deleteRoom(room) { calls.push(`delete:${room}`); },
  async removeParticipant(room, identity) { calls.push(`remove:${room}:${identity}`); },
});

await as('olivia').get('/api/meetings/subscription');
await as('bea').get('/api/meetings/subscription');
await as('root').get('/api/admin/meetings/me');
const orgA = (await store.get('crm_user_memberships/olivia')).defaultOrgId;
await request(app).put(`/api/admin/meetings/subscriptions/${orgA}`).set('X-Dev-User-Id', 'root').send({ tier: 'premium' });

// ---- Not configured ----
let s = (await as('olivia').post('/api/meetings/sessions', { title: 'Sync', roomCode: 'media-1' })).body.session;
let r = await as('olivia').post(`/api/meetings/sessions/${s.id}/media-token`);
assert.equal(r.status, 503); assert.equal(r.body.code, 'media_not_configured'); assert.doesNotMatch(JSON.stringify(r.body), /secret/i);
ok('without LiveKit keys the server says media isn\'t configured (no fake connection)');

// ---- Configured ----
Object.assign(process.env, { LIVEKIT_URL: 'wss://media.example.com', LIVEKIT_API_KEY: 'APItestkey', LIVEKIT_API_SECRET: 'test-secret-that-is-long-enough-123456' });
const verifier = new TokenVerifier('APItestkey', 'test-secret-that-is-long-enough-123456');
r = await as('olivia').post(`/api/meetings/sessions/${s.id}/media-token`);
assert.equal(r.status, 200); assert.equal(r.body.url, 'wss://media.example.com');
let claims: any = await verifier.verify(r.body.token);
const hostPid = s.you.participantId;
assert.equal(claims.sub, hostPid); assert.equal(claims.video.room, s.id); assert.equal(claims.video.roomJoin, true); assert.equal(claims.video.roomAdmin, true);
assert.ok(claims.exp * 1000 <= s.endsAt + 61_000 && claims.exp * 1000 > Date.now());
ok('host token: signed for this meeting\'s room only, as the host\'s roster id, admin rights, expires at the plan limit');

// Waiting room: no token until admitted
await as('olivia').patch(`/api/meetings/sessions/${s.id}`, { waitingRoomEnabled: true });
const j = await as('bea').post('/api/meetings/rooms/media-1/join');
assert.equal(j.body.you.status, 'waiting');
r = await as('bea').post('/api/meetings/rooms/media-1/media-token');
assert.equal(r.status, 403); assert.equal(r.body.code, 'not_admitted');
ok('someone in the waiting room gets no media token');
await as('olivia').post(`/api/meetings/sessions/${s.id}/admit`, { all: true });
r = await as('bea').post('/api/meetings/rooms/media-1/media-token');
assert.equal(r.status, 200); claims = await verifier.verify(r.body.token);
assert.equal(claims.sub, j.body.you.participantId); assert.equal(claims.video.roomAdmin, false); assert.equal(claims.video.room, s.id);
ok('after admission: a token without admin rights, from the other organization by room code');
assert.equal((await as('bea').post(`/api/meetings/sessions/${s.id}/media-token`)).status, 404);
assert.equal((await request(app).post(`/api/meetings/sessions/${s.id}/media-token`)).status, 401);
await store.set(`organizations/${orgA}/members/sam`, { userId: 'sam', role: 'SALES_REP', email: '', name: 'sam', joinedAt: new Date().toISOString() });
await store.set('crm_user_memberships/sam', { userId: 'sam', orgs: { [orgA]: 'SALES_REP' }, defaultOrgId: orgA });
assert.equal((await as('sam').post(`/api/meetings/sessions/${s.id}/media-token`)).body.code, 'not_a_participant');
ok('no token by meeting id from another organization, without sign-in, or for a colleague who isn\'t in the meeting');

// Remove → removed from media and no new token
await as('olivia').del(`/api/meetings/sessions/${s.id}/participants/${j.body.you.participantId}`);
assert.ok(calls.includes(`remove:${s.id}:${j.body.you.participantId}`));
assert.equal((await as('bea').post('/api/meetings/rooms/media-1/media-token')).status, 404);
ok('removing someone removes them from the media room, and they can\'t get a new token');

// End → room closed
await as('olivia').post(`/api/meetings/sessions/${s.id}/end`);
assert.ok(calls.includes(`delete:${s.id}`));
assert.equal((await as('olivia').post(`/api/meetings/sessions/${s.id}/media-token`)).status, 409);
ok('ending the meeting closes the media room for everyone; no tokens afterwards');

// Time limit → room closed by the server (even with nobody polling)
await request(app).put(`/api/admin/meetings/subscriptions/${orgA}`).set('X-Dev-User-Id', 'root').send({ tier: 'free' });
s = (await as('olivia').post('/api/meetings/sessions', { title: 'Timed' })).body.session;
const { sweepExpiredMeetings } = await import('../sessions');
const realNow = Date.now; Date.now = () => realNow() + 61 * 60_000;
await sweepExpiredMeetings();
Date.now = realNow;
assert.ok(calls.includes(`delete:${s.id}`)); ok('at the plan time limit the server closes the media room (the limit applies to audio and video)');

// LiveKit outage doesn't block ending a meeting
setRoomServiceForTests({ async deleteRoom() { throw new Error('connect ECONNREFUSED'); }, async removeParticipant() { throw new Error('down'); } });
const warn = console.warn; console.warn = () => {};
s = (await as('olivia').post('/api/meetings/sessions', { title: 'Outage' })).body.session;
r = await as('olivia').post(`/api/meetings/sessions/${s.id}/end`);
console.warn = warn;
assert.equal(r.status, 200); assert.equal(r.body.session.status, 'ended'); ok('if LiveKit is unreachable, the meeting still ends');

console.log(`\n${passed} passed (meeting media)`);
process.exit(0);
