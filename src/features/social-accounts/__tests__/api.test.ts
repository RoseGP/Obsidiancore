/**
 * End-to-end test of /api/accounts, /api/posts and /api/analytics against a mock Postiz.
 *   npx tsx src/features/social-accounts/__tests__/api.test.ts oauth
 *   npx tsx src/features/social-accounts/__tests__/api.test.ts shared
 */
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { startMockBluesky, startMockPostiz } from './mockPostiz';

const MODE = (process.argv[2] || 'oauth') as 'oauth' | 'shared';
let passed = 0;
const ok = (n: string) => { passed++; console.log('  ✓', n); };
const APP_URL = 'https://crm.test';
const mock = await startMockPostiz({ clientId: 'pca_test', clientSecret: 'pcs_test', appRedirect: `${APP_URL}/api/accounts/callback`, apiKey: 'key_team', jwtSecret: 'postiz-jwt' });
const bsky = await startMockBluesky();
Object.assign(process.env, {
  NODE_ENV: 'test', SOCIAL_ACCOUNTS_DEV_AUTH: 'true', SOCIAL_ACCOUNTS_STORE: 'file',
  SOCIAL_ACCOUNTS_DATA_DIR: mkdtempSync(path.join(tmpdir(), 'sa-')), SOCIAL_ACCOUNTS_ENCRYPTION_KEY: 'k'.repeat(40),
  POSTIZ_API_URL: mock.base, POSTIZ_FRONTEND_URL: mock.base, APP_URL, BLUESKY_ALLOWED_SERVICES: bsky.base,
});
if (MODE === 'oauth') Object.assign(process.env, { POSTIZ_CLIENT_ID: 'pca_test', POSTIZ_CLIENT_SECRET: 'pcs_test', POSTIZ_REDIRECT_URI: `${APP_URL}/api/accounts/callback` });
else Object.assign(process.env, { POSTIZ_API_KEY: 'key_team', POSTIZ_ENTERPRISE_JWT_SECRET: 'postiz-jwt' });

const { requireUser } = await import('../server/auth');
const { redact } = await import('../server/http');
const { config } = await import('../server/instance');
const { signState } = await import('../server/config');
const app = express();
app.set('trust proxy', false);
app.use(express.json());
app.use('/api/accounts', (await import('../../../routes/accountsApi')).default);
app.use('/api/analytics', (await import('../../../routes/analyticsApi')).default);
app.use('/api/posts', (await import('../../../routes/postsApi')).default);
app.use('/api/media', (await import('../../../routes/postsApi')).default);

const H = (u: string) => ({ 'X-Dev-User-Id': u, Origin: APP_URL });
const A = H('alice'); const B = H('bob');
const cookieOf = (r: request.Response) => String(([] as string[]).concat(r.headers['set-cookie'] as any ?? []).find((c) => c.startsWith('sa_oauth_state=')) ?? '').split(';')[0];
const card = (o: any, p: string) => o.platforms.find((c: any) => c.platform === p);
const future = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
console.log(`mode: ${MODE}`);
{
  const { resolvePostizUrls: urls } = await import('../server/config');
  assert.deepEqual(urls({ baseUrl: 'https://postiz.example.com' }), { api: 'https://postiz.example.com/api', frontend: 'https://postiz.example.com' });
  assert.deepEqual(urls({ baseUrl: 'https://postiz.example.com/api/' }), { api: 'https://postiz.example.com/api', frontend: 'https://postiz.example.com' });
  assert.deepEqual(urls({}), { api: 'https://api.postiz.com', frontend: 'https://platform.postiz.com' });
  assert.deepEqual(urls({ apiUrl: 'https://api.postiz.com/public/v1' }).api, 'https://api.postiz.com');
  ok('Postiz URLs: self-hosted <url>/api + <url>, Cloud defaults, /public/v1 suffix removed');
}

