/**
 * Meeting control bar tests (logic + rendered component in happy-dom).
 * Run: npx tsx src/components/greet/__tests__/meetingControls.test.tsx
 */
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';

// ---- DOM environment (must exist before React DOM loads) ----
const win = new Window({ url: 'http://localhost/', width: 1280, height: 800 });
const g = globalThis as any;
for (const [k, v] of Object.entries({
  window: win, document: win.document, navigator: win.navigator, HTMLElement: win.HTMLElement, HTMLButtonElement: win.HTMLButtonElement,
  Node: win.Node, Element: win.Element, Event: win.Event, KeyboardEvent: win.KeyboardEvent, MouseEvent: win.MouseEvent,
  PointerEvent: win.PointerEvent, FocusEvent: win.FocusEvent, getComputedStyle: win.getComputedStyle.bind(win),
  requestAnimationFrame: (cb: any) => setTimeout(() => cb(Date.now()), 0), cancelAnimationFrame: (id: any) => clearTimeout(id),
})) Object.defineProperty(g, k, { value: v, configurable: true, writable: true });
g.IS_REACT_ACT_ENVIRONMENT = true;

const React = (await import('react')).default;
const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { default: MeetingControlBar, EndMeetingConfirmDialog } = await import('../MeetingControlBar');
const { meetingPermissions, buildMoreMenu, flattenMenu, nextMenuIndex } = await import('../meetingControls');

let passed = 0; const ok = (n: string) => { passed++; console.log('  ✓', n); };
const tick = () => new Promise((r) => setTimeout(r, 5));

// ---------------------------------------------------------------------------
// Logic
// ---------------------------------------------------------------------------
assert.deepEqual([meetingPermissions({ isHost: true }).canEndForEveryone, meetingPermissions({ isHost: false }).canEndForEveryone], [true, false]);
assert.equal(meetingPermissions({ isHost: false, orgRole: 'ADMIN' }).canEndForEveryone, true);
assert.equal(meetingPermissions({ isHost: false, orgRole: 'OWNER' }).canRecord, true);
assert.equal(meetingPermissions({ isHost: false, orgRole: 'MANAGER' }).canRecord, false);
ok('permissions: host and org OWNER/ADMIN may end/record; other participants may not');

const baseState = { isHost: false, isVideoPaused: false, isCamOff: false, layoutMode: 'grid' as const, isSidebarOpen: false, activeSidebarTab: 'greet' as const, isRecording: false, isRecordingPaused: false };
let sections = buildMoreMenu(baseState, meetingPermissions({ isHost: false }));
assert.ok(!sections.some((s) => s.id === 'host')); ok('participant menu has no host controls section');
const rec = flattenMenu(sections).find((i) => i.id === 'record-start')!;
assert.equal(rec.disabled, true); assert.match(rec.disabledReason!, /host or an admin/); ok('participant sees “Record meeting” disabled, with the reason');
sections = buildMoreMenu({ ...baseState, isHost: true, isRecording: true, isRecordingPaused: true }, meetingPermissions({ isHost: true }));
const ids = flattenMenu(sections).map((i) => i.id);
assert.ok(ids.includes('record-pause-resume') && ids.includes('record-stop') && ids.includes('end-for-everyone') && !ids.includes('record-start'));
assert.equal(flattenMenu(sections).find((i) => i.id === 'record-pause-resume')!.label, 'Resume recording'); ok('host menu while recording (paused): resume, stop, end for everyone');
assert.equal(flattenMenu(buildMoreMenu({ ...baseState, isCamOff: true }, meetingPermissions({ isHost: true }))).find((i) => i.id === 'toggle-pause-video')!.disabled, true);
ok('“Pause my video” is disabled (with a reason) while the camera is off');
assert.deepEqual([nextMenuIndex('ArrowDown', 2, 3), nextMenuIndex('ArrowUp', 0, 3), nextMenuIndex('Home', 2, 3), nextMenuIndex('End', 0, 3), nextMenuIndex('x', 0, 3)], [0, 2, 0, 2, null]);
ok('keyboard index: arrows wrap, Home/End, other keys ignored');

