/**
 * Per-user Google tokens and the /api/gcal routes (in-memory store, Google calls stubbed).
 * Run: npx tsx src/server/__tests__/googleTokens.test.ts
 */
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';

let passed = 0; const ok = (n: string) => { passed++; console.log('  ✓', n); };
Object.assign(process.env, { NODE_ENV: 'test', SOCIAL_ACCOUNTS_DEV_AUTH: 'true', CRM_STORE: 'memory', GOOGLE_TOKEN_ENCRYPTION_KEY: 'test-google-token-key-0123456789abcdef' });
delete process.env.GOOGLE_CLIENT_ID; delete process.env.GOOGLE_CLIENT_SECRET; delete process.env.APP_URL;

const { MemoryDocStore, setDocStore } = await import('../data/docStore');
const store = new MemoryDocStore(); setDocStore(store);
const gt = await import('../integrations/googleTokens');

// ---- Encryption at rest ----
await gt.saveGoogleTokens('org_a', 'alice', { accessToken: 'ya29.ALICE-ACCESS', refreshToken: '1//ALICE-REFRESH', expiryDate: Date.now() + 3600_000, email: 'alice@a.test' });
const raw = await store.get('organizations/org_a/users/alice/integrations/google');
assert.ok(raw && !JSON.stringify(raw).includes('ALICE-ACCESS') && !JSON.stringify(raw).includes('ALICE-REFRESH'));
assert.ok(raw.accessToken.iv && raw.accessToken.tag && raw.accessToken.data); ok('tokens stored under organizations/{org}/users/{user}/integrations/google, AES-256-GCM encrypted (no plaintext)');
let t = await gt.getGoogleTokens('org_a', 'alice');
assert.equal(t?.accessToken, 'ya29.ALICE-ACCESS'); assert.equal(t?.refreshToken, '1//ALICE-REFRESH'); ok('round-trips for the owner');
await gt.saveGoogleTokens('org_a', 'alice', { accessToken: 'ya29.NEW' });
t = await gt.getGoogleTokens('org_a', 'alice');
assert.equal(t?.accessToken, 'ya29.NEW'); assert.equal(t?.refreshToken, '1//ALICE-REFRESH'); ok('a refresh without a new refresh token keeps the stored one');
assert.equal(await gt.getGoogleTokens('org_a', 'bob'), null); assert.equal(await gt.getGoogleTokens('org_b', 'alice'), null);
ok('isolated per user and per organization (same user id in another org has nothing)');
const tampered = structuredClone(raw); tampered.accessToken.data = Buffer.from('xxxx').toString('base64');
await store.set('organizations/org_a/users/carol/integrations/google', tampered);
assert.equal(await gt.getGoogleTokens('org_a', 'carol'), null); ok('tampered ciphertext is rejected (treated as disconnected, no crash)');
assert.deepEqual(Object.keys(await gt.getGoogleConnection('org_a', 'alice')).sort(), ['connected', 'connectedAt', 'email', 'hasRefreshToken', 'scope']); ok('status view never includes tokens');
await assert.rejects((async () => gt.getGoogleTokens('org_a', '../x'))()); ok('unsafe ids rejected');

// ---- OAuth state ----
const st1 = await gt.createOAuthState('org_a', 'alice', 'gcal');
assert.deepEqual(await gt.consumeOAuthState(st1, 'other'), null); ok('state for another purpose is refused');
const st2 = await gt.createOAuthState('org_a', 'alice', 'gcal');
assert.deepEqual(await gt.consumeOAuthState(st2, 'gcal'), { orgId: 'org_a', userId: 'alice' });
assert.equal(await gt.consumeOAuthState(st2, 'gcal'), null); ok('state is single-use and maps back to the user who started it');
const st3 = await gt.createOAuthState('org_a', 'alice', 'gcal');
await store.update(`crm_oauth_states/${st3}`, { expiresAt: Date.now() - 1 });
assert.equal(await gt.consumeOAuthState(st3, 'gcal'), null); ok('expired state refused');
assert.equal(await gt.consumeOAuthState('../../x', 'gcal'), null); ok('malformed state refused');

// ---- Channel tokens ----
const ch = 'crm_00000000-0000-4000-8000-000000000000';
assert.ok(gt.verifyChannelToken(ch, gt.channelToken(ch))); assert.ok(!gt.verifyChannelToken(ch, 'secret_user_token_host_primary')); assert.ok(!gt.verifyChannelToken('crm_other', gt.channelToken(ch)));
ok('push-notification channel tokens verify per channel');

// ---- Routes ----
const { guard, PUBLIC } = await import('../routeGuards');
const gcal = (await import('../../routes/gcalWebhook')).default;
const app = express(); app.use(express.json()); app.use('/api/gcal', guard(PUBLIC.gcal), gcal);
const A = { 'X-Dev-User-Id': 'alice' }, B = { 'X-Dev-User-Id': 'bob' };

assert.equal((await request(app).get('/api/gcal/status')).status, 401); ok('status requires sign-in');
let r = await request(app).get('/api/gcal/status').set(A);
assert.equal(r.body.configured, false); assert.equal(r.body.connected, false); ok('not configured → says so (no fake connection)');
r = await request(app).get('/api/gcal/auth-url').set(A);
assert.equal(r.status, 503); assert.equal(r.body.code, 'google_not_configured'); ok('auth-url without Google config → 503 (no mock bypass URL)');

