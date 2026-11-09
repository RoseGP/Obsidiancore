/**
 * MeetingSessionContext end to end: the real provider (happy-dom) talking to the real /api/meetings and
 * /api/admin/meetings routes (in-process, through supertest), so client and server stay in sync.
 * Also: raise hand, the sandbox offline preview, and that production builds refuse to start without a server.
 * Run: npx tsx src/context/__tests__/meetingSession.test.tsx
 */
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import express from 'express';
import request from 'supertest';

Object.assign(process.env, { NODE_ENV: 'test', SOCIAL_ACCOUNTS_DEV_AUTH: 'true', CRM_STORE: 'memory', PLATFORM_ADMIN_USER_IDS: 'root' });
const win = new Window({ url: 'http://localhost/', width: 1280, height: 800 });
const g = globalThis as any;
for (const [k, v] of Object.entries({
  window: win, document: win.document, navigator: win.navigator, HTMLElement: win.HTMLElement, Node: win.Node, Element: win.Element,
  Event: win.Event, localStorage: win.localStorage, getComputedStyle: win.getComputedStyle.bind(win),
  requestAnimationFrame: (cb: any) => setTimeout(() => cb(Date.now()), 0), cancelAnimationFrame: (id: any) => clearTimeout(id),
})) Object.defineProperty(g, k, { value: v, configurable: true, writable: true });
g.IS_REACT_ACT_ENVIRONMENT = true;
console.warn = () => {}; // no camera here (expected)

// ---- The real API, in process ----
const { MemoryDocStore, setDocStore } = await import('../../server/data/docStore');
const store = new MemoryDocStore(); setDocStore(store);
const { guard, PUBLIC } = await import('../../server/routeGuards');
const meetingsRouter = (await import('../../routes/meetings')).default;
const adminRouter = (await import('../../routes/meetingAdminApi')).default;
const app = express(); app.use(express.json());
app.use('/api/meetings', guard(PUBLIC.none), meetingsRouter);
app.use('/api/admin/meetings', guard(PUBLIC.none), adminRouter);

let browserUser = 'olivia';
let serverDown = false;
g.fetch = async (url: string, init: any = {}) => {
  if (serverDown) throw new TypeError('Failed to fetch');
  const method = String(init.method || 'GET').toLowerCase();
  let r = (request(app) as any)[method](String(url)).set('X-Dev-User-Id', browserUser);
  if (init.body) r = r.set('Content-Type', 'application/json').send(JSON.parse(init.body));
  const res = await r;
  return new (win as any).Response(JSON.stringify(res.body), { status: res.status, headers: { 'Content-Type': 'application/json' } });
};
const asAdmin = (method: 'put' | 'post', path: string, body: any = {}) => (request(app) as any)[method](path).set('X-Dev-User-Id', 'root').send(body);

const React = (await import('react')).default;
const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { MeetingSessionProvider, useMeetingSession, setMeetingPreviewAllowedForTests } = await import('../MeetingSessionContext');

let passed = 0; const ok = (n: string) => { passed++; console.log('  ✓', n); };
let api: ReturnType<typeof useMeetingSession>;
function Probe() { api = useMeetingSession(); return null; }
const host = document.createElement('div'); document.body.appendChild(host);
const root = createRoot(host as any);
const run = async <T,>(fn: () => T | Promise<T>): Promise<T> => { let out!: T; await act(async () => { out = await fn(); }); return out; };
const wait = (ms: number) => run(() => new Promise((res) => setTimeout(res, ms)));

await act(async () => { root.render(React.createElement(MeetingSessionProvider, null, React.createElement(Probe))); });
await wait(50);
const orgA = (await store.get('crm_user_memberships/olivia')).defaultOrgId;

// ---- Plan comes from the server ----
assert.equal(api.subscription?.tier, 'free'); assert.equal(api.subscription?.plans.premium.limits.maxParticipants, 250);
assert.equal(api.meetingLimits.maxParticipants, 100); assert.equal(api.meetingFeatures.recording, false);
ok('the organization\'s plan and the plan catalog are loaded from the server (Free)');

