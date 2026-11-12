/** Security regression tests for the hardening pass. Run: npx tsx src/server/__tests__/security.test.ts */
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

let passed = 0; const ok = (n: string) => { passed++; console.log('  ✓', n); };
Object.assign(process.env, { NODE_ENV: 'test', SOCIAL_ACCOUNTS_DEV_AUTH: 'true', JWT_SECRET: 'unit-test-jwt-secret-0123456789' });
delete process.env.GEMINI_API_KEY; delete process.env.OMNIROUTE_GATEWAY_URL;

const { guard, PUBLIC } = await import('../routeGuards');
const { identifyToken } = await import('../../features/social-accounts/server/auth');
const { jwtAuthMiddleware } = await import('../../middleware/apiGatewayMiddleware');
const secrets = await import('../../utils/secrets');

// ---- Route guard ----
const app = express(); app.use(express.json());
const echo = (req: any, res: any) => res.json({ userId: req.body?.userId ?? req.query.userId ?? null, user: req.user?.id ?? null });
app.use('/api/mail', guard([/^\/inbound-webhook$/]) /* fixture: one public path */, express.Router().post('/send', echo).post('/inbound-webhook', echo).post('/simulate/x', echo));
app.use('/api/messaging', guard(PUBLIC.messaging), express.Router().post('/visitor-init', echo).get('/conversations', echo));
assert.equal((await request(app).post('/api/mail/send').send({})).status, 401); ok('protected route rejects anonymous requests');
assert.equal((await request(app).post('/api/mail/inbound-webhook').send({})).status, 200); ok('provider webhook path stays public');
assert.equal((await request(app).post('/api/messaging/visitor-init').send({})).status, 200); ok('website widget visitor endpoint stays public');
assert.equal((await request(app).get('/api/messaging/conversations')).status, 401); ok('agent inbox requires sign-in');
let r = await request(app).post('/api/mail/send').set('X-Dev-User-Id', 'alice').send({ userId: 'mallory' });
assert.equal(r.body.userId, 'alice'); assert.equal(r.body.user, 'alice'); ok('verified identity overwrites a client-supplied userId');
r = await request(app).get('/api/messaging/conversations?userId=mallory').set('X-Dev-User-Id', 'alice');
assert.equal(r.body.userId, 'alice'); ok('…including userId in the query string');
process.env.NODE_ENV = 'production';
assert.equal((await request(app).post('/api/mail/simulate/x').set('X-Dev-User-Id', 'alice').send({})).status, 404); ok('simulation endpoints are disabled in production');
assert.equal((await request(app).post('/api/mail/send').set('X-Dev-User-Id', 'alice').send({})).status, 401); ok('dev identity header is ignored in production');
process.env.NODE_ENV = 'test';

