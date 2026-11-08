/**
 * MeetingSessionContext: raise hand, waiting room, capacity and host participant controls.
 * Mounts the real provider in happy-dom and drives it through useMeetingSession().
 * Run: npx tsx src/context/__tests__/meetingSession.test.tsx
 */
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';

const win = new Window({ url: 'http://localhost/', width: 1280, height: 800 });
const g = globalThis as any;
for (const [k, v] of Object.entries({
  window: win, document: win.document, navigator: win.navigator, HTMLElement: win.HTMLElement, Node: win.Node, Element: win.Element,
  Event: win.Event, localStorage: win.localStorage, getComputedStyle: win.getComputedStyle.bind(win),
  requestAnimationFrame: (cb: any) => setTimeout(() => cb(Date.now()), 0), cancelAnimationFrame: (id: any) => clearTimeout(id),
})) Object.defineProperty(g, k, { value: v, configurable: true, writable: true });
g.IS_REACT_ACT_ENVIRONMENT = true;
console.warn = () => {}; // the provider logs a note when there is no camera (expected here)

// Stand-in for the organization's plan endpoint (GET/PUT /api/meetings/plan).
let serverPlan = 'standard'; let canChange = true;
g.fetch = async (url: string, init?: any) => {
  const json = (status: number, body: any) => new (win as any).Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  if (String(url).endsWith('/api/meetings/plan')) {
    if ((init?.method || 'GET') === 'PUT') {
      if (!canChange) return json(403, { success: false, error: 'Only an owner or admin can do this.' });
      serverPlan = JSON.parse(init.body).plan; return json(200, { success: true, plan: serverPlan, canChange });
    }
    return json(200, { success: true, plan: serverPlan, canChange });
  }
  return json(404, { success: false });
};

const React = (await import('react')).default;
const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { MeetingSessionProvider, useMeetingSession } = await import('../MeetingSessionContext');

let passed = 0; const ok = (n: string) => { passed++; console.log('  ✓', n); };

let api: ReturnType<typeof useMeetingSession>;
function Probe() { api = useMeetingSession(); return null; }
const host = document.createElement('div'); document.body.appendChild(host);
const root = createRoot(host as any);
await act(async () => { root.render(React.createElement(MeetingSessionProvider, null, React.createElement(Probe))); });
const run = async <T,>(fn: () => T | Promise<T>): Promise<T> => { let out!: T; await act(async () => { out = await fn(); }); return out; };

await run(() => api.startInstantMeeting('room-test'));
assert.ok(api.activeMeeting); const startCount = api.activeMeeting!.participants.length;
ok('meeting starts');

// ---- Raise hand ----
assert.equal(api.isHandRaised, false);
await run(() => api.toggleRaiseHand()); assert.equal(api.isHandRaised, true);
await run(() => api.lowerAllHands()); assert.equal(api.isHandRaised, false);
ok('raise hand toggles; host "lower all hands" also lowers your own');

// ---- Waiting room off: invite joins directly ----
await run(() => api.setWaitingRoomEnabled(false));
let r = await run(() => api.inviteParticipantByEmail('ada.lovelace@example.com'));
assert.ok(r.success); assert.equal(api.activeMeeting!.participants.length, startCount + 1); assert.equal(api.waitingRoom.length, 0);
ok('waiting room off: invited guest joins directly');