// ---------------------------------------------------------------------------
// Rendered component
// ---------------------------------------------------------------------------
type Calls = Record<string, any[]>;
function setup(overrides: Record<string, any> = {}) {
  const calls: Calls = {};
  const rec = (name: string) => (...args: any[]) => { (calls[name] ??= []).push(args); };
  const props: any = {
    isHost: false, orgRole: null, isMicMuted: false, isCamOff: false, isVideoPaused: false, isScreenSharing: false,
    participantsCount: 4, chatCount: 2, isSidebarOpen: false, activeSidebarTab: 'greet', layoutMode: 'grid',
    isRecording: false, isRecordingPaused: false, recordingDurationSeconds: 0, canShareScreen: true,
    onToggleMic: rec('mic'), onToggleCam: rec('cam'), onToggleScreenShare: rec('share'), onTogglePanel: rec('panel'),
    onTogglePauseVideo: rec('pauseVideo'), onToggleLayout: rec('layout'), onReaction: rec('reaction'),
    onStartRecording: rec('recStart'), onPauseResumeRecording: rec('recPause'), onStopRecording: rec('recStop'),
    onOpenSettings: rec('settings'), onLeave: rec('leave'), onEndForEveryone: rec('end'), ...overrides,
  };
  document.body.innerHTML = '';
  const host = document.createElement('div'); document.body.appendChild(host);
  const root = createRoot(host as any);
  const render = (extra: Record<string, any> = {}) => act(() => root.render(React.createElement(MeetingControlBar, { ...props, ...extra })));
  return { calls, render, root, q: (sel: string) => document.querySelector(sel) as any, qa: (sel: string) => [...document.querySelectorAll(sel)] as any[] };
}
const key = (el: any, k: string) => act(() => { el.dispatchEvent(new win.KeyboardEvent('keydown', { key: k, bubbles: true }) as any); });
const click = (el: any) => act(() => { el.click(); });
const active = () => document.activeElement as any;

{
  const t = setup(); await t.render();
  const labels = t.qa('[role="toolbar"] button').map((b) => b.getAttribute('aria-label'));
  assert.deepEqual(labels, ['Turn off microphone', 'Turn off camera', 'Share screen', 'Participants (4)', 'Chat (2 messages)', 'More options', 'Leave meeting']);
  ok('primary bar: mic, camera, share, participants, chat, More, Leave, each with an accessible name');
  assert.ok(!t.q('#btn-end-meeting') && !t.q('[data-menu-id]')); ok('secondary controls are not in the bar; menu closed initially');
  await t.render({ isMicMuted: true, isCamOff: true, isScreenSharing: true, isSidebarOpen: true, activeSidebarTab: 'chat' });
  assert.equal(t.q('#btn-toggle-mic').getAttribute('aria-label'), 'Turn on microphone');
  assert.equal(t.q('#btn-toggle-cam').getAttribute('aria-label'), 'Turn on camera');
  assert.equal(t.q('#btn-share-screen').getAttribute('aria-pressed'), 'true');
  assert.equal(t.q('#btn-tab-chat').getAttribute('aria-pressed'), 'true'); assert.equal(t.q('#btn-tab-people').getAttribute('aria-pressed'), 'false');
  ok('states exposed: muted / camera off labels, sharing and open panel as aria-pressed');
  await tick(); assert.match(t.q('[role="status"]').textContent, /Microphone off\. Camera off\. Sharing your screen\./); ok('state changes are announced in a polite live region');
  await t.render({ canShareScreen: false });
  assert.equal(t.q('#btn-share-screen'), null); ok('share screen is hidden where the browser can’t share');
  await click(t.q('#btn-toggle-mic')); await click(t.q('#btn-toggle-cam')); await click(t.q('#btn-tab-people')); await click(t.q('#btn-tab-chat')); await click(t.q('#btn-leave-meeting'));
  assert.deepEqual([t.calls.mic.length, t.calls.cam.length, t.calls.panel.map((c) => c[0]), t.calls.leave.length], [1, 1, ['participants', 'chat'], 1]);
  ok('primary buttons call the existing handlers (mic, camera, panels, leave)');
}