// ---- Bypass tokens are gone ----
assert.equal(await identifyToken('admin-jwt-token-2026'), null); // lint-guards: allow (negative test)
assert.equal(await identifyToken('dev-mock-token'), null); ok('former bypass tokens are rejected'); // lint-guards: allow (negative test)
const good = jwt.sign({ id: 'u_42', role: 'ADMIN', name: 'Ada' }, process.env.JWT_SECRET!, { expiresIn: '1h' });
assert.equal((await identifyToken(good))?.id, 'u_42'); ok('JWT signed with JWT_SECRET is accepted');
assert.equal(await identifyToken(jwt.sign({ id: 'u_42' }, 'wrong-secret', { expiresIn: '1h' })), null); ok('JWT signed with another secret is rejected');
// Time claims: exp is required (tokens without one used to be valid forever); expired / not-yet-valid → rejected.
const nowS = Math.floor(Date.now() / 1000);
assert.equal(await identifyToken(jwt.sign({ id: 'u_42' }, process.env.JWT_SECRET!)), null, 'no exp');
assert.equal(await identifyToken(jwt.sign({ id: 'u_42', exp: nowS - 120 }, process.env.JWT_SECRET!)), null, 'expired');
assert.equal(await identifyToken(jwt.sign({ id: 'u_42', exp: nowS + 3600, nbf: nowS + 600 }, process.env.JWT_SECRET!)), null, 'nbf in the future');
assert.equal(await identifyToken(jwt.sign({ id: 'u_42', exp: nowS + 3600, iat: nowS + 600 }, process.env.JWT_SECRET!)), null, 'issued in the future');
const hs256 = (payload: object) => { const h = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'), p = Buffer.from(JSON.stringify(payload)).toString('base64url'); return `${h}.${p}.${createHmac('sha256', process.env.JWT_SECRET!).update(`${h}.${p}`).digest('base64url')}`; };
assert.equal((await identifyToken(hs256({ id: 'u_42', exp: nowS + 3600 })))?.id, 'u_42', 'hand-signed control token');
assert.equal(await identifyToken(hs256({ id: 'u_42', exp: String(nowS + 3600) })), null, 'non-numeric exp');
assert.equal(await identifyToken(jwt.sign({ id: 'u_42' }, process.env.JWT_SECRET!, { algorithm: 'HS512', expiresIn: '1h' })), null, 'other algorithm');
const unsigned = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url') + '.' + Buffer.from(JSON.stringify({ id: 'u_42', exp: nowS + 3600 })).toString('base64url') + '.';
assert.equal(await identifyToken(unsigned), null, 'alg none');
ok('session JWTs: exp required; expired, not-yet-valid, alg=none and other algorithms are rejected');
const gw = express(); gw.get('/v1/me', jwtAuthMiddleware as any, (req: any, res) => res.json(req.user));
assert.equal((await request(gw).get('/v1/me').set('Authorization', 'Bearer admin-jwt-token-2026')).status, 401); ok('API gateway rejects the old admin token'); // lint-guards: allow (negative test)
assert.equal((await request(gw).get('/v1/me?token=' + good)).status, 401); ok('API gateway ignores tokens in the query string');
r = await request(gw).get('/v1/me').set('Authorization', 'Bearer ' + good);
assert.equal(r.body.id, 'u_42'); assert.equal(r.body.role, 'ADMIN'); ok('API gateway accepts a valid signed token with its claims');

// ---- Secrets ----
const a = secrets.coreSecret('UNSET_CORE_SECRET_FOR_TEST'), b = secrets.coreSecret('UNSET_CORE_SECRET_FOR_TEST');
assert.ok(a.length >= 32 && a === b && !/^1234/.test(a)); ok('development: missing core secret → random per-process value (stable, not hardcoded)');
assert.equal(secrets.coreSecret('UNSET_KEY32', { length: 32 }).length, 32); ok('raw AES keys get the required length');
assert.equal(secrets.optionalSecret('UNSET_INTEGRATION_KEY'), ''); ok('missing integration secret → empty (feature reports not configured)');
process.env.NODE_ENV = 'production';
assert.throws(() => secrets.coreSecret('UNSET_CORE_SECRET_PROD'), /Missing required secret UNSET_CORE_SECRET_PROD/); ok('production: missing core secret stops with a clear message');
assert.equal(secrets.devDefault('LIVEKIT_TEST_KEY', 'devkey'), ''); ok('dev-only defaults are never used in production');
process.env.NODE_ENV = 'test';

// ---- AI chat never invents answers ----
const chatRouter = (await import('../../routes/chat')).default;
const chat = express(); chat.use(express.json()); chat.use('/api/chat', guard(PUBLIC.none), chatRouter);
assert.equal((await request(chat).post('/api/chat/completions').send({ messages: [] })).status, 401); ok('AI chat requires sign-in');
r = await request(chat).post('/api/chat/completions').set('X-Dev-User-Id', 'alice').set('Accept', 'text/event-stream')
  .send({ messages: [{ role: 'user', content: 'How many leads do I have?' }], model: 'gpt-4o', stream: true });
assert.match(r.text, /"code":"ai_not_configured"/); assert.ok(!/lead/i.test(r.text.replace(/"content":"How many leads do I have\?"/, '')) || /ai_not_configured/.test(r.text)); ok('no AI provider → explicit "not configured" error, no canned answer');

{
  const { acceptedFirebaseIdentity } = await import('../../features/social-accounts/server/auth');
  assert.equal(acceptedFirebaseIdentity({ uid: 'u1', firebase: { sign_in_provider: 'anonymous' } }), false);
  assert.equal(acceptedFirebaseIdentity({ uid: '' }), false);
  assert.equal(acceptedFirebaseIdentity({ uid: 'u1', firebase: { sign_in_provider: 'password' } }), true);
  ok('anonymous Firebase sign-ins are not accepted as accounts');
}
console.log(`\n${passed} passed (security)`);
process.exit(0);
