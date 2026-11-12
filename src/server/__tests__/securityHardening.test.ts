/**
 * Security hardening: response headers, sign-in failure monitoring, two-step sign-in and session-age
 * policy, upload checks, and that every /api mount in server.ts is protected.
 * Run: npx tsx src/server/__tests__/securityHardening.test.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import request from 'supertest';

let passed = 0; const ok = (n: string) => { passed++; console.log('  ✓', n); };
Object.assign(process.env, { NODE_ENV: 'test', SOCIAL_ACCOUNTS_DEV_AUTH: 'true', CRM_STORE: 'memory', APP_URL: 'https://app.example.com', AUTH_FAILURE_LIMIT: '5' });

const { guard, PUBLIC } = await import('../routeGuards');
const { securityHeaders, inlineScriptHashes, buildCsp } = await import('../security/headers');
const { resetLoginMonitorForTests, loginMonitorStats } = await import('../security/loginMonitor');
const { resetPolicyCacheForTests } = await import('../security/policy');
const { sniffMediaType, safeFileName, validateImageDataUrl } = await import('../security/uploads');
const { makeOrg, addMember, as } = await import('./fixtures');
const { listAudit } = await import('../audit/auditLog');

// ---- Headers ----
{
  const app = express();
  app.use(securityHeaders({ production: false }));
  app.get('/api/x', (_q, r) => r.json({ ok: 1 }));
  app.get('/api/messaging/embed/abc', (_q, r) => r.send('widget'));
  app.get('/', (_q, r) => r.send('page'));
  const a = await request(app).get('/api/x');
  assert.equal(a.headers['x-content-type-options'], 'nosniff');
  assert.equal(a.headers['x-frame-options'], 'SAMEORIGIN');
  assert.equal(a.headers['cache-control'], 'no-store');
  assert.match(a.headers['permissions-policy'], /camera=\(self\)/);
  assert.equal(a.headers['x-powered-by'], undefined);
  assert.equal(a.headers['content-security-policy-report-only'], undefined, 'no CSP in development (Vite needs inline scripts)');
  assert.equal((await request(app).get('/api/messaging/embed/abc')).headers['x-frame-options'], undefined);
  ok('nosniff, frame protection (except the embeddable chat widget), no-store on the API');

  const prod = express();
  prod.use(securityHeaders({ production: true, scriptHashes: ["'sha256-abc'"] }));
  prod.get('/', (_q, r) => r.send('page'));
  const p = await request(prod).get('/');
  assert.match(p.headers['strict-transport-security'], /max-age=31536000/);
  assert.match(p.headers['content-security-policy-report-only'], /script-src 'self' 'sha256-abc'/);
  assert.match(p.headers['content-security-policy-report-only'], /connect-src 'self' https: wss:/);
  assert.match(p.headers['content-security-policy-report-only'], /object-src 'none'/);
  process.env.CSP_ENFORCE = 'true';
  const enforced = express(); enforced.use(securityHeaders({ production: true })); enforced.get('/', (_q, r) => r.send('x'));
  assert.ok((await request(enforced).get('/')).headers['content-security-policy']);
  delete process.env.CSP_ENFORCE;
  const html = '<script>console.log(1)</script><script type="module" src="/x.js"></script>';
  assert.deepEqual(inlineScriptHashes(html), [`'sha256-${crypto.createHash('sha256').update('console.log(1)').digest('base64')}'`]);
  const built = fs.readFileSync(path.join(process.cwd(), 'index.html'), 'utf8');
  assert.equal(inlineScriptHashes(built).length, 1, 'the theme script in index.html gets a hash');
  assert.match(buildCsp(), /frame-ancestors 'self'/);
  ok('production adds HSTS and a CSP (report-only unless CSP_ENFORCE=true) that allows the inline theme script by hash');
}

// ---- Sign-in failure monitoring ----
{
  resetLoginMonitorForTests();
  const app = express(); app.use(express.json());
  app.get('/api/p', guard(PUBLIC.none), (_q, r) => r.json({ ok: true }));
  for (let i = 0; i < 4; i++) assert.equal((await request(app).get('/api/p').set('Authorization', 'Bearer not.a.token')).status, 401);
  const fifth = await request(app).get('/api/p').set('Authorization', 'Bearer not.a.token');
  assert.equal(fifth.status, 429); assert.equal(fifth.body.code, 'too_many_failed_sign_ins'); assert.ok(fifth.headers['retry-after']);
  assert.equal((await request(app).get('/api/p').set('Authorization', 'Bearer still.bad')).status, 429);
  assert.equal((await request(app).get('/api/p')).status, 401, 'requests without a credential aren’t counted or blocked');
  assert.equal((await request(app).get('/api/p').set('X-Dev-User-Id', 'ok-user')).status, 200, 'valid sign-ins from a blocked address still work');
  const s = loginMonitorStats();
  assert.equal(s.lockouts, 1); assert.ok(s.failedAttempts >= 6);
  assert.ok(!JSON.stringify(s).includes('127.0.0.1') && !JSON.stringify(s).includes('::'));
  ok('repeated bad credentials from one address get 429; valid sign-ins and anonymous requests are unaffected');
}

// ---- Two-step sign-in and session age ----
{
  resetPolicyCacheForTests();
  const app = express(); app.use(express.json());
  app.use('/api/security', guard(PUBLIC.none), (await import('../../routes/securityApi')).default);
  app.use('/api/leads', guard(PUBLIC.leads), (await import('../../routes/leadsApi')).default);
  const A = await makeOrg('own'); await addMember(A.id, 'rep', 'SALES_REP');
  const B = await makeOrg('oth');
  const TOTP = { 'X-Dev-Second-Factor': 'totp' };

  const refuse = await request(app).put('/api/security/policy').set(as('own', A.id)).send({ requireMfa: true });
  assert.equal(refuse.status, 409); assert.equal(refuse.body.code, 'enroll_first');
  ok('an admin can’t require two-step sign-in without using it themselves');
  assert.equal((await request(app).put('/api/security/policy').set(as('rep', A.id, TOTP)).send({ requireMfa: false })).status, 403);
  const on = await request(app).put('/api/security/policy').set(as('own', A.id, TOTP)).send({ requireMfa: true, idleSignOutMinutes: 30 });
  assert.equal(on.status, 200); assert.equal(on.body.policy.requireMfa, true);
  assert.ok((await listAudit(A.id, { action: 'security.policy_updated' })).entries.length === 1);
  ok('admins (with two-step) can turn it on; the change is audited');

  const blocked = await request(app).get('/api/leads').set(as('rep', A.id));
  assert.equal(blocked.status, 403); assert.equal(blocked.body.code, 'mfa_required');
  assert.equal((await request(app).get('/api/leads').set(as('rep', A.id, TOTP))).status, 200);
  const pol = await request(app).get('/api/security/policy').set(as('rep', A.id));
  assert.equal(pol.status, 200); assert.equal(pol.body.policy.requireMfa, true); assert.equal(pol.body.me.twoStep, false);
  ok('members without a second factor are refused (403 mfa_required) but can read the policy to fix it');
  assert.equal((await request(app).get('/api/leads').set(as('oth', B.id))).status, 200, 'another organization’s policy doesn’t apply');
  ok('the policy applies only to its own organization');

  await request(app).put('/api/security/policy').set(as('own', A.id, TOTP)).send({ requireMfa: false, maxSessionHours: 8 });
  const stale = String(Math.floor(Date.now() / 1000) - 9 * 3600);
  const fresh = String(Math.floor(Date.now() / 1000) - 600);
  const exp = await request(app).get('/api/leads').set(as('rep', A.id, { 'X-Dev-Auth-Time': stale }));
  assert.equal(exp.status, 401); assert.equal(exp.body.code, 'session_expired');
  assert.equal((await request(app).get('/api/leads').set(as('rep', A.id, { 'X-Dev-Auth-Time': fresh }))).status, 200);
  assert.equal((await request(app).put('/api/security/policy').set(as('own', A.id, TOTP)).send({ maxSessionHours: -1 })).status, 400);
  ok('a maximum session age makes people sign in again; invalid values are rejected');
}

// ---- Uploads ----
{
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4e00000000049454e44ae426082', 'hex');
  assert.equal(sniffMediaType(png), 'image/png');
  assert.equal(sniffMediaType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')), null);
  assert.equal(sniffMediaType(Buffer.from('<!doctype html><script>alert(1)</script>')), null);
  assert.equal(validateImageDataUrl(`data:image/png;base64,${png.toString('base64')}`).ok, true);
  assert.equal(validateImageDataUrl(`data:image/png;base64,${Buffer.from('<html><script>x</script></html>').toString('base64')}`).ok, false);
  assert.equal(validateImageDataUrl(`data:image/svg+xml;base64,${Buffer.from('<svg/>').toString('base64')}`).ok, false);
  assert.equal(validateImageDataUrl(`data:image/png;base64,${Buffer.concat([png, Buffer.alloc(800 * 1024)]).toString('base64')}`).ok, false);
  assert.equal(validateImageDataUrl('').ok, true);
  assert.equal(safeFileName('../../etc/passwd'), 'passwd');
  assert.equal(safeFileName('..\\..\\evil<script>.png'), 'evil_script_.png');
  assert.equal(safeFileName(''), 'upload');
  ok('uploads are identified by their bytes (no SVG/HTML), sized, and file names can’t carry paths');
}

// ---- Every /api mount is protected ----
{
  const src = fs.readFileSync(path.join(process.cwd(), 'server.ts'), 'utf8');
  const mounts = [...src.matchAll(/app\.use\(\s*'(\/api[^']*)'\s*,([^\n]*)\);/g)].map((m) => ({ path: m[1], rest: m[2] }));
  assert.ok(mounts.length > 30, 'found the mounts');
  // Routers that authenticate inside (each line says how) and aren't behind guard().
  const SELF_AUTH: Record<string, string> = {
    '/api/billing': 'verifies its own session token and the organization',
    '/api/v1/events': 'public embeddable calendar: per-key auth and CORS',
    '/api/v1/embed-tokens': 'embed key exchange: secret key required',
    '/api/v1': 'jwtAuthMiddleware after /health and the removed /auth/login',
  };
  // '/api' itself: the app-wide rate limit and the JSON 404 (no routes behind them).
  const unguarded = mounts.filter((m) => !/guard\(/.test(m.rest) && !(m.path === '/api' && /^\s*(notFoundHandler|apiRateLimit)\(\)\s*$/.test(m.rest)));
  for (const m of unguarded) assert.ok(SELF_AUTH[m.path], `${m.path} is mounted without guard() and isn't a known self-authenticating router`);
  ok(`every /api mount uses guard() or is a documented self-authenticating router (${mounts.length} mounts checked)`);

  const app = express(); app.use(express.json());
  app.use('/api/accounts', guard(PUBLIC.accounts), (await import('../../routes/accountsApi')).default);
  app.use('/api/analytics', guard(PUBLIC.none), (await import('../../routes/analyticsApi')).default);
  app.use('/api/local-seo', guard(PUBLIC.localSeo), (await import('../../routes/localSeoApi')).default);
  app.use('/api/voice', guard(PUBLIC.voice), (await import('../../routes/voiceIvr')).default);
  app.use('/api/posts', guard(PUBLIC.none), (await import('../../routes/postsApi')).default);
  app.use('/api/webhooks', guard(PUBLIC.paymentWebhooks), (await import('../../routes/paymentWebhooks')).default);
  for (const [m, p] of [['get', '/api/accounts'], ['get', '/api/analytics'], ['get', '/api/local-seo/connection'], ['get', '/api/voice/ivr/config'], ['get', '/api/voice/ivr/calls'], ['get', '/api/posts'], ['post', '/api/posts/upload']] as const) {
    assert.equal((await (request(app) as any)[m](p)).status, 401, `${m} ${p}`);
  }
  // Public callbacks and signed webhooks still reach their handlers (they reject on their own checks, not 401).
  for (const [m, p] of [['get', '/api/accounts/callback'], ['get', '/api/local-seo/callback'], ['post', '/api/webhooks/stripe'], ['post', '/api/voice/status']] as const) {
    assert.notEqual((await (request(app) as any)[m](p).send({})).status, 401, `${m} ${p}`);
  }
  ok('the newly guarded routers refuse signed-out callers; OAuth callbacks and signed webhooks still reach their handlers');
}

console.log(`\n${passed} passed (security hardening)`);
process.exit(0);