// ---- Waiting room on: invite waits; admit / deny ----
await run(() => api.setWaitingRoomEnabled(true));
assert.equal(localStorage.getItem('obsidian_meeting_waiting_room'), 'on'); ok('waiting room setting is remembered');
await run(() => api.inviteParticipantByEmail('grace@example.com'));
await run(() => api.inviteParticipantByEmail('linus@example.com'));
await run(() => api.inviteParticipantByEmail('margaret@example.com'));
assert.equal(api.waitingRoom.length, 3); assert.equal(api.activeMeeting!.participants.length, startCount + 1);
ok('waiting room on: invited guests wait instead of joining');
const grace = api.waitingRoom.find((p) => p.email === 'grace@example.com')!;
r = await run(() => api.admitParticipant(grace.id));
assert.ok(r.success); assert.ok(api.activeMeeting!.participants.some((p) => p.id === grace.id)); assert.equal(api.waitingRoom.length, 2);
ok('admit moves a guest into the meeting');
const linus = api.waitingRoom.find((p) => p.email === 'linus@example.com')!;
await run(() => api.denyParticipant(linus.id));
assert.equal(api.waitingRoom.length, 1); assert.ok(!api.activeMeeting!.participants.some((p) => p.id === linus.id));
ok('deny removes a guest from the waiting room without admitting them');
r = await run(() => api.admitParticipant('nobody'));
assert.equal(r.success, false); ok('admitting someone who already left fails gracefully');
r = await run(() => api.admitAllWaiting());
assert.ok(r.success); assert.equal(api.waitingRoom.length, 0); ok('admit all empties the waiting room');

// ---- Host participant controls ----
const target = api.activeMeeting!.participants.find((p) => p.email === 'grace@example.com')!;
assert.equal(target.isMuted, false);
await run(() => api.muteParticipant(target.id));
assert.equal(api.activeMeeting!.participants.find((p) => p.id === target.id)!.isMuted, true); ok('host can mute one participant');
await run(() => api.muteAllParticipants());
assert.ok(api.activeMeeting!.participants.every((p) => p.isMuted)); ok('mute everyone mutes every other participant');
const before = api.activeMeeting!.participants.length;
await run(() => api.removeParticipant(target.id));
assert.equal(api.activeMeeting!.participants.length, before - 1); ok('host can remove a participant');

// ---- Leaving resets per-meeting state ----
await run(() => api.toggleRaiseHand());
await run(async () => { await api.leaveMeeting(); await new Promise((res) => setTimeout(res, 450)); });
assert.equal(api.isHandRaised, false); assert.equal(api.waitingRoom.length, 0); assert.equal(api.activeMeeting, null);
ok('leaving clears the raised hand and waiting room');

// ---- Plans: organization plan, 100-person Standard cap, locked limits, 60-minute limit ----
assert.equal(api.planSource, 'organization'); assert.equal(api.currentPlanTier, 'standard'); assert.equal(api.canChangePlan, true);
ok('the plan is loaded from the organization (Standard)');

await run(() => api.setWaitingRoomEnabled(false));
await run(() => api.startInstantMeeting('room-big'));
assert.equal(api.meetingLimits.maxParticipants, 100);
for (let i = api.activeMeeting!.participants.length + 1; i < 100; i++) {
  const res = await run(() => api.inviteParticipantByEmail(`guest${i}@example.com`));
  assert.ok(res.success, res.message);
}
assert.equal(api.activeMeeting!.participants.length + 1, 100); ok('a Standard meeting holds 100 people (host included)');
r = await run(() => api.inviteParticipantByEmail('one-too-many@example.com'));
assert.equal(r.success, false); assert.match(r.message, /full.*Standard.*100.*Premium allows 250/);
assert.equal(api.activeMeeting!.participants.length + 1, 100); ok('the 101st person is refused, with which plan fits');

await run(() => api.setWaitingRoomEnabled(true));
r = await run(() => api.inviteParticipantByEmail('waits@example.com'));
assert.ok(r.success); assert.equal(api.waitingRoom.length, 1);
r = await run(() => api.admitParticipant(api.waitingRoom[0].id));
assert.equal(r.success, false); assert.equal(api.waitingRoom.length, 1); ok('a full room keeps people in the waiting room');
const someone = api.activeMeeting!.participants[0].id;
await run(() => api.removeParticipant(someone));
r = await run(() => api.admitParticipant(api.waitingRoom[0].id));
assert.ok(r.success); assert.equal(api.activeMeeting!.participants.length + 1, 100); ok('when a seat frees up, the next person can be admitted');