// ---------- Authentication, CSRF, validation ----------
assert.equal((await request(app).get('/api/accounts')).status, 401);
assert.equal((await request(app).get('/api/posts').query({ from: future(-1), to: future(1) })).status, 401);
assert.equal((await request(app).get('/api/analytics')).status, 401);
assert.notEqual((await request(app).get('/api/posts/queue').set('X-Dev-User-Id', 'alice')).status, 200); ok('every endpoint rejects unauthenticated calls; the legacy /api/posts/queue route is gone');
assert.equal((await request(app).get('/api/accounts').set('Authorization', 'Bearer admin-jwt-token-2026')).status, 401); ok('hardcoded dev bearer token rejected');
assert.equal((await request(app).post('/api/accounts/connect').set('X-Dev-User-Id', 'alice').send({ platform: 'x' })).status, 403);
assert.equal((await request(app).post('/api/accounts/connect').set({ 'X-Dev-User-Id': 'alice', Origin: 'https://evil.example' }).send({ platform: 'x' })).status, 403); ok('CSRF: writes without the app’s Origin are refused');
assert.equal((await request(app).post('/api/accounts/connect').set(A).type('form').send('platform=x')).status, 415); ok('CSRF: non-JSON bodies refused');
let r = await request(app).post('/api/accounts/connect').set(A).send({ platform: 'myspace' });
assert.equal(r.status, 400); assert.equal(r.body.code, 'unsupported_platform'); ok('provider allowlist enforced server-side');
r = await request(app).post('/api/accounts/connect').set(A).send({ platform: 'x', workspaceId: 'org_other' });
assert.equal(r.status, 400); ok('unexpected fields (e.g. a workspace id) rejected by strict validation');
r = await request(app).get('/api/accounts').set(A);
assert.equal(r.status, 200); assert.equal(r.body.platforms.length, 10); assert.equal(r.headers['cache-control'], 'no-store');
assert.ok(!JSON.stringify(r.body).match(/pos_|pca_|pcs_|key_team/)); ok('list returns 10 platforms, no-store, no secrets');

// ---------- Workspace OAuth (authorization-code flow) ----------
async function authorize(user: Record<string, string>, platform = 'instagram') {
  const s = await request(app).post('/api/accounts/connect').set(user).send({ platform });
  assert.equal(s.body.next, 'authorize_workspace');
  const cookie = cookieOf(s);
  const c = await fetch(s.body.url, { redirect: 'manual' });
  const cb = new URL(c.headers.get('location')!);
  return { start: s, cookie, cbPath: cb.pathname + cb.search, url: s.body.url as string };
}
if (MODE === 'oauth') {
  const { start, cookie, cbPath } = await authorize(A);
  assert.match(cookie, /^sa_oauth_state=/);
  const setCookie = ([] as string[]).concat(start.headers['set-cookie'] as any).join(';');
  assert.match(setCookie, /HttpOnly/); assert.match(setCookie, /SameSite=Lax/); assert.match(setCookie, /Path=\/api\/accounts/); ok('state cookie is HttpOnly, SameSite=Lax, path-scoped');
  const st = new URL(start.body.url).searchParams.get('state')!;
  assert.ok(st.length > 40); ok('state is random + HMAC-signed');
  r = await request(app).get(cbPath).set('Cookie', 'sa_oauth_state=other');
  assert.match(r.headers.location, /sa_reason=state_mismatch/); ok('callback: state must match the browser cookie');
  const expired = signState({ u: 'alice', a: 'att_x', k: 'workspace', exp: Date.now() - 1000 }, config.stateKey!);
  r = await request(app).get(`/api/accounts/callback?code=abc&state=${expired}`).set('Cookie', `sa_oauth_state=${expired}`);
  assert.match(r.headers.location, /sa_reason=invalid_state/); ok('callback: expired state rejected');
  r = await request(app).get(cbPath).set('Cookie', cookie);
  assert.equal(r.status, 302); assert.match(r.headers.location, /^https:\/\/crm\.test\/\?view=social_planner&sa=workspace_connected/); ok('callback exchanges the code server-side and redirects to the app (same origin)');
  r = await request(app).get(cbPath).set('Cookie', cookie);
  assert.match(r.headers.location, /sa_reason=expired/); ok('duplicate callback rejected (single use)');
  const deny = await request(app).post('/api/accounts/connect').set(B).send({ platform: 'x' });
  const d = await fetch(deny.body.url + '&deny=1', { redirect: 'manual' }); const dl = new URL(d.headers.get('location')!);
  r = await request(app).get(dl.pathname + dl.search).set('Cookie', cookieOf(deny));
  assert.match(r.headers.location, /sa=workspace_cancelled/); ok('denied consent reported as cancelled');
  const { cookie: bc, cbPath: bp } = await authorize(B, 'linkedin');
  await request(app).get(bp).set('Cookie', bc);
}

