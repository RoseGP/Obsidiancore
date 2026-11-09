/** End-to-end test of /api/local-seo against a mock Google. Run: npx tsx src/features/gbp/__tests__/localSeo.test.ts */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { startMockGoogle } from './mockGoogle';

let passed = 0; const ok = (n: string) => { passed++; console.log('  ✓', n); };
const APP_URL = 'https://crm.test';
const g = await startMockGoogle({ clientId: 'cid.apps.googleusercontent.com', clientSecret: 'gsecret' });
const dataDir = mkdtempSync(path.join(tmpdir(), 'gbp-'));
Object.assign(process.env, {
  NODE_ENV: 'test', SOCIAL_ACCOUNTS_DEV_AUTH: 'true', SOCIAL_ACCOUNTS_STORE: 'file', SOCIAL_ACCOUNTS_DATA_DIR: dataDir, SOCIAL_ACCOUNTS_ENCRYPTION_KEY: 'k'.repeat(40),
  APP_URL, GOOGLE_CLIENT_ID: 'cid.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'gsecret', GOOGLE_GBP_REDIRECT_URI: `${APP_URL}/api/local-seo/callback`,
  GBP_TEST_BASES: JSON.stringify({ auth: g.base, oauth: g.base, accounts: g.base, info: g.base, perf: g.base, v4: g.base }),
});
delete process.env.GEMINI_API_KEY;
const app = express(); app.use(express.json());
app.use('/api/local-seo', (await import('../../../routes/localSeoApi')).default);
const { redact } = await import('../../social-accounts/server/http');
const A = { 'X-Dev-User-Id': 'alice', Origin: APP_URL }; const B = { 'X-Dev-User-Id': 'bob', Origin: APP_URL };
const cookieOf = (r: request.Response) => String(([] as string[]).concat(r.headers['set-cookie'] as any ?? []).find((c) => c.startsWith('gbp_oauth_state=')) ?? '').split(';')[0];

async function connect(user: Record<string, string>, extra = '') {
  const s = await request(app).post('/api/local-seo/connect').set(user).send({});
  const consent = await fetch(s.body.url + extra, { redirect: 'manual' });
  const cb = new URL(consent.headers.get('location')!);
  return { start: s, cookie: cookieOf(s), cbPath: cb.pathname + cb.search };
}

assert.equal((await request(app).get('/api/local-seo/overview')).status, 401);
assert.equal((await request(app).post('/api/local-seo/connect').set('X-Dev-User-Id', 'alice').send({})).status, 403); ok('requires login; writes require the app’s Origin');

let c = await connect(A);
const authUrl = new URL(c.start.body.url);
assert.equal(authUrl.searchParams.get('access_type'), 'offline'); assert.equal(authUrl.searchParams.get('code_challenge_method'), 'S256');
assert.ok(authUrl.searchParams.get('scope')!.includes('business.manage')); assert.ok(!c.start.body.url.includes('gsecret')); ok('consent URL: offline access, PKCE S256, business.manage scope, no secret');
assert.match(([] as string[]).concat(c.start.headers['set-cookie'] as any).join(';'), /HttpOnly.*SameSite=Lax|SameSite=Lax.*HttpOnly/);
let r = await request(app).get(c.cbPath).set('Cookie', 'gbp_oauth_state=wrong');
assert.match(r.headers.location, /gbp_reason=state_mismatch/); ok('callback rejects mismatched state cookie');
r = await request(app).get(c.cbPath).set('Cookie', c.cookie);
assert.match(r.headers.location, /^https:\/\/crm\.test\/\?view=gbp&gbp=connected/); ok('code exchanged server-side (PKCE verified by Google stand-in); redirected to the app');
r = await request(app).get(c.cbPath).set('Cookie', c.cookie);
assert.match(r.headers.location, /gbp_reason=expired/); ok('duplicate callback rejected');
const d = await connect(B, '&deny=1');
r = await request(app).get(d.cbPath).set('Cookie', d.cookie);
assert.match(r.headers.location, /gbp=cancelled/); ok('declined consent reported as cancelled');

