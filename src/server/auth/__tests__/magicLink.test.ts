/**
 * Email sign-in links: uniform responses (no account enumeration), per-address and per-IP limits, hashed
 * storage, single use (including concurrent attempts), expiry, tampering, disabled and two-step accounts,
 * configuration errors, and the development mail path never being active in production.
 * Run: npx tsx src/server/auth/__tests__/magicLink.test.ts
 */
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';

Object.assign(process.env, { NODE_ENV: 'test', SOCIAL_ACCOUNTS_DEV_AUTH: 'true', CRM_STORE: 'memory', APP_URL: 'https://crm.example.test', MAGIC_LINK_IP_LIMIT: '1000' });
const { MemoryDocStore, setDocStore } = await import('../../data/docStore');
const store = new MemoryDocStore(); setDocStore(store);
const { setMailerForTests, devMailLogEnabled } = await import('../../email/mailer');
const { setIdentityProviderForTests } = await import('../identity');
const ml = await import('../magicLink');
const { errorHandler, installAsyncErrorForwarding, requestContext } = await import('../../http/middleware');
const { guard, PUBLIC } = await import('../../routeGuards');
const { setLogSinkForTests } = await import('../../http/logger');
setLogSinkForTests(() => {});
installAsyncErrorForwarding();

let passed = 0; const ok = (n: string) => { passed++; console.log('  ✓', n); };

// ---- Stand-ins for Firebase Auth and SMTP ----
const accounts: Record<string, { uid: string; disabled: boolean; hasSecondFactor: boolean }> = {
  'ann@acme.test': { uid: 'uid_ann', disabled: false, hasSecondFactor: false },
  'off@acme.test': { uid: 'uid_off', disabled: true, hasSecondFactor: false },
  'mfa@acme.test': { uid: 'uid_mfa', disabled: false, hasSecondFactor: true },
};
const byUid = (uid: string) => Object.values(accounts).find((a) => a.uid === uid) ?? null;
let tokenCalls: string[] = [];
let failTokens = false;
const identity = {
  configured: true,
  findByEmail: async (e: string) => accounts[e] ?? null,
  getById: async (uid: string) => byUid(uid),
  createSignInToken: async (uid: string) => { if (failTokens) throw new Error('no signing permission'); tokenCalls.push(uid); return `custom-token-for-${uid}`; },
};
setIdentityProviderForTests(identity);
const outbox: Array<{ to: string; subject: string; text: string; html?: string }> = [];
setMailerForTests({ mode: 'smtp', send: async (m) => { outbox.push(m); return { ok: true, provider: 'test' }; } });

const app = express();
app.use(requestContext());
app.use(express.json());
app.use('/api/auth/magic-link', guard(PUBLIC.magicLink), (await import('../../../routes/magicLinkApi')).default);
app.use(errorHandler());