{
  const t = setup(); await t.render();
  const more = t.q('#btn-more');
  assert.equal(more.getAttribute('aria-haspopup'), 'menu'); assert.equal(more.getAttribute('aria-expanded'), 'false');
  await click(more); await tick();
  const menu = t.q('[role="menu"]');
  assert.ok(menu); assert.equal(more.getAttribute('aria-expanded'), 'true'); assert.equal(more.getAttribute('aria-controls'), menu.id);
  assert.equal(active()?.getAttribute('data-menu-id'), 'toggle-pause-video'); ok('click More: menu opens, aria-expanded/controls set, focus on first item');
  const groups = t.qa('[role="menu"] [role="group"]').map((gr) => document.getElementById(gr.getAttribute('aria-labelledby'))!.textContent);
  assert.deepEqual(groups, ['Video and layout', 'Panels', 'Send a reaction', 'Recording', 'Settings']); ok('menu is grouped into labelled sections');
  await key(menu, 'ArrowDown'); await tick(); assert.equal(active().getAttribute('data-menu-id'), 'toggle-layout');
  await key(menu, 'End'); await tick(); assert.equal(active().getAttribute('data-menu-id'), 'open-settings');
  await key(menu, 'ArrowDown'); await tick(); assert.equal(active().getAttribute('data-menu-id'), 'toggle-pause-video');
  await key(menu, 'ArrowUp'); await tick(); assert.equal(active().getAttribute('data-menu-id'), 'open-settings');
  await key(menu, 'Home'); await tick(); assert.equal(active().getAttribute('data-menu-id'), 'toggle-pause-video');
  ok('arrow keys, Home and End move focus and wrap');
  assert.equal(t.q('[data-menu-id="toggle-layout"]').getAttribute('role'), 'menuitemcheckbox'); assert.equal(t.q('[data-menu-id="toggle-layout"]').getAttribute('aria-checked'), 'false');
  ok('toggle items are menuitemcheckbox with aria-checked');
  await key(menu, 'Escape'); await tick(); await tick();
  assert.equal(t.q('[role="menu"]'), null); assert.equal(active(), more); assert.equal(more.getAttribute('aria-expanded'), 'false'); ok('Esc closes and returns focus to More');

  await key(more, 'ArrowUp'); await tick(); assert.equal(active().getAttribute('data-menu-id'), 'open-settings'); ok('↑ on More opens with the last item focused');
  await key(t.q('[role="menu"]'), 'Tab'); await tick(); assert.equal(t.q('[role="menu"]'), null); ok('Tab closes the menu');
  await key(more, 'Enter'); await tick(); assert.ok(t.q('[role="menu"]')); ok('Enter on More opens the menu');
  await act(() => { document.body.dispatchEvent(new win.PointerEvent('pointerdown', { bubbles: true }) as any); }); await tick();
  assert.equal(t.q('[role="menu"]'), null); ok('clicking outside closes the menu');

  await click(more); await tick(); await click(t.q('[data-menu-id="toggle-layout"]')); await tick();
  assert.equal(t.calls.layout.length, 1); assert.equal(t.q('[role="menu"]'), null); ok('choosing an item runs it and closes the menu');
  await click(more); await tick(); await click(t.q('[data-menu-id="react:🎉"]'));
  assert.deepEqual(t.calls.reaction[0], ['🎉']); assert.equal(t.q('[data-menu-id="react:🎉"]'), null); ok('reactions moved into the menu still broadcast');
  for (const [id, call, arg] of [['open-greet', 'panel', 'greet'], ['open-transcript', 'panel', 'transcript'], ['open-crm', 'panel', 'crm'], ['open-settings', 'settings', undefined], ['toggle-pause-video', 'pauseVideo', undefined]] as const) {
    await click(more); await tick(); await click(t.q(`[data-menu-id="${id}"]`));
    if (arg) assert.equal(t.calls[call].at(-1)[0], arg); else assert.ok(t.calls[call]?.length);
  }
  ok('moved controls keep their behavior: Meet & Greet, Transcript, CRM, Settings, Pause video');

  // Participant: recording is disabled and explains why; no End for everyone.
  await click(more); await tick();
  const recBtn = t.q('[data-menu-id="record-start"]');
  assert.equal(recBtn.getAttribute('aria-disabled'), 'true'); assert.match(document.getElementById(recBtn.getAttribute('aria-describedby'))!.textContent!, /host or an admin/);
  await click(recBtn); assert.equal(t.calls.recStart, undefined); assert.ok(t.q('[role="menu"]'));
  assert.equal(t.q('[data-menu-id="end-for-everyone"]'), null); ok('participant: Record is disabled with a reason and does nothing; End for everyone isn’t offered');
}

