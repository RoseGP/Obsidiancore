/**
 * Meeting room building blocks: layout, permission/error classification, the server token client, and the
 * C++ analysis module (the real public/wasm/media_analysis.wasm, run in Node's WebAssembly engine).
 * Run: npx tsx src/features/meeting-room/__tests__/meetingRoomUnits.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { audioHints, accumulateAudio, frameHints, toDbfs } from '../analysis/qualityHints';
import { instantiateAnalyzer, loadMediaAnalyzer, resetMediaAnalyzerCache } from '../analysis/wasmAnalyzer';
import { createMeetingTokenClient, MeetingApiError, normalizeRoomCode } from '../api/meetingTokenClient';
import { captureEnvironment, classifyCaptureError, classifyScreenShareError, queryPermission } from '../media/deviceErrors';
import { computeLayout, gridColumns, objectFitFor, stageAspect } from '../room/layout';
import type { ParticipantView, TrackRef } from '../room/types';
import { domError } from './fakes';

let passed = 0;
const ok = (n: string) => { passed++; console.log('  ✓', n); };

// ---- Layout ----
const track = (id: string, w?: number, h?: number): TrackRef => ({ id, track: {} as any, width: w, height: h });
const person = (key: string, order: number, extra: Partial<ParticipantView> = {}): ParticipantView => ({
  key, name: key, isLocal: false, isSpeaking: false, quality: 'good', micPublished: true, micMuted: false, camera: null, screen: null, audio: null, order, ...extra,
});
{
  assert.deepEqual([1, 2, 3, 4, 5, 9, 10, 20].map((n) => gridColumns(n, 1280)), [1, 2, 2, 2, 3, 3, 4, 4]);
  assert.deepEqual([2, 5, 12].map((n) => gridColumns(n, 400)), [1, 2, 2]);
  ok('grid columns follow participant count and narrow screens');

  const ps = [person('c', 3), person('me', 1, { isLocal: true }), person('b', 2)];
  const grid = computeLayout(ps, { width: 1200 });
  assert.equal(grid.mode, 'grid');
  assert.deepEqual(grid.tiles.map((p) => p.key), ['me', 'b', 'c']);
  ok('tiles keep arrival order regardless of input order');

  const withShares = [person('me', 1, { isLocal: true, screen: track('s-me') }), person('b', 2, { screen: track('s-b', 1440, 900) }), person('c', 3)];
  let l = computeLayout(withShares, { width: 1200 });
  assert.equal(l.mode, 'stage');
  assert.equal(l.stage?.participantKey, 'b');
  assert.deepEqual(l.shares.map((s) => s.key), ['b:screen', 'me:screen']);
  assert.equal(l.tiles.length, 3);
  ok('screen shares take the stage (a remote share before your own); everyone stays in the strip');
  l = computeLayout(withShares, { width: 1200, pinnedShareKey: 'me:screen' });
  assert.equal(l.stage?.key, 'me:screen');
  l = computeLayout(withShares, { width: 1200, pinnedShareKey: 'gone:screen' });
  assert.equal(l.stage?.key, 'b:screen');
  ok('a pinned share wins while it exists, and falls back when it ends');

  assert.equal(stageAspect(track('x', 1440, 900)), '1440 / 900');
  assert.equal(stageAspect(track('x')), '16 / 9');
  assert.deepEqual([objectFitFor('camera'), objectFitFor('screen')], ['cover', 'contain']);
  ok('screen shares use the source aspect ratio (16:9 until known), shown whole; cameras fill and crop, never stretch');
}

// ---- Errors and permissions ----
{
  assert.equal(classifyCaptureError(domError('NotAllowedError', 'Permission denied'), 'camera').code, 'denied');
  assert.equal(classifyCaptureError(domError('NotAllowedError', 'Permission dismissed'), 'camera').code, 'dismissed');
  assert.equal(classifyCaptureError(domError('NotFoundError'), 'microphone').code, 'not_found');
  assert.equal(classifyCaptureError(domError('NotReadableError', 'Could not start video source'), 'camera').code, 'in_use');
  assert.equal(classifyCaptureError(domError('OverconstrainedError'), 'camera').code, 'overconstrained');
  assert.equal(classifyCaptureError(domError('SecurityError'), 'camera').code, 'policy_blocked');
  assert.equal(classifyCaptureError(domError('NotSupportedError', 'Not supported'), 'camera').code, 'unsupported');
  assert.equal(classifyCaptureError(new Error('weird'), 'camera').code, 'unknown');
  assert.match(classifyCaptureError(domError('NotFoundError'), 'microphone').message, /No microphone was found/);
  ok('capture errors map to specific, actionable messages');

  assert.deepEqual([classifyScreenShareError(domError('NotAllowedError', 'Permission denied')).code, classifyScreenShareError(domError('NotAllowedError', 'Permission denied')).quiet], ['cancelled', true]);
  assert.equal(classifyScreenShareError(domError('NotAllowedError', 'Permission denied by system')).code, 'denied_by_system');
  assert.equal(classifyScreenShareError(domError('NotSupportedError')).code, 'unsupported');
  assert.equal(classifyScreenShareError(domError('NotReadableError')).code, 'in_use');
  ok('screen share: cancelled picker is quiet; OS denial and unsupported browsers are explained');

  const md = { getUserMedia() {}, getDisplayMedia() {} };
  assert.deepEqual(captureEnvironment({ isSecureContext: false, navigator: { mediaDevices: md } as any }).blockedBy, { camera: 'insecure_context', microphone: 'insecure_context' });
  assert.equal(captureEnvironment({ isSecureContext: true, navigator: {} as any }).blockedBy.camera, 'unsupported');
  const env = captureEnvironment({ isSecureContext: true, navigator: { mediaDevices: { getUserMedia() {} } } as any, document: { permissionsPolicy: { allowsFeature: (f: string) => f !== 'microphone' } } as any });
  assert.deepEqual([env.camera, env.microphone, env.screen], [true, false, false]);
  assert.equal(env.blockedBy.microphone, 'policy_blocked');
  ok('environment: insecure pages, missing APIs, permissions policy and missing screen capture are detected up front');

  assert.equal(await queryPermission('camera', { permissions: { query: async () => ({ state: 'granted', onchange: null }) } } as any), 'granted');
  assert.equal(await queryPermission('camera', { permissions: { query: async () => { throw new TypeError('camera is not a valid PermissionName'); } } } as any), 'unknown');
  assert.equal(await queryPermission('microphone', {} as any), 'unknown');
  ok('permission query never prompts and degrades to unknown where unsupported');
}

// ---- Server token client ----
{
  assert.equal(normalizeRoomCode('ABC-defg-hij'), 'abc-defg-hij');
  assert.equal(normalizeRoomCode('https://crm.example.com/?view=greet&meet=abc-defg-hij'), 'abc-defg-hij');
  assert.equal(normalizeRoomCode('/?tab=greet&meet=team-sync'), 'team-sync');
  assert.equal(normalizeRoomCode('https://crm.example.com/meet/abc-defg-hij'), 'abc-defg-hij');
  assert.equal(normalizeRoomCode('a'), null);
  assert.equal(normalizeRoomCode('../../admin'), null);
  assert.equal(normalizeRoomCode('room code'), null);
  ok('meeting codes from codes or links are validated with the server\'s rule');

  const calls: Array<{ url: string; body: string }> = [];
  const respond = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  let script: Array<Response> = [];
  const client = createMeetingTokenClient(async (input, init) => { calls.push({ url: String(input), body: String(init?.body) }); return script.shift()!; });

  script = [respond(200, { success: true, you: { participantId: 'pt_1', status: 'in' } }), respond(200, { success: true, url: 'wss://lk.example.test', token: 'jwt', expiresAt: 123 })];
  const r = await client.join('ABC-defg-hij');
  assert.deepEqual(r, { kind: 'token', url: 'wss://lk.example.test', token: 'jwt', expiresAt: 123, participantId: 'pt_1' });
  assert.deepEqual(calls.map((c) => c.url), ['/api/meetings/rooms/abc-defg-hij/join', '/api/meetings/rooms/abc-defg-hij/media-token']);
  assert.ok(calls.every((c) => c.body === '{}'), 'the browser never sends a room name or identity');
  ok('join → media-token through the server; the client sends no identity or room name');

  script = [respond(200, { success: true, you: { participantId: 'pt_1', status: 'waiting' } })];
  assert.deepEqual(await client.join('abc-defg-hij'), { kind: 'waiting', participantId: 'pt_1' });
  ok('waiting room is reported without asking for a token');

  script = [respond(200, { success: true, you: { participantId: 'pt_1', status: 'in' } }), respond(503, { success: false, code: 'media_not_configured', error: 'Audio and video between people aren\'t connected on this server yet (LiveKit isn\'t configured).' })];
  await assert.rejects(client.join('abc-defg-hij'), (e: unknown) => e instanceof MeetingApiError && e.code === 'media_not_configured' && e.status === 503);
  script = [respond(423, { success: false, code: 'meeting_locked', error: 'The host has locked this meeting.' })];
  await assert.rejects(client.join('abc-defg-hij'), (e: unknown) => e instanceof MeetingApiError && e.code === 'meeting_locked');
  script = [respond(403, { success: false, code: 'not_allowed', error: 'The host removed you from this meeting.' })];
  await assert.rejects(client.join('abc-defg-hij'), (e: unknown) => e instanceof MeetingApiError && e.status === 403);
  const offline = createMeetingTokenClient(async () => { throw new TypeError('Failed to fetch'); });
  await assert.rejects(offline.join('abc-defg-hij'), (e: unknown) => e instanceof MeetingApiError && e.code === 'network');
  await assert.rejects(client.join('nope!'), (e: unknown) => e instanceof MeetingApiError && e.code === 'invalid_input');
  ok('server refusals (not configured, locked, removed, offline, bad code) surface as typed errors with the server\'s message');

  calls.length = 0;
  script = [respond(200, { success: true })];
  await client.leave('abc-defg-hij');
  assert.deepEqual(calls.map((c) => c.url), ['/api/meetings/rooms/abc-defg-hij/leave']);
  const failing = createMeetingTokenClient(async () => { throw new TypeError('Failed to fetch'); });
  await failing.leave('abc-defg-hij');
  ok('leave tells the server and never throws');
}

// ---- C++ analysis module (WebAssembly) ----
{
  const bytes = readFileSync(new URL('../../../../public/wasm/media_analysis.wasm', import.meta.url));
  const a = await instantiateAnalyzer(bytes);

  const W = 160, H = 120;
  const rgba = new Uint8ClampedArray(W * H * 4);
  const fill = (fn: (x: number, y: number) => number) => { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = fn(x, y), i = (y * W + x) * 4; rgba[i] = rgba[i + 1] = rgba[i + 2] = v; rgba[i + 3] = 255; } };

  fill(() => 0);
  let f = a.analyzeFrame(rgba, W, H)!;
  assert.deepEqual([f.meanLuma, f.darkFraction, f.sharpness], [0, 1, 0]);
  assert.equal(frameHints(f)[0].id, 'covered');
  fill((x, y) => ((Math.floor(x / 4) + Math.floor(y / 4)) % 2 ? 230 : 25));
  f = a.analyzeFrame(rgba, W, H)!;
  assert.ok(Math.abs(f.meanLuma - 127.5) < 1 && f.stddevLuma > 100 && f.sharpness > 1000);
  assert.deepEqual(frameHints(f).map((h) => h.id), ['video_ok']);
  fill((x) => 40 + Math.floor((x * 170) / (W - 1)));
  f = a.analyzeFrame(rgba, W, H)!;
  assert.ok(f.sharpness < 5);
  assert.ok(frameHints(f).some((h) => h.id === 'blurry'));
  fill(() => 255);
  assert.equal(frameHints(a.analyzeFrame(rgba, W, H)).some((h) => h.id === 'bright'), true);
  assert.equal(a.analyzeFrame(rgba, 400, 300), null);
  ok('WASM frame analysis matches the native results: exposure, contrast, sharpness; oversized frames rejected');

  a.resetAudio();
  const block = new Float32Array(2048);
  const sine = (amp: number, cps: number) => { for (let i = 0; i < block.length; i++) block[i] = amp * Math.sin(2 * Math.PI * cps * i); };
  let w = null as ReturnType<typeof accumulateAudio> | null;
  sine(0.002, 0.07);
  for (let k = 0; k < 15; k++) w = accumulateAudio(w, a.analyzeAudio(block)!);
  assert.deepEqual(audioHints(w).map((h) => h.id), ['say_something']);
  sine(0.3, 0.02);
  const m = a.analyzeAudio(block)!;
  assert.ok(Math.abs(m.rms - 0.3 / Math.SQRT2) < 0.005 && m.speechLikely);
  w = accumulateAudio(w, m);
  assert.deepEqual(audioHints(w).map((h) => h.id), ['audio_ok']);
  block.fill(1);
  const clipped = a.analyzeAudio(block)!;
  assert.equal(clipped.clipFraction, 1);
  let cw = null as ReturnType<typeof accumulateAudio> | null;
  for (let k = 0; k < 15; k++) cw = accumulateAudio(cw, clipped);
  assert.ok(audioHints(cw).some((h) => h.id === 'clipping'));
  let sw = null as ReturnType<typeof accumulateAudio> | null;
  block.fill(0);
  for (let k = 0; k < 15; k++) sw = accumulateAudio(sw, a.analyzeAudio(block)!);
  assert.equal(audioHints(sw)[0].id, 'silent');
  assert.equal(a.analyzeAudio(new Float32Array(9000)), null);
  assert.equal(Math.round(toDbfs(0.1)), -20);
  ok('WASM audio analysis: level, clipping, silence and speech-over-noise-floor hints');

  resetMediaAnalyzerCache();
  assert.equal(await loadMediaAnalyzer('/missing.wasm', async () => new Response('not found', { status: 404 })), null);
  resetMediaAnalyzerCache();
  assert.equal(await loadMediaAnalyzer('/bad.wasm', async () => new Response(new Uint8Array([0, 1, 2, 3]))), null);
  resetMediaAnalyzerCache();
  ok('missing or corrupt module → null (the meeting works without hints)');
}

console.log(`\n${passed} passed (meeting room units)`);
process.exit(0);