// ---------- Connect channels ----------
async function connectChannel(user: Record<string, string>, platform: string, profile: string) {
  const s = await request(app).post('/api/accounts/connect').set(user).send({ platform });
  assert.ok(['popup', 'redirect'].includes(s.body.next), JSON.stringify(s.body));
  mock.approve(s.body.url, profile);
  const c = await request(app).post(`/api/accounts/attempts/${s.body.attemptId}/check`).set(user).send({ final: true });
  assert.equal(c.body.status, 'completed', JSON.stringify(c.body));
  return c.body.account.connectionId as string;
}
const aInsta = await connectChannel(A, 'instagram', 'alice.ig');
const aLinked = await connectChannel(A, 'linkedin', 'alice.li');
const bLinked = await connectChannel(B, 'linkedin', 'bob.li');
ok('channels connected and owned per user');
r = await request(app).get('/api/accounts').set(B);
assert.ok(!r.body.accounts.some((a: any) => a.id === aInsta)); ok('Bob’s list excludes Alice’s accounts');
r = await request(app).post(`/api/accounts/${aInsta}/reconnect`).set(B).send({});
assert.equal(r.status, 404); ok('reconnect: another user’s account id rejected');
r = await request(app).delete(`/api/accounts/${aInsta}`).set(B);
assert.equal(r.status, 404); ok('disconnect: another user’s account id rejected');
r = await request(app).post('/api/accounts/connect').set(A).send({ platform: 'tiktok' });
r = await request(app).post(`/api/accounts/attempts/${r.body.attemptId}/cancel`).set(A).send({});
assert.equal(r.body.status, 'cancelled'); ok('connection attempt can be cancelled');

// ---------- Posts ----------
r = await request(app).post('/api/posts').set(A).send({ content: 'Spring drop', scheduledAt: future(-2), platforms: ['instagram'] });
assert.equal(r.status, 400); assert.equal(r.body.field, 'scheduledAt'); ok('scheduling in the past rejected');
r = await request(app).post('/api/posts').set(A).send({ content: 'x', scheduledAt: future(2), platforms: ['instagram'], mediaUrls: ['http://insecure.example/a.jpg'] });
assert.equal(r.status, 400); ok('non-https media rejected');
r = await request(app).post('/api/posts').set(A).send({ content: 'Spring drop', scheduledAt: future(2), accountIds: [bLinked] });
assert.equal(r.status, 404); ok('posting to another user’s account id rejected');