// ---- Start: server session, server clock ----
let r = await run(() => api.startInstantMeeting('Team Sync', undefined, 'Team sync'));
assert.ok(r.success); assert.ok(api.serverSession); assert.equal(api.offlinePreview, false);
assert.equal(api.activeMeeting!.id, api.serverSession!.id); assert.equal(api.activeMeeting!.roomId, 'team-sync');
assert.ok(api.durationSecondsLeft > 3590 && api.durationSecondsLeft <= 3600); assert.equal(api.roomCount, 1);
assert.equal(api.activeMeeting!.tasks.length, 0); assert.doesNotMatch(api.activeMeeting!.notes, /Marcus|Sarah/);
ok('starting a meeting creates it on the server: Free limits, countdown from the server clock, no invented notes or tasks');

// ---- Nothing simulated ----
await wait(100);
assert.equal(api.mediaStatus, 'not_configured'); assert.match(api.mediaMessage!, /LiveKit/);
ok('without a media server the meeting says video isn\'t connected (no simulated people)');
const before = api.activeMeeting!.messages.length;
await run(() => api.sendChatMessage('hello, what is our SLA?'));
await wait(1700);
assert.equal(api.activeMeeting!.messages.length, before + 1);
assert.equal(api.activeMeeting!.messages.at(-1)!.isYou, true); assert.doesNotMatch(JSON.stringify(api.activeMeeting!.messages), /Marcus|Sarah|Camelia/);
assert.equal(api.meetingHistory.length, 0);
ok('chat gets no scripted replies; history starts empty; no invented names');

// ---- Raise hand (local) ----
await run(() => api.toggleRaiseHand()); assert.equal(api.isHandRaised, true);
await run(() => api.lowerAllHands()); assert.equal(api.isHandRaised, false); ok('raise hand and lower all hands');

// ---- Capacity enforced by the server ----
const emails = Array.from({ length: 150 }, (_, i) => `g${i}@example.com`);
const inv = await run(() => api.inviteParticipantsByEmail(emails));
assert.equal(inv.added.length, 99); assert.equal(inv.refused.filter((x) => x.reason === 'full').length, 51);
assert.equal(api.roomCount, 100); assert.equal(api.capacityState, 'full'); assert.equal(api.serverSession!.participantCount, 100);
assert.equal(api.planNotice?.kind, 'capacity'); assert.equal(api.planNotice?.upgradeTo, 'premium');
assert.match(inv.message, /99 people were added.*full.*Free plan allows 100.*Premium allows 250/);
ok('150 invited: the server seats 99 (100 with the host); the roster mirrors it and an upgrade notice is raised');
await run(() => api.clearPlanNotice());

// ---- Features the plan lacks are refused by the server ----
let w = await run(() => api.setWaitingRoomEnabled(true));
assert.equal(w.success, false); assert.equal(api.planNotice?.feature, 'waitingRoom'); assert.equal(api.planNotice?.upgradeTo, 'premium');
await run(() => api.clearPlanNotice());
assert.equal(await run(() => api.startRecording()), false); assert.equal(api.planNotice?.feature, 'recording'); assert.equal(api.isRecording, false);
await run(() => api.clearPlanNotice());
const someone = api.activeMeeting!.participants[0];
const rm = await run(() => api.removeParticipant(someone.id));
assert.equal(rm.success, false); assert.equal(api.planNotice?.feature, 'hostControls'); assert.equal(api.roomCount, 100);
await run(() => api.clearPlanNotice());
ok('Free: waiting room, recording and removing people are refused by the server, each with the plan that includes it');

// ---- Another person joining a full meeting ----
browserUser = 'bea';
const otherHost = document.createElement('div'); document.body.appendChild(otherHost);
let api2: ReturnType<typeof useMeetingSession>;
function Probe2() { api2 = useMeetingSession(); return null; }
const root2 = createRoot(otherHost as any);
await act(async () => { root2.render(React.createElement(MeetingSessionProvider, null, React.createElement(Probe2))); });
await wait(30);
const j = await run(() => api2!.joinMeeting('https://crm.example.com/?view=greet&meet=team-sync'));
assert.equal(j.success, false); assert.match(j.message!, /full/); assert.equal(api2!.activeMeeting, null);
ok('joining a full meeting from an invitation link is refused, and nothing opens');
browserUser = 'olivia';

