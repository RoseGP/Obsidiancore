/**
 * Meeting room lifecycle: pre-join permissions and preview, join, media controls, screen sharing (including
 * cancel, OS denial and ending from the browser), device/permission recovery, reconnection, disconnects,
 * leave, rejoin and teardown. LiveKit and the browser are fakes (./fakes.ts).
 * Run: npx tsx src/features/meeting-room/__tests__/meetingRoomController.test.ts
 */
import assert from 'node:assert/strict';
import { DisconnectReason } from 'livekit-client';
import { MeetingApiError } from '../api/meetingTokenClient';
import { domError, fakeEnv, flush, setup, TOKEN } from './fakes';

let passed = 0;
const ok = (n: string) => { passed++; console.log('  ✓', n); };

// ---- Pre-join ----
{
  const t = setup();
  await t.c.init();
  let s = t.c.getSnapshot();
  assert.equal(s.phase, 'prejoin');
  assert.equal(s.camera.permission, 'prompt');
  assert.equal(s.camera.active, false);
  assert.equal(t.created.video.length + t.created.audio.length, 0);
  assert.equal(t.env.deviceChangeListeners(), 1);
  ok('init reads permissions and devices without starting any capture');

  await t.c.setCameraEnabled(true);
  s = t.c.getSnapshot();
  assert.equal(t.created.video.length, 1);
  assert.ok(s.camera.active && s.preview && s.camera.permission === 'granted');
  ok('turning the camera on starts a preview (only on the user\'s action)');

  await t.c.setCameraEnabled(false);
  s = t.c.getSnapshot();
  assert.ok(t.created.video[0].stopped && !s.preview && !s.camera.active);
  ok('turning it off stops the capture track');
  t.c.dispose();
}

{
  const t = setup({ videoError: [domError('NotAllowedError', 'Permission denied')] });
  await t.c.init();
  await t.c.setCameraEnabled(true);
  let s = t.c.getSnapshot();
  assert.equal(s.camera.issue?.code, 'denied'); assert.equal(s.camera.permission, 'denied'); assert.equal(s.camera.active, false);
  assert.equal(s.camera.issue?.retryable, false);
  ok('camera denied: blocked, explained, not claimed active');
  await t.c.retry('camera');
  s = t.c.getSnapshot();
  assert.ok(s.camera.active && !s.camera.issue);
  ok('retry after allowing in site settings recovers the camera');
  t.c.dispose();
}

{
  const t = setup({ audioError: [domError('NotAllowedError', 'Permission dismissed'), domError('NotReadableError')] });
  await t.c.init();
  await t.c.setMicrophoneEnabled(true);
  assert.equal(t.c.getSnapshot().microphone.issue?.code, 'dismissed');
  assert.equal(t.c.getSnapshot().microphone.issue?.retryable, true);
  await t.c.setMicrophoneEnabled(true);
  assert.equal(t.c.getSnapshot().microphone.issue?.code, 'in_use');
  ok('microphone: dismissed prompt and device in use are told apart (both retryable)');
  t.c.dispose();
}

{
  const t = setup({ env: fakeEnv({ secure: false }) });
  await t.c.init();
  await t.c.setCameraEnabled(true);
  assert.equal(t.c.getSnapshot().camera.issue?.code, 'insecure_context');
  assert.equal(t.created.video.length, 0);
  ok('insecure page: capture is blocked up front, nothing requested');
  t.c.dispose();
}

{
  const t = setup();
  await t.c.init();
  await t.c.setCameraEnabled(true);
  t.created.video[0].end();
  const s = t.c.getSnapshot();
  assert.ok(!s.preview && !s.camera.active && s.camera.issue?.code === 'ended');
  ok('preview device unplugged: preview cleared, issue shown');
  await t.c.setCameraEnabled(true);
  t.env.setPermission('camera', 'denied');
  assert.ok(t.created.video[1].stopped && t.c.getSnapshot().camera.issue?.code === 'denied');
  ok('permission revoked during preview: capture stopped, shown as blocked');
  t.env.setPermission('camera', 'granted');
  assert.equal(t.c.getSnapshot().camera.issue, null);
  ok('permission granted again: the block clears');
  t.c.dispose();
}