{
  const t = setup({ isHost: true, isRecording: true, recordingDurationSeconds: 75 }); await t.render();
  assert.match(t.q('footer').textContent, /Recording\s*01:15/); ok('recording status stays visible in the bar');
  await click(t.q('#btn-more')); await tick();
  await click(t.q('[data-menu-id="record-pause-resume"]')); await click(t.q('#btn-more')); await tick(); await click(t.q('[data-menu-id="record-stop"]'));
  assert.deepEqual([t.calls.recPause?.length, t.calls.recStop?.length], [1, 1]); ok('host: pause/resume and stop recording from the menu');
  await click(t.q('#btn-more')); await tick();
  const end = t.q('[data-menu-id="end-for-everyone"]');
  assert.ok(end); assert.equal(document.getElementById(end.closest('[role="group"]').getAttribute('aria-labelledby'))!.textContent, 'Host controls');
  await click(end); await tick(); await tick();
  assert.equal(t.calls.end.length, 1); assert.equal(t.calls.leave, undefined);
  ok('host: “End meeting for everyone” is a separate host-only action from Leave');
}
{
  const t = setup({ isHost: false, orgRole: 'ADMIN' }); await t.render();
  await click(t.q('#btn-more')); await tick();
  assert.ok(t.q('[data-menu-id="end-for-everyone"]')); assert.equal(t.q('[data-menu-id="record-start"]').getAttribute('aria-disabled'), null);
  ok('organization admin (not host) gets host controls');
}

// ---- Confirmation dialog ----
{
  document.body.innerHTML = ''; const host = document.createElement('div'); document.body.appendChild(host);
  const root = createRoot(host as any); const calls = { cancel: 0, confirm: 0 };
  const render = (open: boolean) => act(() => root.render(React.createElement(EndMeetingConfirmDialog, { open, isRecording: true, participantsCount: 5, onCancel: () => calls.cancel++, onConfirm: () => calls.confirm++ })));
  await render(true); await tick(); await tick();
  const dlg = document.querySelector('[role="alertdialog"]') as any;
  assert.equal(dlg.getAttribute('aria-modal'), 'true'); assert.match(dlg.textContent, /recording will be stopped and saved/i);
  assert.equal(active().textContent, 'Keep meeting'); ok('end confirmation is an alertdialog, focuses the safe choice, mentions the recording');
  await key(dlg, 'Tab'); assert.equal(active().textContent, 'End for everyone'); await key(dlg, 'Tab'); assert.equal(active().textContent, 'Keep meeting'); ok('focus stays inside the dialog');
  await key(dlg, 'Escape'); assert.deepEqual(calls, { cancel: 1, confirm: 0 }); ok('Esc cancels (meeting keeps running)');
  await click([...document.querySelectorAll('button')].find((b: any) => b.textContent === 'End for everyone')); assert.equal(calls.confirm, 1); ok('confirm ends for everyone');
  await render(false); assert.equal(document.querySelector('[role="alertdialog"]'), null);
}

// ---- Raise hand, waiting room and participant management ----
{
  // Model
  assert.equal(meetingPermissions({ isHost: false, orgRole: 'ADMIN' }).canManageParticipants, true);
  assert.equal(meetingPermissions({ isHost: false, orgRole: 'SALES_REP' }).canManageParticipants, false);
  const guest = flattenMenu(buildMoreMenu({ ...baseState }, meetingPermissions({ isHost: false })));
  assert.ok(guest.some((i) => i.id === 'toggle-raise-hand' && i.label === 'Raise my hand' && i.checked === false));
  assert.ok(!guest.some((i) => ['toggle-waiting-room', 'mute-all', 'lower-all-hands'].includes(i.id)));
  ok('everyone can raise a hand; participants see no waiting-room / mute-all controls');
  const hostItems = flattenMenu(buildMoreMenu({ ...baseState, isHost: true, isHandRaised: true, isWaitingRoomEnabled: true, raisedHandsCount: 2 }, meetingPermissions({ isHost: true })));
  assert.equal(hostItems.find((i) => i.id === 'toggle-raise-hand')!.label, 'Lower my hand');
  assert.equal(hostItems.find((i) => i.id === 'toggle-waiting-room')!.checked, true);
  assert.equal(hostItems.find((i) => i.id === 'lower-all-hands')!.label, 'Lower all hands (2)');
  assert.ok(!flattenMenu(buildMoreMenu({ ...baseState, isHost: true }, meetingPermissions({ isHost: true }))).some((i) => i.id === 'lower-all-hands'));
  ok('host menu: waiting room toggle, mute everyone, lower all hands only when hands are up');

  // Rendered: handlers wired; items hidden when no handler is passed (no dead controls)
  let t = setup(); await t.render();
  await click(t.q('#btn-more')); await tick();
  assert.equal(t.q('[data-menu-id="toggle-raise-hand"]'), null); ok('raise hand is hidden when the screen provides no handler');
  await key(t.q('[role="menu"]'), 'Escape'); await tick();

  t = setup({ isHost: true, onToggleRaiseHand: () => { (t.calls.hand ??= []).push([]); }, onToggleWaitingRoom: () => { (t.calls.waiting ??= []).push([]); },
    onMuteAll: () => { (t.calls.muteAll ??= []).push([]); }, onLowerAllHands: () => {}, waitingCount: 3, raisedHandsCount: 1 });
  await t.render();
  assert.equal(t.q('#btn-tab-people').getAttribute('aria-label'), 'Participants (4), 3 waiting'); ok('host sees the waiting count on Participants');
  await click(t.q('#btn-more')); await tick(); await click(t.q('[data-menu-id="toggle-raise-hand"]'));
  await click(t.q('#btn-more')); await tick(); await click(t.q('[data-menu-id="toggle-waiting-room"]'));
  await click(t.q('#btn-more')); await tick(); await click(t.q('[data-menu-id="mute-all"]'));
  assert.deepEqual([t.calls.hand?.length, t.calls.waiting?.length, t.calls.muteAll?.length], [1, 1, 1]); ok('raise hand, waiting room and mute everyone call their handlers');
  await t.render({ isHandRaised: true }); await tick();
  assert.match(t.q('[role="status"]').textContent, /Your hand is raised/); ok('raised hand is announced to screen readers');

  t = setup({ isHost: false, waitingCount: 3, onToggleRaiseHand: () => {} }); await t.render();
  assert.equal(t.q('#btn-tab-people').getAttribute('aria-label'), 'Participants (4)'); ok('non-hosts never see the waiting count');
}