Object.assign(process.env, { GOOGLE_CLIENT_ID: 'cid.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'csecret', APP_URL: 'https://crm.example.test' });
r = await request(app).get('/api/gcal/auth-url').set(A);
const url = new URL(r.body.authUrl);
assert.equal(url.hostname, 'accounts.google.com'); assert.equal(url.searchParams.get('redirect_uri'), 'https://crm.example.test/api/gcal/oauth2callback');
const state = url.searchParams.get('state')!; assert.match(state, /^[A-Za-z0-9_-]{20,64}$/); ok('auth-url: real Google consent URL, redirect from APP_URL, opaque single-use state');

r = await request(app).get('/api/gcal/oauth2callback').query({ state: 'bogus-state-value-123456', code: 'x' });
assert.equal(r.status, 400); ok('callback with an unknown state → refused');
r = await request(app).get('/api/gcal/oauth2callback').query({ error: '<script>alert(1)</script>', state });
assert.equal(r.status, 400); assert.ok(!r.text.includes('<script>alert(1)</script>')); assert.match(r.headers['content-security-policy'], /default-src 'none'/);
ok('callback error page doesn’t reflect the error parameter (XSS fixed) and sends a strict CSP');

// Stub Google's token exchange and API calls for the success path.
const { google } = await import('../integrations/googleClients');
const proto: any = (google.auth.OAuth2 as any).prototype;
proto.getToken = async () => ({ tokens: { access_token: 'ya29.BOB', refresh_token: '1//BOB', expiry_date: Date.now() + 3600_000, scope: 'calendar' } });
proto.revokeToken = async () => ({});
(google as any).oauth2 = () => ({ userinfo: { get: async () => ({ data: { email: 'bob@b.test' } }) } });
(google as any).calendar = () => ({ events: { list: async () => ({ data: { items: [{ id: 'ev1', status: 'confirmed', summary: 'Private dentist visit', start: { dateTime: '2026-11-02T10:00:00Z' }, end: { dateTime: '2026-11-02T11:00:00Z' } }], nextSyncToken: 'sync1' } }), watch: async () => ({ data: { resourceId: 'res1', expiration: String(Date.now() + 86400000) } }) }, channels: { stop: async () => ({}) } });

const bobState = new URL((await request(app).get('/api/gcal/auth-url').set(B)).body.authUrl).searchParams.get('state')!;
r = await request(app).get('/api/gcal/oauth2callback').query({ state: bobState, code: 'auth-code' });
assert.equal(r.status, 200); assert.match(r.text, /Connected as bob@b\.test/);
const bobOrg = (await store.get('crm_user_memberships/bob')).defaultOrgId;
assert.equal((await gt.getGoogleTokens(bobOrg, 'bob'))?.accessToken, 'ya29.BOB'); ok('callback stores tokens for the user who started the flow, in their organization');
const synced = await store.list(`organizations/${bobOrg}/users/bob/gcal_events`);
assert.equal(synced.length, 1); assert.equal(synced[0].summary, 'Busy'); ok('first sync stores busy blocks only (event titles stay in Google)');
r = await request(app).get('/api/gcal/oauth2callback').query({ state: bobState, code: 'auth-code' });
assert.equal(r.status, 400); ok('the same callback link can’t be replayed');

r = await request(app).get('/api/gcal/status').set(A);
assert.equal(r.body.connected, false); ok('alice still sees her own (unconnected) status, not bob’s');
r = await request(app).get('/api/gcal/status').set(B);
assert.equal(r.body.connected, true); assert.equal(r.body.email, 'bob@b.test'); assert.ok(!JSON.stringify(r.body).includes('ya29')); ok('bob sees his connection, without tokens');

// Push notifications
const chan = (await store.list('crm_gcal_channels'))[0];
assert.ok(chan, 'watch channel registered'); assert.equal(chan.userId, 'bob');
assert.equal((await request(app).post('/api/gcal/webhook').set({ 'x-goog-channel-id': chan.channelId, 'x-goog-channel-token': 'forged', 'x-goog-resource-state': 'exists' })).status, 401);
assert.equal((await request(app).post('/api/gcal/webhook').set({ 'x-goog-channel-id': chan.channelId, 'x-goog-channel-token': gt.channelToken(chan.channelId), 'x-goog-resource-state': 'exists' })).status, 200);
ok('webhook accepts only the per-channel token (the old one was a guessable "secret_user_token_<id>")');

// Disconnect
r = await request(app).delete('/api/gcal/connection').set(B);
assert.equal(r.status, 200); assert.equal(await gt.getGoogleTokens(bobOrg, 'bob'), null);
assert.equal((await store.list(`organizations/${bobOrg}/users/bob/gcal_events`)).length, 0); assert.equal((await store.list('crm_gcal_channels')).length, 0);
ok('disconnect revokes, stops the channel, and deletes tokens and synced data');

console.log(`\n${passed} passed (google tokens)`);
process.exit(0);