// ---- Join: publish only what was selected ----
{
  const t = setup();
  await t.c.init();
  await t.c.setCameraEnabled(true);
  const preview = t.created.video[0];
  await t.c.join('  ABC-defg-hij ');
  const room = t.room();
  let s = t.c.getSnapshot();
  assert.equal(s.phase, 'connected');
  assert.deepEqual(t.tokens.joins, ['abc-defg-hij']);
  assert.deepEqual(room.connects, [{ url: (TOKEN as any).url, token: (TOKEN as any).token }]);
  assert.equal(room.localParticipant.published.length, 1);
  assert.equal(room.localParticipant.published[0].track, preview);
  assert.equal(room.localParticipant.published[0].options.source, 'camera');
  assert.ok(!preview.stopped && s.camera.active && !s.microphone.active && !s.preview);
  ok('join publishes the previewed camera (same track, no second prompt) and not the microphone');

  const bob = room.addRemote('pt_bob', 'Bob');
  room.publishRemote(bob, 'camera', { width: 1280, height: 720 });
  room.publishRemote(bob, 'microphone');
  const cara = room.addRemote('pt_cara', 'Cara');
  s = t.c.getSnapshot();
  assert.deepEqual(s.participants.map((p) => p.key), ['pt_local', 'pt_bob', 'pt_cara']);
  const b = s.participants[1];
  assert.ok(b.camera && b.audio && !b.micMuted && b.camera.width === 1280);
  assert.ok(!s.participants[0].audio, 'own microphone is never played back');
  ok('remote participants appear in arrival order with camera, audio and mic state');

  room.publishRemote(cara, 'screen_share', { width: 1920, height: 1080 });
  bob.getTrackPublication('camera')!.isMuted = true; room.emit('trackMuted', bob.getTrackPublication('camera'), bob);
  s = t.c.getSnapshot();
  assert.deepEqual(s.participants.map((p) => p.key), ['pt_local', 'pt_bob', 'pt_cara']);
  assert.ok(!s.participants[1].camera && s.participants[2].screen);
  ok('publishing, muting and screen sharing don\'t reorder tiles');

  room.removeRemote('pt_bob');
  room.addRemote('pt_bob', 'Bob');
  assert.deepEqual(t.c.getSnapshot().participants.map((p) => p.key), ['pt_local', 'pt_bob', 'pt_cara']);
  ok('someone who leaves and comes back keeps their identity key');

  // ---- In-meeting controls ----
  await t.c.toggleCamera();
  assert.deepEqual(room.localParticipant.calls, ['camera:false']);
  assert.equal(t.c.getSnapshot().camera.active, false);
  await t.c.toggleMicrophone();
  assert.deepEqual(room.localParticipant.calls, ['camera:false', 'microphone:true']);
  assert.equal(t.c.getSnapshot().microphone.active, true);
  ok('camera and microphone toggles change the LiveKit publication, and the UI follows it');

  room.localParticipant.failNext.camera = domError('NotAllowedError', 'Permission denied');
  await t.c.setCameraEnabled(true);
  s = t.c.getSnapshot();
  assert.equal(s.camera.issue?.code, 'denied'); assert.equal(s.camera.active, false);
  await t.c.retry('camera');
  assert.equal(t.c.getSnapshot().camera.active, true);
  ok('camera blocked in the meeting: shown, then recovered with Retry');

  const micPub = room.localParticipant.getTrackPublication('microphone')!;
  micPub.isMuted = true; room.emit('trackMuted', micPub, room.localParticipant);
  assert.equal(t.c.getSnapshot().microphone.issue?.code, 'ended');
  ok('LiveKit muting a microphone it couldn\'t restart shows as a device problem, not a silent mute');

  // ---- Screen sharing ----
  await t.c.setScreenShareEnabled(true);
  assert.equal(t.c.getSnapshot().screen.active, true);
  room.localParticipant.unpublishScreen(); // the browser's own "Stop sharing" button
  s = t.c.getSnapshot();
  assert.equal(s.screen.active, false);
  assert.equal(s.notice?.text, 'You stopped sharing your screen.');
  ok('ending the share from the browser\'s controls unpublishes it and updates the UI');

  room.localParticipant.failNext.screen_share = domError('NotAllowedError', 'Permission denied');
  await t.c.setScreenShareEnabled(true);
  s = t.c.getSnapshot();
  assert.ok(!s.screen.active && !s.screen.issue && !s.screen.pending);
  ok('cancelling the share picker is quiet (no error), and controls aren\'t left pending');

  room.localParticipant.failNext.screen_share = domError('NotAllowedError', 'Permission denied by system');
  await t.c.setScreenShareEnabled(true);
  assert.equal(t.c.getSnapshot().screen.issue?.code, 'denied_by_system');
  await t.c.setScreenShareEnabled(true);
  assert.ok(t.c.getSnapshot().screen.active && !t.c.getSnapshot().screen.issue);
  await t.c.setScreenShareEnabled(false);
  assert.ok(!t.c.getSnapshot().screen.active);
  assert.notEqual(t.c.getSnapshot().notice?.text, 'You stopped sharing your screen.');
  ok('OS denial is explained; retry and stop work; stopping from our button isn\'t reported as external');

  // ---- Reconnection, audio autoplay ----
  room.emit('reconnecting');
  assert.equal(t.c.getSnapshot().phase, 'reconnecting');
  room.emit('reconnected');
  assert.equal(t.c.getSnapshot().phase, 'connected');
  room.canPlaybackAudio = false; room.emit('audioPlaybackChanged', false);
  assert.equal(t.c.getSnapshot().audioBlocked, true);
  await t.c.startAudio();
  assert.equal(t.c.getSnapshot().audioBlocked, false);
  ok('reconnecting and blocked audio playback are shown and recover');

  // ---- Device removal ----
  await t.c.selectDevice('camera', 'cam-1');
  assert.deepEqual(room.switches.at(-1), ['videoinput', 'cam-1']);
  t.env.setDevices([{ kind: 'videoinput', deviceId: 'cam-2', label: 'USB camera' }, { kind: 'audioinput', deviceId: 'mic-1' }]);
  await flush();
  s = t.c.getSnapshot();
  assert.equal(s.camera.deviceId, 'cam-2'); // the fallback LiveKit switched to
  assert.deepEqual(room.switches.at(-1), ['videoinput', 'cam-2']);
  assert.match(s.notice?.text ?? '', /disconnected/);
  ok('the selected camera is unplugged: falls back to another one and says so');

  // ---- Leave ----
  const listenersBefore = room.listenerCount();
  assert.equal(t.c.roomListenerCount, listenersBefore);
  await t.c.leave();
  s = t.c.getSnapshot();
  assert.equal(s.phase, 'prejoin');
  assert.deepEqual(room.disconnects, [true]);
  assert.equal(room.listenerCount(), 0);
  assert.deepEqual(t.tokens.leaves, ['abc-defg-hij']);
  room.localParticipant.trackPublications.forEach((p) => assert.ok(p.track?.stopped));
  assert.ok(!s.camera.active && !s.microphone.active && !s.screen.active && s.participants.length === 0);
  await t.c.leave();
  assert.deepEqual(room.disconnects, [true]);
  ok('leave stops capture, disconnects once, removes every listener, tells the server; a second leave does nothing');

  // ---- Rejoin: no duplicate listeners ----
  await t.c.join('abc-defg-hij');
  const room2 = t.room();
  assert.notEqual(room2, room);
  assert.equal(t.c.getSnapshot().phase, 'connected');
  assert.equal(room2.listenerCount(), listenersBefore);
  assert.equal(room2.localParticipant.published.length, 0);
  ok('rejoin uses a fresh room with the same listener set, publishing nothing not turned on');

  // ---- Unexpected disconnect ----
  room2.emit('disconnected', DisconnectReason.ROOM_DELETED);
  s = t.c.getSnapshot();
  assert.equal(s.phase, 'disconnected');
  assert.equal(s.notice?.text, 'The meeting has ended.');
  assert.equal(room2.listenerCount(), 0);
  assert.deepEqual(t.tokens.leaves, ['abc-defg-hij']);
  t.c.backToPrejoin();
  assert.equal(t.c.getSnapshot().phase, 'prejoin');
  ok('meeting ended by the server: disconnected screen, listeners gone, back to pre-join on Rejoin');

  t.c.dispose();
  t.c.dispose();
  assert.equal(t.env.deviceChangeListeners(), 0);
  assert.equal(t.env.permissionListeners('camera'), 0);
  assert.equal(t.env.permissionListeners('microphone'), 0);
  ok('dispose (twice) removes the device and permission watchers');
}