const settle = () => new Promise((r) => setTimeout(r, 10));
/** The per-address limit (3 per 15 minutes) is tested on its own; other sections start with a clean count. */
const resetThrottle = async () => { const data: Map<string, unknown> = (store as any).data; for (const k of [...data.keys()]) if (k.startsWith('auth_magic_link_throttle/')) data.delete(k); };
const linkToken = (text: string) => { const m = text.match(/\/auth\/magic#token=([A-Za-z0-9_-]{43})/); assert.ok(m, 'email contains a link'); return m![1]; };
const ask = (email: string) => request(app).post('/api/auth/magic-link/request').send({ email });
const redeem = (token: string) => request(app).post('/api/auth/magic-link/verify').send({ token });

// ---- Status ----
{
  const r = await request(app).get('/api/auth/magic-link/status');
  assert.equal(r.status, 200); assert.equal(r.body.enabled, true); assert.equal(r.headers['cache-control'], 'no-store');
  ok('status: enabled when sign-in, email and APP_URL are configured (public, no-store)');
}

// ---- Uniform responses (no enumeration) ----
{
  const bodies = [];
  for (const e of ['ann@acme.test', 'nobody@acme.test', 'off@acme.test', 'mfa@acme.test', 'ANN@ACME.TEST']) {
    const r = await ask(e);
    assert.equal(r.status, 202, e);
    bodies.push(JSON.stringify({ success: r.body.success, message: r.body.message }));
  }
  assert.equal(new Set(bodies).size, 1, 'identical bodies for existing, unknown, disabled and two-step addresses');
  await settle();
  assert.deepEqual(outbox.map((m) => m.to).sort(), ['ann@acme.test', 'ann@acme.test', 'mfa@acme.test']);
  assert.ok(outbox.find((m) => m.to === 'mfa@acme.test')!.text.includes('two-step'), 'two-step accounts get an explanation, not a link');
  assert.ok(!/token=/.test(outbox.find((m) => m.to === 'mfa@acme.test')!.text));
  ok('same 202 and message for existing, unknown, disabled and two-step accounts; only real, eligible accounts get a link');
}

// ---- Stored safely; link format ----
{
  const mail = outbox.find((m) => m.to === 'ann@acme.test')!;
  assert.match(mail.text, /^https:\/\/crm\.example\.test\/auth\/magic#token=/m);
  assert.match(mail.text, /expires in 15 minutes/);
  const token = linkToken(mail.text);
  const docs = await store.list('auth_magic_links');
  assert.ok(docs.length >= 1);
  const raw = JSON.stringify(docs);
  assert.ok(!raw.includes(token), 'the raw token is never stored');
  assert.ok(!raw.includes('ann@acme.test'), 'the address is not stored with the token');
  assert.ok(await store.get(`auth_magic_links/${ml.hashToken(token)}`), 'stored under its SHA-256');
  assert.equal(Buffer.from(token, 'base64url').length, 32, '256-bit token');
  ok('token: 32 random bytes in the URL fragment; only its SHA-256 is stored, without the email address');
}

// ---- Single use ----
{
  await resetThrottle(); outbox.length = 0; tokenCalls = [];
  await ask('ann@acme.test'); await settle();
  const token = linkToken(outbox[0].text);
  const first = await redeem(token);
  assert.equal(first.status, 200); assert.equal(first.body.customToken, 'custom-token-for-uid_ann');
  const again = await redeem(token);
  assert.equal(again.status, 400); assert.equal(again.body.code, 'invalid_or_expired_link');
  ok('a link signs in once (credential for that account only); a second use is refused');

  await resetThrottle(); outbox.length = 0; tokenCalls = [];
  await ask('ann@acme.test'); await settle();
  const t2 = linkToken(outbox[0].text);
  const results = await Promise.all([redeem(t2), redeem(t2), redeem(t2)]);
  assert.equal(results.filter((r) => r.status === 200).length, 1, 'exactly one concurrent attempt wins');
  assert.equal(tokenCalls.length, 1);
  ok('concurrent redemptions of one link: exactly one succeeds');
}

// ---- Expiry, tampering, account changes ----
{
  const now = Date.now();
  await resetThrottle(); outbox.length = 0;
  await ml.requestMagicLink('ann@acme.test', { now: () => now });
  await settle();
  const token = linkToken(outbox[0].text);
  await assert.rejects(ml.verifyMagicLink(token, { now: () => now + ml.ttlMs() + 1 }), (e: any) => e.code === 'invalid_or_expired_link');
  assert.equal(await store.get(`auth_magic_links/${ml.hashToken(token)}`), null, 'expired records are removed when tried');
  ok('expired links are refused (and removed)');

  await resetThrottle(); outbox.length = 0;
  await ask('ann@acme.test'); await settle();
  const good = linkToken(outbox[0].text);
  const tampered = good.slice(0, -1) + (good.endsWith('A') ? 'B' : 'A');
  for (const t of [tampered, 'short', '', 'x'.repeat(43), `${good}extra`]) assert.equal((await redeem(t)).status, 400, t);
  assert.equal((await request(app).post('/api/auth/magic-link/verify').send({})).status, 400);
  assert.equal((await redeem(good)).status, 200, 'the untampered link still works');
  ok('tampered, truncated or made-up tokens → 400 (same error); the real one still works');

  await resetThrottle(); outbox.length = 0;
  await ask('ann@acme.test'); await settle();
  const t = linkToken(outbox[0].text);
  accounts['ann@acme.test'].disabled = true;
  assert.equal((await redeem(t)).status, 400, 'account disabled after the link was sent');
  accounts['ann@acme.test'].disabled = false;
  ok('an account disabled after the link was sent can\'t use it');

  await resetThrottle(); outbox.length = 0;
  await ask('ann@acme.test'); await settle();
  const t3 = linkToken(outbox[0].text);
  accounts['ann@acme.test'].hasSecondFactor = true;
  const r = await redeem(t3);
  assert.equal(r.status, 403); assert.equal(r.body.code, 'second_factor_required');
  accounts['ann@acme.test'].hasSecondFactor = false;
  ok('enrolling two-step after the link was sent: the link can\'t bypass it (403)');

  await resetThrottle(); outbox.length = 0; failTokens = true;
  await ask('ann@acme.test'); await settle();
  const t4 = linkToken(outbox[0].text);
  const r4 = await redeem(t4);
  assert.equal(r4.status, 503); assert.equal(r4.body.code, 'sign_in_unavailable');
  assert.ok(!JSON.stringify(r4.body).includes('signing permission'), 'internal reason not exposed');
  failTokens = false;
  ok('if the identity provider can\'t issue a credential: 503 with a safe message');
}

// ---- Limits ----
{
  await resetThrottle(); outbox.length = 0;
  const statuses = [];
  for (let i = 0; i < 5; i++) statuses.push((await ask('ann@acme.test')).status);
  await settle();
  assert.deepEqual(statuses, [202, 202, 202, 202, 202], 'throttling doesn\'t change the response');
  assert.equal(outbox.length, 3, 'at most 3 links per address per 15 minutes');
  ok('per address: at most 3 links per 15 minutes, silently (no enumeration through limits)');

  const limitedApp = express();
  limitedApp.use(requestContext()); limitedApp.use(express.json());
  process.env.MAGIC_LINK_IP_LIMIT = '2';
  const fresh = (await import(`../../../routes/magicLinkApi?ip=${Date.now()}`)).default;
  limitedApp.use('/api/auth/magic-link', fresh); limitedApp.use(errorHandler());
  const resps = [];
  for (let i = 0; i < 3; i++) resps.push(await request(limitedApp).post('/api/auth/magic-link/request').send({ email: `p${i}@x.test` }));
  assert.deepEqual(resps.map((r) => r.status), [202, 202, 429]);
  assert.ok(Number(resps[2].headers['retry-after']) > 0); assert.equal(resps[2].body.code, 'rate_limited');
  process.env.MAGIC_LINK_IP_LIMIT = '1000';
  ok('per IP: requests over the limit get 429 with Retry-After');
}

// ---- Validation and configuration ----
{
  for (const bad of ['', 'not-an-email', 'a@b', `${'x'.repeat(250)}@x.test`]) {
    const r = await ask(bad);
    assert.equal(r.status, 400, bad); assert.equal(r.body.code, 'invalid_email');
  }
  assert.equal((await request(app).post('/api/auth/magic-link/request').send({ email: 42 })).status, 400);
  ok('invalid addresses → 400 invalid_email (input errors only, not account status)');

  setMailerForTests({ mode: null, send: async () => ({ ok: false, reason: 'not_configured' }) });
  let r = await ask('ann@acme.test');
  assert.equal(r.status, 503); assert.equal(r.body.code, 'magic_link_not_configured');
  assert.equal((await request(app).get('/api/auth/magic-link/status')).body.reason, 'email_not_configured');
  setMailerForTests({ mode: 'smtp', send: async (m) => { outbox.push(m); return { ok: true, provider: 'test' }; } });
  setIdentityProviderForTests({ ...identity, configured: false });
  r = await ask('ann@acme.test');
  assert.equal(r.status, 503);
  setIdentityProviderForTests(identity);
  ok('without email or sign-in configured: 503 magic_link_not_configured for everyone (says nothing about accounts)');

  const prev = process.env.NODE_ENV;
  process.env.MAIL_DEV_LOG = 'true';
  process.env.NODE_ENV = 'production';
  assert.equal(devMailLogEnabled(), false, 'never in production');
  process.env.NODE_ENV = 'development';
  assert.equal(devMailLogEnabled(), true);
  process.env.NODE_ENV = prev; delete process.env.MAIL_DEV_LOG;
  const prevUrl = process.env.APP_URL; delete process.env.APP_URL; process.env.NODE_ENV = 'production';
  assert.equal(ml.magicLinkStatus().reason, 'app_url_not_configured', 'production needs APP_URL (never derived from Host)');
  process.env.APP_URL = prevUrl; process.env.NODE_ENV = prev;
  ok('the development mail log is off in production, and production needs APP_URL');
}

console.log(`\n${passed} passed (magic links)`);
process.exit(0);