r = await request(app).get('/api/local-seo/connection').set(A);
assert.equal(r.body.connected, true); assert.equal(r.body.email, 'owner@biz.example'); assert.equal(r.body.aiConfigured, false); ok('connection status shows the Google account');

r = await request(app).post('/api/local-seo/locations/discover').set(A).send({});
assert.equal(r.status, 200); assert.equal(r.body.length, 2); ok('accounts → locations discovered (readMask sent)');
r = await request(app).put('/api/local-seo/locations/selection').set(A).send({ locationNames: ['locations/9999'] });
assert.equal(r.status, 404); ok('can’t select a location outside the user’s Google account');
r = await request(app).put('/api/local-seo/locations/selection').set(A).send({ locationNames: ['locations/1001'] });
assert.deepEqual(r.body, ['locations/1001']);
r = await request(app).post('/api/local-seo/sync').set(A).send({});
assert.equal(r.body.reviews, 3); assert.deepEqual(r.body.errors, []); ok('sync pulls reviews for selected locations only');

r = await request(app).get('/api/local-seo/reviews').set(A).query({ status: 'unanswered' });
assert.equal(r.body.length, 3);
const neg = r.body.find((x: any) => x.rating === 2);
assert.equal(neg.sentiment, 'Negative'); assert.ok(neg.topics.includes('Wait time')); ok('reviews carry sentiment + topics (rule-based estimate)');
r = await request(app).get('/api/local-seo/reviews').set(B);
assert.equal(r.body.length, 0);
r = await request(app).put(`/api/local-seo/reviews/${neg.id}/reply`).set(B).send({ comment: 'hijack' });
assert.equal(r.status, 409); ok('another user can’t see or reply to the reviews');

r = await request(app).post(`/api/local-seo/reviews/${neg.id}/draft`).set(A).send({});
assert.equal(r.status, 503); assert.equal(r.body.code, 'ai_not_configured'); ok('no AI key → honest 503, no canned reply');

r = await request(app).put(`/api/local-seo/reviews/${neg.id}/reply`).set(A).send({ comment: 'We’re sorry about the wait, Tom. Please ask for the practice manager on your next visit.' });
assert.equal(r.status, 200); assert.ok(r.body.reply.comment.startsWith('We’re sorry')); assert.ok(g.state.replies.size === 1); ok('approved reply published to Google (v4 PUT …/reply)');
r = await request(app).put(`/api/local-seo/reviews/${neg.id}/reply`).set(A).send({ comment: 'x'.repeat(4097) });
assert.equal(r.status, 400); ok('reply over Google’s 4,096-byte limit rejected');
r = await request(app).delete(`/api/local-seo/reviews/${neg.id}/reply`).set(A);
assert.equal(r.status, 200); assert.equal(g.state.replies.size, 0); ok('reply deleted at Google');

r = await request(app).get('/api/local-seo/overview').set(A);
const loc = r.body.locations[0];
assert.ok(loc.audit.score > 0 && loc.audit.score < 100); assert.ok(loc.audit.checks.some((x: any) => x.id === 'description' && !x.passed)); ok('profile health audit computed from real fields (description too short flagged)');
r = await request(app).put('/api/local-seo/settings').set(A).send({ brandVoice: 'professional', signOff: 'The Ada team' });
assert.equal(r.status, 200);
assert.deepEqual((await request(app).get('/api/local-seo/connection').set(A)).body.settings, { brandVoice: 'professional', signOff: 'The Ada team' });
assert.equal((await request(app).put('/api/local-seo/settings').set(A).send({ brandVoice: 'shouty' })).status, 400);
assert.equal((await request(app).put('/api/local-seo/settings').set(A).send({ brandVoice: 'casual', isAdmin: true })).status, 400);
assert.notEqual((await request(app).get('/api/local-seo/connection').set(B)).body.settings?.signOff, 'The Ada team');
ok('reply-style settings are saved per user, validated, and shown in the connection (settings screen)');