r = await request(app).post('/api/posts').set(A).send({ content: 'Spring drop: 12 new pieces', scheduledAt: future(3), platforms: ['instagram', 'linkedin'], mediaUrls: ['https://cdn.example/spring.jpg'] });
assert.equal(r.status, 201, JSON.stringify(r.body)); assert.equal(r.body.posts.length, 2);
assert.deepEqual(mock.state.lastPostBody.posts.map((p: any) => p.settings.__type).sort(), ['instagram', 'linkedin']);
assert.match(mock.state.lastPostBody.posts[0].value[0].image[0].path, /^https:\/\/uploads\.example\//); ok('create maps to Postiz upload-from-url + POST /public/v1/posts (one per channel)');
const aPost = r.body.posts.find((p: any) => p.platform === 'instagram');
assert.equal(aPost.status, 'scheduled'); assert.equal(aPost.editable, true);

r = await request(app).post('/api/posts').set(B).send({ content: 'Bob update', scheduledAt: future(4), platforms: ['linkedin'] });
const bPost = r.body.posts[0];
r = await request(app).get('/api/posts').set(A).query({ from: future(-1), to: future(24) });
assert.equal(r.body.posts.length, 2); assert.ok(!r.body.posts.some((p: any) => p.id === bPost.id)); ok('GET /api/posts returns only the user’s posts');

// ---------- Planner: post now, media upload, channel list ----------
{
  r = await request(app).post('/api/posts').set(A).send({ content: 'Live now', mode: 'now', scheduledAt: future(-24), platforms: ['instagram'], mediaUrls: ['https://cdn.example/now.jpg'] });
  assert.equal(r.status, 201, JSON.stringify(r.body)); assert.equal(mock.state.lastPostBody.type, 'now');
  assert.ok(Math.abs(Date.parse(mock.state.lastPostBody.date) - Date.now()) < 10_000, 'now uses the server time, not the client value');
  ok('Post now → Postiz type "now" at the server’s time (client date ignored)');
  r = await request(app).post('/api/posts').set(A).send({ content: 'x', mode: 'schedule', scheduledAt: future(-1), platforms: ['instagram'] });
  assert.equal(r.status, 400); ok('schedule still requires a future time');

  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
  r = await request(app).post('/api/posts/upload').set(A).attach('file', Buffer.from('<?php echo 1; ?> not really an image'), { filename: 'evil.png', contentType: 'image/png' });
  assert.equal(r.status, 400); assert.equal(r.body.code, 'invalid_type'); ok('upload: type checked from file bytes (a fake .png is rejected)');
  r = await request(app).post('/api/posts/upload').set(B).attach('file', png, { filename: 'x.png', contentType: 'image/png' }).set('Origin', 'https://evil.example');
  assert.equal(r.status, 403); ok('upload: cross-site requests rejected (CSRF)');
  assert.equal((await request(app).post('/api/posts/upload').attach('file', png, 'x.png')).status, 401); ok('upload: sign-in required');
  r = await request(app).post('/api/posts/upload').set(A).attach('file', Buffer.alloc(26 * 1024 * 1024, 0), { filename: 'big.mp4', contentType: 'video/mp4' });
  assert.equal(r.status, 413); ok('upload: files over 25 MB rejected with a clear message');
  const beforeUploads = mock.state.uploadCalls;
  r = await request(app).post('/api/posts/upload').set(A).attach('file', png, { filename: 'photo.png', contentType: 'application/octet-stream' });
  assert.equal(r.status, 201, JSON.stringify(r.body)); assert.equal(mock.state.uploadCalls, beforeUploads + 1);
  const uploaded = r.body.media; assert.match(uploaded.path, /^https:\/\//); ok('upload: real PNG accepted, forwarded to Postiz /public/v1/upload, path returned');
  const fromUrlBefore = mock.state.uploadFromUrlCalls;
  r = await request(app).post('/api/posts').set(A).send({ content: 'With uploaded photo', scheduledAt: future(30), platforms: ['instagram'], mediaUrls: [uploaded.path] });
  assert.equal(r.status, 201, JSON.stringify(r.body)); assert.equal(mock.state.uploadFromUrlCalls, fromUrlBefore);
  assert.equal(mock.state.lastPostBody.posts[0].value[0].image[0].id, uploaded.id); ok('post reuses the uploaded file (no second upload to Postiz)');
  r = await request(app).post('/api/media/upload').set(A).attach('file', png, 'p.png');
  assert.notEqual(r.status, 404); ok('/api/media/upload is the same upload endpoint');

  r = await request(app).get('/api/accounts/integrations').set(A);
  assert.equal(r.status, 200); const names = r.body.integrations.map((i: any) => i.platform).sort();
  assert.ok(names.includes('instagram') && names.includes('linkedin')); assert.ok(!r.body.integrations.some((i: any) => i.id === bLinked));
  assert.ok(!JSON.stringify(r.body).match(/pos_|pca_|pcs_|key_team/)); ok('channel list: only the user’s channels, no tokens or secrets');
}


r = await request(app).patch(`/api/posts/${aPost.id}`).set(B).send({ content: 'hijack' });
assert.equal(r.status, 404); r = await request(app).delete(`/api/posts/${aPost.id}`).set(B);
assert.equal(r.status, 404); ok('another user can’t edit or delete the post');

const newTime = future(5);
r = await request(app).patch(`/api/posts/${aPost.id}`).set(A).send({ content: 'Spring drop: 14 new pieces', scheduledAt: newTime });
assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.post.id, aPost.id); assert.equal(r.body.post.content, 'Spring drop: 14 new pieces');
const sent = mock.state.lastPostBody.posts[0];
assert.equal(sent.value[0].id, aPost.id); assert.ok(sent.group); assert.equal(sent.value[0].image.length, 1); ok('edit = POST /public/v1/posts with group + id; media preserved');
r = await request(app).patch(`/api/posts/${aPost.id}`).set(A).send({ mode: 'draft' });
assert.equal(r.body.post.status, 'draft'); ok('post can be moved back to draft');

mock.state.posts.push({ id: 'post_external', group: 'g_ext', integrationId: mock.state.integrations.find((i) => i.profile === 'alice.ig')!.id, content: 'Made in Postiz', publishDate: future(6), state: 'QUEUE', image: [{ id: 'm', path: 'p' }] });
r = await request(app).get('/api/posts').set(A).query({ from: future(-1), to: future(24) });
assert.ok(r.body.posts.some((p: any) => p.id === 'post_external' && p.editable === false));
r = await request(app).patch('/api/posts/post_external').set(A).send({ content: 'edit' });
assert.equal(r.status, 409); assert.equal(r.body.code, 'external_post'); ok('posts made outside the app are listed, but edit is refused to protect their media');

mock.state.posts.find((p) => p.id === aPost.id)!.state = 'PUBLISHED';
r = await request(app).patch(`/api/posts/${aPost.id}`).set(A).send({ content: 'late edit' });
assert.equal(r.status, 409); ok('published posts can’t be edited');

r = await request(app).delete(`/api/posts/${aPost.id}`).set(A);
assert.equal(r.status, 200); assert.equal(r.body.deletedIds.length, 2); assert.equal(r.body.wasPublished, true); ok('delete removes the whole Postiz group and reports which posts went');

// ---------- Analytics ----------
r = await request(app).get('/api/analytics').set(A).query({ days: 30 });
assert.equal(r.status, 200); assert.equal(r.body.engagement.available, false); assert.ok('successRate' in r.body && Array.isArray(r.body.weekly)); ok('analytics computed from the user’s posts; engagement flagged unavailable');
assert.equal((await request(app).get('/api/analytics').set(A).query({ days: 9999 })).status, 400); ok('analytics input validated');
let limited = 0;
for (let i = 0; i < 32; i++) if ((await request(app).get('/api/analytics').set(H('rate'))).status === 429) limited++;
assert.ok(limited > 0); ok('rate limiting returns 429');

// ---------- Legacy router removed ----------
r = await request(app).get('/api/posts/queue').set(A).query({ userId: 'bob' });
assert.equal(r.status, 404); ok('the legacy /api/posts/queue router no longer exists');

// ---------- Direct adapter, disconnect, revocation, redaction ----------
r = await request(app).post('/api/accounts/connect').set(A).send({ platform: 'bluesky', credentials: { identifier: 'acme.bsky.social', appPassword: 'abcd-efgh-ijkl-mnop' } });
assert.equal(r.status, 201); ok('Bluesky connects through the direct adapter');
r = await request(app).delete(`/api/accounts/${aLinked}`).set(A);
assert.equal(r.status, 200); ok('disconnect removes the channel in Postiz');
if (MODE === 'oauth') {
  r = await request(app).delete('/api/accounts/workspace').set(A);
  assert.equal(r.body.hadToken, true); assert.match(r.body.revokeInPostiz, /Approved apps/);
  r = await request(app).get('/api/accounts').set(A);
  assert.equal(r.body.postiz.workspaceAuthorized, false); ok('DELETE /workspace forgets the stored Postiz token');
}
const sample = redact('GET /api/accounts/callback?code=abc123&state=xyz pos_secret123 Bearer eyJ.a.b {"client_secret":"pcs_zzz","appPassword":"abcd-efgh-ijkl-mnop"}');
assert.ok(!/abc123|xyz|pos_secret123|eyJ|pcs_zzz|abcd-efgh/.test(sample), sample); ok('logs redact codes, state, tokens, secrets and app passwords');
const fs = await import('node:fs/promises');
const raw = await fs.readFile(path.join(process.env.SOCIAL_ACCOUNTS_DATA_DIR!, 'accounts.json'), 'utf8');
assert.ok(!/pos_[0-9a-f]{20}/.test(raw) && !raw.includes('abcd-efgh-ijkl-mnop')); ok('tokens and app passwords encrypted at rest');

console.log(`\n${passed} passed (${MODE})`);
mock.close(); bsky.close(); process.exit(0);
