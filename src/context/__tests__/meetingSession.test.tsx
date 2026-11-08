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

console.log(`\n${passed} passed (meeting session)`);
process.exit(0);