r = await request(app).get('/api/local-seo/performance').set(A).query({ location: 'locations/1001', days: 30 });
assert.equal(r.body.totals.calls, 15); assert.equal(r.body.totals.impressions, 60); assert.equal(r.body.daily.length, 2); ok('Performance API metrics summed (impressions, calls, clicks, directions)');
r = await request(app).get('/api/local-seo/performance').set(A).query({ location: 'locations/1002', days: 30 });
assert.equal(r.status, 404); ok('performance only for managed locations');

r = await request(app).post('/api/local-seo/posts').set(A).send({ location: 'locations/1001', summary: 'Teeth whitening appointments open this month.', ctaType: 'BOOK' });
assert.equal(r.status, 400); assert.equal(r.body.field, 'ctaUrl');
r = await request(app).post('/api/local-seo/posts').set(A).send({ location: 'locations/1001', summary: 'Teeth whitening appointments open this month.', ctaType: 'BOOK', ctaUrl: 'https://acme.example/book' });
assert.equal(r.status, 200); assert.equal(g.state.posts[0].callToAction.actionType, 'BOOK'); ok('Google post published (v4 localPosts), CTA validated');

r = await request(app).patch('/api/local-seo/locations/profile').set(A).send({ location: 'locations/1001', description: 'Family and cosmetic dentistry in downtown Austin.' });
assert.equal(r.status, 200); assert.equal(g.state.lastPatch.mask, 'profile.description'); ok('profile update sends only the changed field in updateMask');

g.state.access.clear(); // force expiry of every access token
r = await request(app).get('/api/local-seo/posts').set(A).query({ location: 'locations/1001' });
// cached token is rejected by Google → mapped error; next call refreshes because we expire it locally too
const before = g.state.refreshCalls;
const files = JSON.parse(readFileSync(path.join(dataDir, 'gbp.json'), 'utf8'));
files.alice.google.accessExpiresAt = 0; (await import('node:fs')).writeFileSync(path.join(dataDir, 'gbp.json'), JSON.stringify(files));
r = await request(app).get('/api/local-seo/posts').set(A).query({ location: 'locations/1001' });
assert.equal(r.status, 200); assert.equal(g.state.refreshCalls, before + 1); ok('expired access token refreshed with the stored refresh token');

const raw = readFileSync(path.join(dataDir, 'gbp.json'), 'utf8');
assert.ok(!/ya29\.[0-9a-f]{10}/.test(raw) && !/1\/\/[0-9a-f]{10}/.test(raw)); ok('Google tokens encrypted at rest');
assert.ok(!/ya29\.abc|1\/\/xyz/.test(redact('token ya29.abcdef refresh 1//xyzxyz {"refresh_token":"1//q"}'))); ok('logs redact Google access and refresh tokens');

g.state.refreshFails = true;
files.alice = JSON.parse(readFileSync(path.join(dataDir, 'gbp.json'), 'utf8')).alice; files.alice.google.accessExpiresAt = 0;
(await import('node:fs')).writeFileSync(path.join(dataDir, 'gbp.json'), JSON.stringify(files));
r = await request(app).post('/api/local-seo/sync').set(A).send({});
assert.equal(r.status, 409); assert.equal(r.body.code, 'reconnect_required');
r = await request(app).get('/api/local-seo/connection').set(A);
assert.equal(r.body.needsReconnect, true); ok('revoked refresh token → reconnect required');

g.state.refreshFails = false;
c = await connect(A); await request(app).get(c.cbPath).set('Cookie', c.cookie);
const n = g.state.revoked.length;
r = await request(app).delete('/api/local-seo/connection').set(A);
assert.equal(r.body.revokedAtGoogle, true); assert.equal(g.state.revoked.length, n + 1); assert.match(g.state.revoked[n], /^1\/\//);
r = await request(app).get('/api/local-seo/connection').set(A);
assert.equal(r.body.connected, false); ok('disconnect revokes the refresh token at Google and deletes local data');

g.state.grantScope = 'openid email';
c = await connect(A);
r = await request(app).get(c.cbPath).set('Cookie', c.cookie);
assert.match(r.headers.location, /gbp_reason=scope_denied/); ok('consent without business.manage is refused (token revoked)');

console.log(`\n${passed} passed (local seo)`);
g.close(); process.exit(0);