// ---- Plan-aware menu ----
{
  const free = { recording: false, waitingRoom: false, securityControls: false, hostControls: false };
  const hints = { recording: 'Included in Premium', waitingRoom: 'Included in Premium', securityControls: 'Included in Premium' };
  const items = flattenMenu(buildMoreMenu({ ...baseState, isHost: true, features: free, featureHints: hints }, meetingPermissions({ isHost: true })));
  const byId = (id: string) => items.find((i) => i.id === id)!;
  assert.equal(byId('record-start').disabled, true); assert.equal(byId('record-start').disabledReason, 'Included in Premium');
  assert.equal(byId('toggle-waiting-room').disabled, true); assert.equal(byId('toggle-lock').disabled, true);
  assert.ok(byId('open-upgrade')); assert.equal(byId('mute-all').disabled, undefined);
  ok('Free plan: recording, waiting room and lock are disabled with "Included in Premium"; Plans and upgrades is offered');
  const guest = flattenMenu(buildMoreMenu({ ...baseState, features: free, featureHints: hints }, meetingPermissions({ isHost: false })));
  assert.equal(guest.find((i) => i.id === 'record-start')!.disabledReason, 'Only the host or an admin can do this');
  assert.ok(!guest.some((i) => i.id === 'open-upgrade')); ok('participants see the role reason first and no upgrade entry');
  const premium = flattenMenu(buildMoreMenu({ ...baseState, isHost: true, features: { ...free, recording: true, waitingRoom: true, securityControls: true, hostControls: true } }, meetingPermissions({ isHost: true })));
  assert.equal(premium.find((i) => i.id === 'record-start')!.disabled, undefined);
  assert.ok(!premium.some((i) => i.id === 'open-upgrade')); ok('Premium: those controls are enabled');
}

// ---- Responsive: bottom sheet on phones, anchored popover on wide screens ----
{
  const t = setup(); await t.render();
  await click(t.q('#btn-more')); await tick();
  assert.ok(t.q('[role="menu"]').className.includes('w-72')); ok('desktop: menu is an anchored popover');
  await key(t.q('[role="menu"]'), 'Escape'); await tick();
  await act(async () => { (win as any).happyDOM.setViewport({ width: 375, height: 740 }); });
  await click(t.q('#btn-more')); await tick();
  const m = t.q('[role="menu"]');
  assert.ok(m.className.includes('inset-x-0') && m.className.includes('bottom-0')); assert.equal(m.style.maxHeight, '518px');
  ok('phone: menu becomes a bottom sheet capped at 70% of the screen (no clipping)');
}

console.log(`\n${passed} passed (meeting controls)`);
process.exit(0);
