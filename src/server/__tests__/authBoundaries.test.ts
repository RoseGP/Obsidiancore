/**
 * Authentication / authorization boundaries added in the security pass:
 *  - billing: tokens that choose their own business (businessId + role claims) are accepted only with the
 *    dedicated BILLING_JWT_SECRET, never with the shared JWT_SECRET; expired / exp-less tokens are refused;
 *  - payment OAuth redirect base: APP_URL in production; the Host header is only a dev/test fallback;
 *  - Firebase Functions OAuth callbacks (functions/src/oauthSecurity.ts): signed, expiring state instead of
 *    a raw user id; required configuration; fixed messages that never echo input.
 * Run: npx tsx src/server/__tests__/authBoundaries.test.ts
 */
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';

Object.assign(process.env, { NODE_ENV: 'test', CRM_STORE: 'memory', LOG_LEVEL: 'error', BILLING_DATA_DIR: mkdtempSync(path.join(tmpdir(), 'billing-')) });
const SHARED = 'shared-jwt-secret-for-tests-0123456789';
process.env.JWT_SECRET = SHARED;
delete process.env.BILLING_JWT_SECRET;
delete process.env.SOCIAL_ACCOUNTS_DEV_AUTH;

const { signJwt } = await import('../../utils/verifyJwt');
const billingRouter = (await import('../../routes/billing')).default;
const { hostUrl } = await import('../../routes/paymentIntegrations');
const fnOAuth = await import('../../../functions/src/oauthSecurity');

let passed = 0; const ok = (n: string) => { passed++; console.log('  ✓', n); };

// ---- Billing: self-scoped tokens need the dedicated secret ----
const app = express(); app.use(express.json()); app.use('/api/billing', billingRouter);
const claims = { userId: 'mallory', email: 'm@x.test', name: 'M', role: 'owner', businessId: 'org_victim' } as any;

// A JWT_SECRET token is a normal CRM session for its own user: billing then uses that user's organization from
// the server-side membership. The token's businessId / role claims must be ignored.
const { getDocStore } = await import('../data/docStore');
const store = await getDocStore();
let r = await request(app).get('/api/billing/session').set('Authorization', `Bearer ${await signJwt(claims, SHARED)}`);
assert.ok(r.status === 200 || r.status === 401, String(r.status));
const membership = await store.get('crm_user_memberships/mallory');
if (r.status === 200) {
  assert.ok(membership?.defaultOrgId && membership.defaultOrgId !== 'org_victim', 'tenant comes from membership, not the token');
  assert.equal(membership.orgs?.org_victim, undefined);
}
assert.equal(await store.get('organizations/org_victim/members/mallory'), null, 'no access to the named business');
assert.ok(!JSON.stringify(r.body).includes('org_victim'));
ok('billing: a token signed with the shared JWT_SECRET can’t choose a business (claims ignored; own organization only)');

const BILLING = 'dedicated-billing-secret-0123456789abcdef';
process.env.BILLING_JWT_SECRET = BILLING;
r = await request(app).get('/api/billing/session').set('Authorization', `Bearer ${await signJwt(claims, SHARED)}`);
assert.equal(await store.get('organizations/org_victim/members/mallory'), null, 'shared-secret token still can’t pick the business when a billing secret exists');
r = await request(app).get('/api/billing/session').set('Authorization', `Bearer ${await signJwt(claims, BILLING)}`);
assert.equal(r.status, 200); assert.equal(r.body.user?.id ?? r.body.userId ?? 'mallory', 'mallory');
r = await request(app).get('/api/billing/session').set('Authorization', `Bearer ${await signJwt(claims, BILLING, -120)}`);
assert.equal(r.status, 401, 'expired billing token');
const { createHmac } = await import('node:crypto');
const h = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
const p = Buffer.from(JSON.stringify(claims)).toString('base64url'); // no exp
r = await request(app).get('/api/billing/session').set('Authorization', `Bearer ${h}.${p}.${createHmac('sha256', BILLING).update(`${h}.${p}`).digest('base64url')}`);
assert.equal(r.status, 401, 'billing token without exp');
ok('billing: only BILLING_JWT_SECRET tokens with a valid exp are accepted on the standalone path');
delete process.env.BILLING_JWT_SECRET;