// ---- Connection lost for good ----
{
  const t = setup();
  await t.c.init();
  await t.c.setMicrophoneEnabled(true);
  await t.c.join('abc-defg-hij');
  const room = t.room();
  const mic = room.localParticipant.getTrackPublication('microphone')!.track!;
  room.emit('disconnected', DisconnectReason.UNKNOWN_REASON);
  assert.equal(t.c.getSnapshot().phase, 'disconnected');
  assert.ok((mic as any).stopped, 'local capture is stopped');
  assert.deepEqual(t.tokens.leaves, ['abc-defg-hij']);
  ok('connection lost: capture stopped, roster told, rejoin offered');
  t.c.dispose();
}
{
  const t = setup();
  await t.c.init();
  await t.c.join('abc-defg-hij');
  t.room().emit('disconnected', DisconnectReason.DUPLICATE_IDENTITY);
  assert.match(t.c.getSnapshot().notice!.text, /another tab/);
  assert.deepEqual(t.tokens.leaves, []);
  ok('joined from another tab: this one stops, without removing the other from the roster');
  t.c.dispose();
}

// ---- Join failures and the waiting room ----
{
  const t = setup();
  await t.c.init();
  await t.c.setCameraEnabled(true);
  t.tokens.results = [new MeetingApiError('Audio and video aren\'t connected on this server yet (LiveKit isn\'t configured).', 503, 'media_not_configured')];
  await t.c.join('abc-defg-hij');
  const s = t.c.getSnapshot();
  assert.equal(s.phase, 'prejoin');
  assert.equal(s.error?.code, 'media_not_configured');
  assert.ok(s.preview && !t.created.video[0].stopped);
  assert.equal(t.rooms.length, 0);
  ok('server can\'t issue a token (LiveKit not configured): stays in pre-join with the preview, says why');
  t.c.dispose();
}
{
  const t = setup();
  await t.c.init();
  await t.c.setCameraEnabled(true);
  t.tokens.results = [TOKEN];
  t.failNextConnect(new Error('could not establish signal connection'));
  await t.c.join('abc-defg-hij');
  const s = t.c.getSnapshot();
  assert.equal(s.phase, 'prejoin'); assert.equal(s.error?.code, 'connect_failed');
  assert.equal(t.room().listenerCount(), 0);
  assert.ok(s.preview && !t.created.video[0].stopped);
  ok('LiveKit connection fails: listeners removed, preview kept, error shown');
  t.c.dispose();
}
{
  const t = setup();
  await t.c.init();
  await t.c.join('not a code!');
  assert.equal(t.c.getSnapshot().error?.code, 'invalid_input');
  assert.equal(t.tokens.joins.length, 0);
  ok('invalid meeting codes are rejected before any request');
  t.c.dispose();
}
{
  const t = setup();
  await t.c.init();
  t.tokens.results = [{ kind: 'waiting', participantId: 'pt_local' }, { kind: 'waiting', participantId: 'pt_local' }, TOKEN];
  const joining = t.c.join('abc-defg-hij');
  await joining;
  assert.equal(t.c.getSnapshot().phase, 'waiting');
  await flush(); await flush();
  assert.equal(t.c.getSnapshot().phase, 'connected');
  assert.equal(t.tokens.joins.length, 3);
  ok('waiting room: asks again until the host lets you in, then connects');
  t.c.dispose();
}
{
  const t = setup();
  await t.c.init();
  t.tokens.results = [{ kind: 'waiting', participantId: 'pt_local' }];
  await t.c.join('abc-defg-hij');
  await t.c.cancelJoin();
  const joinsAtCancel = t.tokens.joins.length;
  await flush(); await flush();
  assert.equal(t.c.getSnapshot().phase, 'prejoin');
  assert.equal(t.tokens.joins.length, joinsAtCancel);
  assert.deepEqual(t.tokens.leaves, ['abc-defg-hij']);
  ok('cancelling while waiting stops asking and leaves the roster');
  t.c.dispose();
}
{
  const t = setup();
  await t.c.init();
  await t.c.setCameraEnabled(true);
  await t.c.join('abc-defg-hij');
  const room = t.room();
  t.c.dispose();
  assert.deepEqual(room.disconnects, [true]);
  assert.equal(room.listenerCount(), 0);
  assert.ok(t.created.video[0].stopped);
  ok('unmounting mid-meeting disconnects and stops capture');
}

console.log(`\n${passed} passed (meeting room controller)`);
process.exit(0);