r = await run(() => api.changeMeetingPlan('premium'));
assert.ok(r.success); assert.equal(api.currentPlanTier, 'premium');
assert.equal(api.meetingLimits.maxParticipants, 100); assert.equal(api.meetingLimits.maxDurationMinutes, 60);
ok('changing the plan mid-meeting keeps this meeting\'s limits');
await run(async () => { await api.leaveMeeting(); await new Promise((res) => setTimeout(res, 450)); });

await run(() => api.startInstantMeeting('room-premium'));
assert.equal(api.meetingLimits.maxParticipants, 250); assert.equal(api.durationSecondsLeft, null);
ok('the next meeting uses Premium: 250 people, no time limit');
const realNow = Date.now;
Date.now = () => realNow() + 3 * 3600 * 1000;
await run(() => new Promise((res) => setTimeout(res, 1200)));
assert.equal(api.activeMeeting!.status, 'active'); ok('a Premium meeting keeps going past 60 minutes');
Date.now = realNow;
await run(async () => { await api.leaveMeeting(); await new Promise((res) => setTimeout(res, 450)); });

await run(() => api.changeMeetingPlan('standard'));
await run(() => api.startInstantMeeting('room-timed'));
Date.now = () => realNow() + 56 * 60 * 1000;
await run(() => new Promise((res) => setTimeout(res, 1200)));
assert.equal(api.isDurationWarning, true); assert.ok(api.durationSecondsLeft! > 200 && api.durationSecondsLeft! <= 240);
assert.equal(api.activeMeeting!.status, 'active'); ok('Standard: at 56 minutes the warning shows about 4 minutes left');
Date.now = () => realNow() + 60 * 60 * 1000 + 500;
await run(() => new Promise((res) => setTimeout(res, 1500)));
assert.equal(api.isDurationLimitReached, true);
assert.equal(api.activeMeeting!.status, 'ended'); assert.equal(api.activeMeeting!.endedReason, 'time_limit');
assert.equal(api.isHandRaised, false); ok('Standard: at 60 minutes the meeting ends for everyone (reason recorded)');
Date.now = realNow;

canChange = false;
r = await run(() => api.changeMeetingPlan('enterprise'));
assert.equal(r.success, false); assert.equal(api.currentPlanTier, 'standard'); ok('a refused plan change leaves the plan as it was');

// ---- Batch invites can't overfill the room ----
await run(async () => { await api.leaveMeeting(); await new Promise((res) => setTimeout(res, 450)); });
await run(() => api.setWaitingRoomEnabled(false));
await run(() => api.startInstantMeeting('room-batch'));
assert.equal(api.meetingLimits.maxParticipants, 100);
const batch = Array.from({ length: 150 }, (_, i) => `b${i}@example.com`);
const br = await run(() => api.inviteParticipantsByEmail([...batch, 'b0@example.com', 'not-an-email']));
assert.equal(br.added.length, 99); assert.equal(api.activeMeeting!.participants.length + 1, 100);
assert.equal(br.refused.filter((x) => x.reason === 'full').length, 51);
assert.equal(br.refused.find((x) => x.email === 'b0@example.com')?.reason, 'duplicate');
assert.equal(br.refused.find((x) => x.email === 'not-an-email')?.reason, 'invalid');
ok('inviting 150 at once into a Standard meeting seats 99 + host; the other 51 are listed as not added');
await run(() => api.removeParticipant(api.activeMeeting!.participants[0].id));
await run(async () => { await Promise.all(['x1@example.com', 'x2@example.com', 'x3@example.com'].map((e) => api.inviteParticipantByEmail(e))); });
assert.equal(api.activeMeeting!.participants.length + 1, 100); ok('simultaneous invites still stop at 100');

console.log(`\n${passed} passed (meeting session)`);
process.exit(0);