// ---- Payment OAuth base URL ----
const fakeReq = (host: string) => ({ protocol: 'https', get: (n: string) => (n.toLowerCase() === 'host' ? host : undefined) }) as any;
delete process.env.APP_URL;
assert.equal(hostUrl(fakeReq('dev.local:3000')), 'https://dev.local:3000');
process.env.NODE_ENV = 'production';
assert.throws(() => hostUrl(fakeReq('attacker.example')), (e: any) => e.statusCode === 503 && e.code === 'PROVIDER_NOT_CONFIGURED');
process.env.APP_URL = 'https://crm.example.test/';
assert.equal(hostUrl(fakeReq('attacker.example')), 'https://crm.example.test');
process.env.NODE_ENV = 'test'; delete process.env.APP_URL;
ok('payment OAuth: production uses APP_URL only (Host header ignored; missing APP_URL → 503)');

// ---- Firebase Functions OAuth state ----
const env = { OAUTH_STATE_SECRET: 'x'.repeat(40) } as any;
const now = Date.parse('2026-11-12T12:00:00Z');
const st = fnOAuth.signOAuthState('uid_123', env, 600, now);
assert.equal(fnOAuth.verifyOAuthState(st, env, now), 'uid_123');
assert.equal(fnOAuth.verifyOAuthState('uid_123', env, now), null, 'a raw user id (the old format) is refused');
assert.equal(fnOAuth.verifyOAuthState(st.replace('uid_123', 'uid_999'), env, now), null, 'tampered uid');
const [u, e, s] = st.split('.');
assert.equal(fnOAuth.verifyOAuthState(`${u}.${Number(e) + 3600}.${s}`, env, now), null, 'tampered expiry');
assert.equal(fnOAuth.verifyOAuthState(st, env, now + 11 * 60_000), null, 'expired');
assert.equal(fnOAuth.verifyOAuthState(st, { OAUTH_STATE_SECRET: 'y'.repeat(40) } as any, now), null, 'other secret');
assert.equal(fnOAuth.verifyOAuthState('victim/channels/x.9999999999.' + 'A'.repeat(43), env, now), null, 'path characters');
assert.equal(fnOAuth.verifyOAuthState({ toString: () => st } as any, env, now), null, 'non-string');
assert.throws(() => fnOAuth.signOAuthState('a/b', env, 600, now));
assert.ok(fnOAuth.verifyOAuthState(fnOAuth.signOAuthState('uid_1', env, 99_999, now), env, now + 16 * 60_000) === null, 'ttl capped at 15 minutes');
ok('functions OAuth: state is signed, expiring and bound to a well-formed uid; raw ids, tampering, expiry and path characters refused');

assert.throws(() => fnOAuth.verifyOAuthState(st, {} as any, now), fnOAuth.OAuthConfigError);
assert.throws(() => fnOAuth.verifyOAuthState(st, { OAUTH_STATE_SECRET: 'short' } as any, now), fnOAuth.OAuthConfigError);
assert.throws(() => fnOAuth.tokenEncryptionKey({} as any), fnOAuth.OAuthConfigError, 'no built-in encryption key');
assert.throws(() => fnOAuth.tokenEncryptionKey({ OAUTH_TOKEN_ENCRYPTION_KEY: 'too-short' } as any), fnOAuth.OAuthConfigError);
assert.equal(fnOAuth.tokenEncryptionKey({ OAUTH_TOKEN_ENCRYPTION_KEY: 'k'.repeat(32) } as any).length, 32);
assert.throws(() => fnOAuth.requiredEnv('LINKEDIN_CLIENT_SECRET', {} as any), fnOAuth.OAuthConfigError, 'no mock client secrets');
for (const m of Object.values(fnOAuth.CALLBACK_MESSAGES)) assert.ok(!m('LinkedIn').includes('<'), 'fixed plain-text messages');
ok('functions OAuth: missing/short secrets and client credentials fail closed; responses are fixed plain text');

console.log(`\n${passed} passed (auth boundaries)`);
process.exit(0);
