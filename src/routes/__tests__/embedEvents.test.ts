/**
 * Embeddable calendar API tests (in-memory store).
 * Run: npx tsx src/routes/__tests__/embedEvents.test.ts
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import request from 'supertest';

let passed = 0; const ok = (n: string) => { passed++; console.log('  ✓', n); };
Object.assign(process.env, { NODE_ENV: 'test', SOCIAL_ACCOUNTS_DEV_AUTH: 'true', CRM_STORE: 'memory', EMBED_TOKEN_SECRET: 'embed-test-secret-0123456789' });

const { MemoryDocStore, setDocStore } = await import('../../server/data/docStore');
setDocStore(new MemoryDocStore());
const { guard, PUBLIC } = await import('../../server/routeGuards');
const orgs = (await import('../orgsApi')).default;
const { eventsRouter, embedTokensRouter } = await import('../embedEventsApi');

const app = express(); app.use(express.json());
app.use('/api/orgs', guard(PUBLIC.none), orgs);
app.use('/api/v1/events', eventsRouter);
app.use('/api/v1/embed-tokens', embedTokensRouter);

const SITE = 'https://shop.example.com', EVIL = 'https://evil.example';
const A = { 'X-Dev-User-Id': 'alice' }, B = { 'X-Dev-User-Id': 'bob' };
const iso = (dDays: number, h = 10) => { const d = new Date(Date.now() + dDays * 86_400_000); d.setUTCHours(h, 0, 0, 0); return d.toISOString(); };
const range = { startDate: iso(-3, 0), endDate: iso(30, 0) };

// ---- Owner creates keys in the CRM ----
let r = await request(app).post('/api/orgs/current/embed-keys').set(A).send({ kind: 'publishable', allowedOrigins: [SITE] });
assert.equal(r.status, 201); const pkRead = r.body.secret; assert.match(pkRead, /^pk_/); assert.ok(!JSON.stringify(r.body.key).includes(pkRead));
ok('owner creates a publishable key (read-only by default); secret shown once, only its hash stored');
r = await request(app).post('/api/orgs/current/embed-keys').set(A).send({ kind: 'publishable', allowedOrigins: ['ftp://x'] });
assert.equal(r.status, 400); ok('invalid website origins rejected');
r = await request(app).post('/api/orgs/current/embed-keys').set(A).send({ kind: 'publishable' });
assert.equal(r.status, 400); assert.equal(r.body.code, 'origin_required'); ok('publishable keys must list their website origins');
const pkWrite = (await request(app).post('/api/orgs/current/embed-keys').set(A).send({ kind: 'publishable', scopes: ['events:read', 'events:write'], allowedOrigins: [SITE] })).body.secret;
const sk = (await request(app).post('/api/orgs/current/embed-keys').set(A).send({ kind: 'secret', scopes: ['events:read', 'events:write'], allowedOrigins: [SITE] })).body.secret;
const bobPk = (await request(app).post('/api/orgs/current/embed-keys').set(B).send({ kind: 'publishable', allowedOrigins: [SITE] })).body.secret;
await request(app).post('/api/orgs/current/embed-keys').set({ 'X-Dev-User-Id': 'carol' }).send({}); // carol: owner of her own org
ok('keys created for write/secret/other org');

// ---- Tokens (server-to-server) ----
r = await request(app).post('/api/v1/embed-tokens').set('Authorization', `Bearer ${sk}`).send({ subject: 'staff@shop', ttlSeconds: 600 });
assert.equal(r.status, 201); const token = r.body.token; assert.match(token, /^et_/); ok('server mints a short-lived embed token with the secret key');
r = await request(app).post('/api/v1/embed-tokens').set('Authorization', `Bearer ${sk}`).set('Origin', SITE).send({});
assert.equal(r.status, 400); assert.equal(r.body.code, 'server_only'); ok('minting from a browser (Origin header) is refused: secret keys stay server-side');
r = await request(app).post('/api/v1/embed-tokens').set('Authorization', `Bearer ${pkWrite}`).send({});
assert.equal(r.status, 401); ok('a publishable key can’t mint tokens');
r = await request(app).get('/api/v1/events').query(range).set('Authorization', `Bearer ${sk}`).set('Origin', SITE);
assert.equal(r.status, 401); ok('a secret key can’t be used directly from the widget');

// ---- CORS ----
r = await request(app).options('/api/v1/events').set('Origin', SITE).set('Access-Control-Request-Method', 'POST').set('Access-Control-Request-Headers', 'authorization,content-type');
assert.equal(r.status, 204); assert.equal(r.headers['access-control-allow-origin'], SITE); assert.match(r.headers['access-control-allow-headers'], /Authorization/);
assert.equal(r.headers['access-control-allow-credentials'], undefined); ok('preflight: explicit origin/methods/headers, no credentials');
r = await request(app).get('/api/v1/events').query(range).set('Authorization', `Bearer ${pkRead}`).set('Origin', SITE);
assert.equal(r.status, 200); assert.equal(r.headers['access-control-allow-origin'], SITE); assert.equal(r.headers.vary, 'Origin'); ok('allowed website: 200 with Access-Control-Allow-Origin for that site only');
r = await request(app).get('/api/v1/events').query(range).set('Authorization', `Bearer ${pkRead}`).set('Origin', EVIL);
assert.equal(r.status, 403); assert.equal(r.headers['access-control-allow-origin'], undefined); ok('other website using the key: 403 and no CORS header (browser blocks it)');
r = await request(app).get('/api/v1/events').query(range).set('Authorization', `Bearer ${pkRead}`);
assert.equal(r.status, 403); ok('publishable key without an Origin (e.g. scripts) refused');
assert.equal((await request(app).get('/api/v1/events').query(range).set('Origin', SITE)).status, 401); ok('no credential → 401');
assert.equal((await request(app).get('/api/v1/events').query(range).set('Origin', SITE).set('X-API-Key', pkRead)).status, 200); ok('X-API-Key header also accepted');

// ---- Scopes ----
r = await request(app).post('/api/v1/events').set('Authorization', `Bearer ${pkRead}`).set('Origin', SITE).send({ title: 'x', scheduledAt: iso(1) });
assert.equal(r.status, 403); ok('read-only key can’t create');
r = await request(app).post('/api/v1/events').set('Authorization', `Bearer ${pkWrite}`).set('Origin', SITE).send({ title: 'Consultation request', scheduledAt: iso(2), channels: ['Website'] });
assert.equal(r.status, 201); assert.equal(r.body.event.status, 'pending'); const requested = r.body.event; ok('public write key creates a *pending* request, not a confirmed event');
r = await request(app).get('/api/v1/events').query(range).set('Authorization', `Bearer ${pkRead}`).set('Origin', SITE);
assert.ok(!r.body.events.some((e: any) => e.id === requested.id)); ok('pending requests are hidden from public viewers');
r = await request(app).patch(`/api/v1/events/${requested.id}`).set('Authorization', `Bearer ${pkWrite}`).set('Origin', SITE).send({ title: 'hijack' });
assert.equal(r.status, 403); assert.equal(r.body.code, 'token_required');
assert.equal((await request(app).delete(`/api/v1/events/${requested.id}`).set('Authorization', `Bearer ${pkWrite}`).set('Origin', SITE)).status, 403);
ok('public keys can’t edit or delete anything');

// ---- Staff token: full management ----
const T = { Authorization: `Bearer ${token}`, Origin: SITE };
r = await request(app).post('/api/v1/events').set(T).send({ title: 'Product launch post', scheduledAt: iso(3), platform: 'LinkedIn', channels: ['Instagram'], content: 'Big news' });
assert.equal(r.status, 201); assert.equal(r.body.event.status, 'scheduled'); assert.deepEqual(r.body.event.channels.sort(), ['Instagram', 'LinkedIn']);
const ev = r.body.event; ok('staff token creates a scheduled event (platform merged into channels)');
r = await request(app).get('/api/v1/events').query(range).set(T);
assert.ok(r.body.events.some((e: any) => e.id === requested.id)); assert.equal(r.body.permissions.manage, true); ok('staff see pending requests and get manage permission');
r = await request(app).patch(`/api/v1/events/${ev.id}`).set(T).send({ scheduledAt: iso(5), version: ev.version });
assert.equal(r.status, 200); assert.equal(r.body.event.version, 2); ok('reschedule with version → 200, version bumped');
r = await request(app).patch(`/api/v1/events/${ev.id}`).set(T).send({ title: 'Stale edit', version: 1 });
assert.equal(r.status, 409); assert.equal(r.body.event.version, 2); ok('stale version → 409 with the latest event (no silent overwrite)');
r = await request(app).patch(`/api/v1/events/${ev.id}`).set(T).set('If-Match', '"2"').send({ title: 'Launch post v2' });
assert.equal(r.status, 200); ok('If-Match header works too');
r = await request(app).patch(`/api/v1/events/${requested.id}`).set(T).send({ status: 'scheduled' });
assert.equal(r.body.event.status, 'scheduled'); ok('staff confirm a pending request');
assert.equal((await request(app).delete(`/api/v1/events/${ev.id}`).set(T)).status, 200);
assert.equal((await request(app).delete(`/api/v1/events/${ev.id}`).set(T)).status, 404); ok('delete, then 404');
assert.equal((await request(app).get('/api/v1/events').query(range).set({ Authorization: `Bearer ${token}`, Origin: EVIL })).status, 403); ok('tokens are origin-bound too');

// ---- Validation ----
for (const [body, why] of [
  [{ title: '', scheduledAt: iso(1) }, 'empty title'], [{ title: 'x', scheduledAt: 'tomorrow' }, 'bad date'],
  [{ title: 'x', scheduledAt: iso(2), endAt: iso(1) }, 'end before start'], [{ title: 'x', scheduledAt: iso(1), channels: ['<script>'] }, 'unsafe channel'],
  [{ title: 'x', scheduledAt: iso(1), orgId: 'other' }, 'unknown field'], [{ title: 'x'.repeat(201), scheduledAt: iso(1) }, 'too long'],
] as const) {
  r = await request(app).post('/api/v1/events').set(T).send(body);
  assert.equal(r.status, 400, why); assert.ok(r.body.error);
}
ok('validation: title, dates, end ≥ start, channel names, unknown fields, lengths → 400 with a message');
assert.equal((await request(app).get('/api/v1/events').query({ startDate: iso(0), endDate: iso(200) }).set(T)).status, 400); ok('date range capped at 100 days');
assert.equal((await request(app).patch('/api/v1/events/..%2Fx').set(T).send({ title: 'x' })).status, 400); ok('unsafe ids rejected');

// ---- Isolation ----
r = await request(app).get('/api/v1/events').query(range).set('Authorization', `Bearer ${bobPk}`).set('Origin', SITE);
assert.equal(r.body.events.length, 0); ok('another organization’s key sees none of these events');

// ---- Revocation ----
const keys = (await request(app).get('/api/orgs/current/embed-keys').set(A)).body.keys;
const secretRec = keys.find((k: any) => k.kind === 'secret');
await request(app).delete(`/api/orgs/current/embed-keys/${secretRec.id}`).set(A);
assert.equal((await request(app).get('/api/v1/events').query(range).set(T)).status, 401); ok('revoking the secret key ends its tokens immediately');
const readRec = keys.find((k: any) => k.prefix === pkRead.slice(0, 10));
await request(app).delete(`/api/orgs/current/embed-keys/${readRec.id}`).set(A);
assert.equal((await request(app).get('/api/v1/events').query(range).set('Authorization', `Bearer ${pkRead}`).set('Origin', SITE)).status, 401); ok('revoked publishable key stops working');
assert.equal((await request(app).get('/api/orgs/current/embed-keys').set({ 'X-Dev-User-Id': 'mallory' })).body.keys.length, 0); ok('key list is per organization');

// ---- Live updates ----
{
  const token2 = (await request(app).post('/api/v1/embed-tokens').set('Authorization', `Bearer ${(await request(app).post('/api/orgs/current/embed-keys').set(A).send({ kind: 'secret', scopes: ['events:read', 'events:write'], allowedOrigins: [SITE] })).body.secret}`).send({})).body.token;
  const server = http.createServer(app).listen(0); const port = (server.address() as any).port;
  const got: any[] = [];
  const ctrl = new AbortController();
  const res = await fetch(`http://127.0.0.1:${port}/api/v1/events/stream`, { headers: { Authorization: `Bearer ${pkWrite}`, Origin: SITE }, signal: ctrl.signal });
  const reader = res.body!.getReader(); const dec = new TextDecoder();
  const reading = (async () => { let buf = ''; for (;;) { const c = await reader.read().catch(() => ({ done: true } as any)); if (c.done) return; buf += dec.decode(c.value); for (const p of buf.split('\n\n').slice(0, -1)) { const l = p.split('\n').find((x) => x.startsWith('data: ')); if (l) got.push(JSON.parse(l.slice(6))); } buf = buf.split('\n\n').pop()!; } })();
  await new Promise((res2) => setTimeout(res2, 100));
  await request(app).post('/api/v1/events').set({ Authorization: `Bearer ${token2}`, Origin: SITE }).send({ title: 'Live one', scheduledAt: iso(4) });
  await request(app).post('/api/v1/events').set({ Authorization: `Bearer ${pkWrite}`, Origin: SITE }).send({ title: 'Public request', scheduledAt: iso(4) });
  await new Promise((res2) => setTimeout(res2, 150));
  ctrl.abort(); server.close(); await reading.catch(() => {});
  assert.ok(got.some((m) => m.type === 'created' && m.event.title === 'Live one')); ok('live stream pushes new events to open widgets');
  assert.ok(!got.some((m) => m.event?.title === 'Public request')); ok('public viewers don’t receive pending requests on the stream');
}

console.log(`\n${passed} passed (embed calendar)`);
process.exit(0);
