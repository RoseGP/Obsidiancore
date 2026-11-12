/**
 * Meeting room UI in happy-dom (React StrictMode): pre-join controls and permission states, joining,
 * participant tiles, the screen share stage, accessible control state, leaving and the disconnected screen.
 * Run: npx tsx src/features/meeting-room/__tests__/meetingRoomUi.test.tsx
 */
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';

const win = new Window({ url: 'https://crm.example.test/', width: 1280, height: 800 });
const g = globalThis as any;
for (const [k, v] of Object.entries({
  window: win, document: win.document, navigator: win.navigator, HTMLElement: win.HTMLElement, HTMLButtonElement: win.HTMLButtonElement,
  HTMLVideoElement: win.HTMLVideoElement, HTMLMediaElement: win.HTMLMediaElement, Node: win.Node, Element: win.Element, Event: win.Event,
  KeyboardEvent: win.KeyboardEvent, MouseEvent: win.MouseEvent, getComputedStyle: win.getComputedStyle.bind(win),
  requestAnimationFrame: (cb: any) => setTimeout(() => cb(Date.now()), 0), cancelAnimationFrame: (id: any) => clearTimeout(id),
})) Object.defineProperty(g, k, { value: v, configurable: true, writable: true });
g.IS_REACT_ACT_ENVIRONMENT = true;

const React = (await import('react')).default;
const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { default: MeetingRoom } = await import('../MeetingRoom');
const { resetMediaAnalyzerCache, loadMediaAnalyzer } = await import('../analysis/wasmAnalyzer');
const { setup, flush } = await import('./fakes');
const { DisconnectReason } = await import('livekit-client');

let passed = 0;
const ok = (n: string) => { passed++; console.log('  ✓', n); };

// No analysis module in this environment: the room must work without it.
resetMediaAnalyzerCache();
await loadMediaAnalyzer('/wasm/media_analysis.wasm', async () => new Response('', { status: 404 }));

const made: Array<ReturnType<typeof setup>> = [];
const factory = () => { const t = setup(); made.push(t); return t.c; };
const container = document.createElement('div');
document.body.appendChild(container);
const root = createRoot(container as any);
await act(async () => { root.render(React.createElement(React.StrictMode, null, React.createElement(MeetingRoom, { initialRoomCode: 'abc-defg-hij', controllerFactory: factory, onExit: () => {} }))); });
await act(async () => { await flush(); });

const q = (sel: string) => container.querySelector(sel) as HTMLElement | null;
const click = async (el: HTMLElement | null) => { assert.ok(el, 'element exists'); await act(async () => { el!.dispatchEvent(new win.MouseEvent('click', { bubbles: true }) as any); await flush(); }); };
const t = () => made[made.length - 1];

// StrictMode also calls the useState initializer twice (one result is discarded, never initialized) and
// runs the effect, its cleanup, and the effect again.
const liveOnes = made.filter((m) => m.env.deviceChangeListeners() > 0);
assert.equal(liveOnes.length, 1, 'exactly one controller holds listeners');
assert.equal(liveOnes[0], made[made.length - 1], 'and it is the one rendered');
assert.ok(made.some((m) => m.c.isDisposed), 'the StrictMode cleanup disposed the first one');
assert.ok(made.every((m) => m === liveOnes[0] || m.created.video.length + m.created.audio.length === 0), 'no other controller captured anything');
ok('StrictMode double mount leaves exactly one live controller and no leaked listeners');

assert.equal(q('#meeting-room')!.getAttribute('data-phase'), 'prejoin');
assert.equal((q('#meeting-room-code') as HTMLInputElement).value, 'abc-defg-hij');
const cam = q('#btn-camera')!, mic = q('#btn-mic')!;
assert.equal(cam.getAttribute('aria-label'), 'Turn on camera');
assert.equal(cam.getAttribute('aria-pressed'), 'false');
assert.equal(mic.getAttribute('aria-label'), 'Turn on microphone');
assert.match(container.textContent!, /Not asked yet/);
assert.match(container.textContent!, /Your camera is off/);
assert.equal(t().created.video.length, 0);
assert.equal(q('input[type="checkbox"]'), null, 'no quality check offered when the analysis module is unavailable');
ok('pre-join: labeled controls, permission state, code pre-filled, nothing captured yet');

await click(q('#btn-camera'));
assert.equal(q('#btn-camera')!.getAttribute('aria-pressed'), 'true');
assert.ok(q('video[aria-label^="Your camera preview"]'));
assert.match(container.textContent!, /Joining with camera on and microphone off/);
ok('camera on: preview shown, control pressed, join summary updated');

await click(q('button[type="submit"]'));
assert.equal(q('#meeting-room')!.getAttribute('data-phase'), 'connected');
const room = t().room();
await act(async () => {
  const bob = room.addRemote('pt_bob', 'Bob Stone');
  room.publishRemote(bob, 'camera', { width: 1280, height: 720 });
  room.publishRemote(bob, 'microphone');
  await flush();
});
const tiles = [...container.querySelectorAll('[data-participant]')].map((e) => e.getAttribute('data-participant'));
assert.deepEqual(tiles, ['pt_local', 'pt_bob']);
assert.match(q('[data-participant="pt_bob"]')!.getAttribute('aria-label')!, /Bob Stone, camera on, microphone on/);
assert.match(q('[data-participant="pt_local"]')!.getAttribute('aria-label')!, /\(you\), camera on, microphone off/);
assert.equal(container.querySelectorAll('audio').length, 1, 'remote audio is rendered; own microphone is not');
assert.ok(q('nav[aria-label="Meeting controls"]'));
ok('in the meeting: tiles keyed by identity with accessible state, remote audio, control bar');

await click(q('#btn-screen'));
assert.equal(q('#btn-screen')!.getAttribute('aria-pressed'), 'true');
assert.ok(q('section[aria-label="Your shared screen"]'));
await act(async () => { room.localParticipant.unpublishScreen(); await flush(); });
assert.equal(q('section[aria-label="Your shared screen"]'), null);
assert.match(container.textContent!, /You stopped sharing your screen/);
assert.equal(q('#btn-screen')!.getAttribute('aria-pressed'), 'false');
ok('screen share: stage shown; ending it from the browser removes the stage and resets the control');

await click(q('#btn-mic'));
assert.equal(q('#btn-mic')!.getAttribute('aria-label'), 'Turn off microphone');
await click(q('#btn-leave'));
assert.equal(q('#meeting-room')!.getAttribute('data-phase'), 'prejoin');
assert.match(container.textContent!, /You left the meeting/);
assert.equal(q('#btn-camera')!.getAttribute('aria-pressed'), 'false');
assert.deepEqual(room.disconnects, [true]);
ok('leave returns to pre-join with everything off');

await click(q('button[type="submit"]'));
await act(async () => { t().room().emit('disconnected', DisconnectReason.PARTICIPANT_REMOVED); await flush(); });
assert.equal(q('#meeting-room')!.getAttribute('data-phase'), 'disconnected');
assert.match(container.textContent!, /The host removed you from the meeting/);
const rejoin = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('Rejoin')) as HTMLElement;
await click(rejoin);
assert.equal(q('#meeting-room')!.getAttribute('data-phase'), 'prejoin');
ok('removed by the host: disconnected screen explains it; Rejoin goes back to the device check');

await act(async () => { root.unmount(); });
assert.ok(t().c.isDisposed);
assert.equal(t().env.deviceChangeListeners(), 0);
ok('unmount disposes the controller');

console.log(`\n${passed} passed (meeting room UI)`);
process.exit(0);
