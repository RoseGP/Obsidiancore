/**
 * Phase 0 security regression tests: unauthenticated access, forged webhooks, cross-user access.
 * Run: npx tsx src/server/__tests__/phase0.test.ts
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import request from 'supertest';

let passed = 0; const ok = (n: string) => { passed++; console.log('  ✓', n); };
// Firestore calls in the legacy routers fail without credentials; they must not crash this test run.
process.on('unhandledRejection', () => {});

Object.assign(process.env, {
  CRM_STORE: 'memory', NODE_ENV: 'test', SOCIAL_ACCOUNTS_DEV_AUTH: 'true', JWT_SECRET: 'unit-test-jwt-secret-0123456789',
  SQUARE_WEBHOOK_SIGNATURE_KEY: 'sq-test-key', APP_URL: 'https://crm.example.test',
  META_APP_SECRET: 'meta-test-secret', TWILIO_AUTH_TOKEN: 'twilio-test-token', IVR_ALLOWED_HOSTS: '127.0.0.1',
});
delete process.env.ALLOW_UNSIGNED_WEBHOOKS; delete process.env.STRIPE_WEBHOOK_SECRET;
delete process.env.GEMINI_API_KEY; delete process.env.OMNIROUTE_GATEWAY_URL;

const rawJson = express.json({ verify: (req: any, _res, buf) => { req.rawBody = buf.toString(); } });
const { guard, PUBLIC } = await import('../routeGuards');
const env = await import('../runtimeEnv');
const { identify } = await import('../../features/social-accounts/server/auth');

// ---- Fail-safe environment ----
assert.equal(env.devIdentityHeaderAllowed({ SOCIAL_ACCOUNTS_DEV_AUTH: 'true' } as any), false); ok('dev identity header refused when NODE_ENV is unset');
assert.equal(env.devIdentityHeaderAllowed({ NODE_ENV: 'prodution', SOCIAL_ACCOUNTS_DEV_AUTH: 'true' } as any), false); ok('…and when NODE_ENV is misspelled');
assert.equal(env.devIdentityHeaderAllowed({ NODE_ENV: 'development' } as any), false); ok('…and in development without explicit opt-in');
assert.equal(env.devIdentityHeaderAllowed({ NODE_ENV: 'development', SOCIAL_ACCOUNTS_DEV_AUTH: 'true' } as any), true); ok('allowed only with development + opt-in');
assert.equal(env.unsignedWebhooksAllowed({ NODE_ENV: 'test' } as any), false); ok('unsigned webhooks refused without ALLOW_UNSIGNED_WEBHOOKS');
{
  const saved = process.env.NODE_ENV; delete process.env.NODE_ENV;
  const who = await identify({ headers: { 'x-dev-user-id': 'exec-director-45' } } as any);
  assert.equal(who, null); ok('X-Dev-User-Id is ignored by the server when NODE_ENV is unset');
  process.env.NODE_ENV = saved;
}

// ---- Previously unauthenticated CRM routers ----
const leads = (await import('../../routes/leadsApi')).default;
const dashboard = (await import('../../routes/dashboardApi')).default;
const marketing = (await import('../../routes/marketingApi')).default;
const crm = express(); crm.use(rawJson);
crm.use('/api/leads', guard(PUBLIC.leads), leads);
crm.use('/api/dashboard', guard(PUBLIC.none), dashboard);
crm.use('/api/marketing', guard(PUBLIC.none), marketing);

assert.equal((await request(crm).get('/api/leads')).status, 401); ok('GET /api/leads requires sign-in');
assert.equal((await request(crm).delete('/api/leads/lead-1')).status, 401); ok('DELETE /api/leads/:id requires sign-in');
assert.equal((await request(crm).post('/api/leads/bulk/status').send({ ids: ['lead-1'], status: 'lost' })).status, 401); ok('bulk lead updates require sign-in');
assert.equal((await request(crm).get('/api/dashboard/deals')).status, 401); ok('GET /api/dashboard/deals requires sign-in');
assert.equal((await request(crm).post('/api/dashboard/tickets/t1/resolve')).status, 401); ok('dashboard writes require sign-in');
assert.equal((await request(crm).post('/api/marketing/api-tokens').send({ name: 'x' })).status, 401); ok('marketing API tokens require sign-in');
let r = await request(crm).post('/api/leads/capture').set('x-org-id', 'org_victim').send({ name: 'x', email: 'x@y.test' });
assert.equal(r.body.code, 'form_not_connected'); ok('website lead form stays public (no sign-in needed) and ignores X-Org-Id');

// Marketing workspace isolation: a signed-in user can't reach a workspace they don't belong to.
r = await request(crm).get('/api/marketing/subscribers').set('X-Dev-User-Id', 'mallory').set('x-workspace-id', 'ws_default_obsidian');
assert.equal(r.status, 403); ok('marketing: another workspace’s subscribers → 403');
r = await request(crm).post('/api/marketing/api-tokens').set('X-Dev-User-Id', 'mallory').set('x-workspace-id', 'ws_default_obsidian').send({ name: 'steal' });
assert.equal(r.status, 403); ok('marketing: cannot mint API tokens in another workspace');
r = await request(crm).post('/api/marketing/workspaces/ws_default_obsidian/invitations').set('X-Dev-User-Id', 'mallory').send({ email: 'm@evil.test', role: 'admin' });
assert.equal(r.status, 403); ok('marketing: cannot invite yourself into another workspace');
r = await request(crm).get('/api/marketing/subscribers').set('X-Dev-User-Id', 'exec-director-45');
assert.equal(r.status, 200); ok('marketing: the workspace owner still has access');

// ---- BFF gateway: password-less login removed ----
const bff = (await import('../../routes/apiV1Bff')).default;
const gw = express(); gw.use(express.json()); gw.use('/api/v1', bff);
r = await request(gw).post('/api/v1/auth/login').send({ email: 'anyone@evil.test' });
assert.equal(r.status, 410); assert.ok(!JSON.stringify(r.body).includes('eyJ')); ok('POST /api/v1/auth/login no longer issues tokens');

// ---- Payment webhooks ----
const webhooks = (await import('../../routes/paymentWebhooks')).default;
const wh = express(); wh.use(rawJson); wh.use('/api/webhooks', webhooks);
const sqBody = JSON.stringify({ event_id: 'evt_phase0_1', type: 'invoice.payment_made', data: {} });
r = await request(wh).post('/api/webhooks/square').set('content-type', 'application/json').send(sqBody);
assert.equal(r.status, 400); ok('Square: unsigned event rejected');
r = await request(wh).post('/api/webhooks/square').set('content-type', 'application/json').set('x-square-hmacsha256-signature', 'forged==').send(sqBody);
assert.equal(r.status, 400); ok('Square: forged signature rejected');
const sqSig = crypto.createHmac('sha256', 'sq-test-key').update('https://crm.example.test/api/webhooks/square' + sqBody).digest('base64');
r = await request(wh).post('/api/webhooks/square').set('content-type', 'application/json').set('x-square-hmacsha256-signature', sqSig).send(sqBody);
assert.equal(r.status, 200); ok('Square: correctly signed event accepted');
delete process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
r = await request(wh).post('/api/webhooks/square').set('content-type', 'application/json').set('x-square-hmacsha256-signature', sqSig).send(sqBody.replace('_1', '_2'));
assert.equal(r.status, 400); ok('Square: signature key missing → rejected (was: accepted)');
r = await request(wh).post('/api/webhooks/stripe').send({ id: 'evt_x', type: 'invoice.paid', data: { object: {} } });
assert.equal(r.status, 400); ok('Stripe: unsigned event rejected outside explicit dev opt-in');

// ---- Meta (WhatsApp) webhook ----
const comm = (await import('../../routes/communication')).default;
const ca = express(); ca.use(rawJson); ca.use(express.urlencoded({ extended: true })); ca.use('/api/communication', guard(PUBLIC.communication), comm);
const metaBody = '{"object":"whatsapp_business_account","entry":[],"note":"caf\\u00e9"}'; // \u escape: re-serialising would change the bytes
const metaSig = 'sha256=' + crypto.createHmac('sha256', 'meta-test-secret').update(metaBody).digest('hex');
r = await request(ca).post('/api/communication/whatsapp-webhook').set('content-type', 'application/json').set('x-hub-signature-256', metaSig).send(metaBody);
assert.notEqual(r.status, 401); ok('Meta: genuine signature over raw bytes accepted (incl. \\u escapes)');
r = await request(ca).post('/api/communication/whatsapp-webhook').set('content-type', 'application/json').set('x-hub-signature-256', 'sha256=' + 'a'.repeat(64)).send(metaBody);
assert.equal(r.status, 401); ok('Meta: forged signature rejected');
r = await request(ca).post('/api/communication/whatsapp-webhook').set('content-type', 'application/json').set('x-hub-signature-256', 'sha256=abc').send(metaBody);
assert.equal(r.status, 401); ok('Meta: malformed signature → 401, not 500');

// ---- Twilio webhooks and video tokens ----
r = await request(ca).post('/api/communication/twilio-sms').type('form').send({ From: '+15550001111', Body: 'hi' });
assert.equal(r.status, 403); ok('Twilio SMS webhook without signature rejected');
r = await request(ca).post('/api/communication/incoming-call').type('form').send({ From: '+15550001111' });
assert.equal(r.status, 403); ok('Twilio voice webhook without signature rejected');
r = await request(ca).post('/api/communication/twilio-video-token').send({ identity: 'ceo', roomName: 'board' });
assert.equal(r.status, 401); ok('Twilio video token requires sign-in');
r = await request(ca).post('/api/communication/twilio-video-token').set('X-Dev-User-Id', 'alice').send({ identity: 'ceo', roomName: 'board' });
assert.equal(r.body.identity, 'alice'); ok('video token identity is the signed-in user, not the requested one');

// ---- AI chat sessions: no cross-user access ----
const chatRouter = (await import('../../routes/chat')).default;
const chat = express(); chat.use(express.json()); chat.use('/api/chat', guard(PUBLIC.none), chatRouter);
await request(chat).get('/api/chat/sessions').set('X-Dev-User-Id', 'alice'); // provisions alice's organization
const { getDocStore } = await import('../data/docStore');
const idx = await (await getDocStore()).get('crm_user_memberships/alice');
await (await getDocStore()).set(`organizations/${idx.defaultOrgId}/chat_sessions/sess_alice_secret`, { sessionId: 'sess_alice_secret', userId: 'alice', messages: [{ role: 'user', content: 'alice private note' }] });
r = await request(chat).get('/api/chat/session/sess_alice_secret').set('X-Dev-User-Id', 'mallory');
assert.equal(r.status, 404); assert.ok(!JSON.stringify(r.body).includes('alice private note')); ok('chat: another user’s session → 404');
r = await request(chat).delete('/api/chat/session/sess_alice_secret').set('X-Dev-User-Id', 'mallory');
assert.equal(r.status, 404); ok('chat: cannot delete another user’s session');
r = await request(chat).post('/api/chat').set('X-Dev-User-Id', 'mallory').send({ message: 'summarise', sessionId: 'sess_alice_secret' });
assert.ok(!JSON.stringify(r.body).includes('alice private note'));
const aliceSess = await (await getDocStore()).get(`organizations/${idx.defaultOrgId}/chat_sessions/sess_alice_secret`);
assert.equal(aliceSess.messages.length, 1); ok('chat: reusing another user’s session id neither reads nor changes their history');
r = await request(chat).get('/api/chat/session/sess_alice_secret').set('X-Dev-User-Id', 'alice');
assert.equal(r.status, 200); ok('chat: the owner can still read their session');

console.log(`\n${passed} passed (phase 0)`);
process.exit(0);