// ---- Upgrade during the meeting extends it ----
await asAdmin('put', `/api/admin/meetings/subscriptions/${orgA}`, { tier: 'premium', reason: 'upgrade' });
w = await run(() => api.setWaitingRoomEnabled(true));
assert.ok(w.success, w.message); assert.equal(api.isWaitingRoomEnabled, true);
assert.equal(api.meetingLimits.maxParticipants, 250); assert.equal(api.meetingTier, 'premium');
assert.ok(api.durationSecondsLeft > 290 * 60); assert.equal(api.capacityState, 'ok');
ok('after an upgrade, the running meeting gets Premium limits and features (waiting room, 250 people, 5 hours)');
const waitInv = await run(() => api.inviteParticipantsByEmail(['late1@example.com', 'late2@example.com']));
assert.equal(waitInv.waiting.length, 2); assert.equal(api.waitingRoom.length, 2);
const adm = await run(() => api.admitAllWaiting());
assert.ok(adm.success); assert.equal(api.waitingRoom.length, 0); assert.equal(api.roomCount, 102);
ok('waiting room on the server: invitees wait, Admit all brings them in');

// ---- Time limit: countdown on the server clock, meeting ends for everyone ----
await run(async () => { await api.endMeetingForEveryone(); await new Promise((res) => setTimeout(res, 450)); });
await asAdmin('put', `/api/admin/meetings/subscriptions/${orgA}`, { tier: 'free', reason: 'downgrade' });
await run(() => api.refreshSubscription());
r = await run(() => api.startInstantMeeting(undefined, undefined, 'Timed'));
assert.ok(r.success); assert.equal(api.meetingLimits.maxDurationMinutes, 60);
const realNow = Date.now;
Date.now = () => realNow() + 56 * 60_000;
await wait(1200);
assert.equal(api.isDurationWarning, true); assert.ok(api.durationSecondsLeft <= 240 && api.durationSecondsLeft > 200);
ok('at 56 minutes: 5-minute warning with about 4 minutes left');
Date.now = () => realNow() + 60 * 60_000 + 500;
await wait(1500);
assert.equal(api.activeMeeting!.status, 'ended'); assert.equal(api.activeMeeting!.endedReason, 'time_limit');
const serverView = await (request(app) as any).get(`/api/meetings/sessions/${api.serverSession!.id}`).set('X-Dev-User-Id', 'olivia');
assert.equal(serverView.body.session.status, 'ended'); assert.equal(serverView.body.session.endedReason, 'time_limit');
Date.now = realNow;
ok('at 60 minutes the meeting ends in the app and on the server, with the reason recorded');
await run(async () => { await api.leaveMeeting(); await new Promise((res) => setTimeout(res, 450)); });

// ---- Host leaving ends the meeting on the server ----
r = await run(() => api.startInstantMeeting(undefined, undefined, 'Short'));
const sid = api.serverSession!.id;
await run(async () => { await api.leaveMeeting(); await new Promise((res) => setTimeout(res, 450)); });
const after = await (request(app) as any).get(`/api/meetings/sessions/${sid}`).set('X-Dev-User-Id', 'olivia');
assert.equal(after.body.session.status, 'ended'); assert.equal(api.activeMeeting, null);
ok('when the host leaves (no co-host), the meeting ends on the server too');

// ---- No server ----
serverDown = true;
setMeetingPreviewAllowedForTests(false);
r = await run(() => api.startInstantMeeting(undefined, undefined, 'Offline'));
assert.equal(r.success, false); assert.match(r.message!, /Couldn't reach the server/); assert.equal(api.activeMeeting, null);
ok('production: without the server a meeting does not start (limits can\'t be bypassed)');
setMeetingPreviewAllowedForTests(true);
r = await run(() => api.startInstantMeeting(undefined, undefined, 'Preview'));
assert.ok(r.success); assert.equal(api.offlinePreview, true); assert.equal(api.meetingLimits.maxParticipants, 100);
assert.equal(await run(() => api.startRecording()), false); assert.equal(api.planNotice?.feature, 'recording');
ok('sandbox preview without a server: Free limits applied locally and labeled as a preview');
serverDown = false;

console.log(`\n${passed} passed (meeting session)`);
process.exit(0);
