/**
 * HTTP layer: request ids, consistent JSON errors with correct statuses (invalid JSON, oversized bodies,
 * validation, not found, unauthenticated/forbidden, rate limits, unexpected errors), async errors reaching the
 * error handler, no stack traces or internal messages for clients, and log redaction.
 * Run: npx tsx src/server/http/__tests__/httpLayer.test.ts
 */
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { z } from 'zod';

Object.assign(process.env, { NODE_ENV: 'test', SOCIAL_ACCOUNTS_DEV_AUTH: 'true', CRM_STORE: 'memory', LOG_LEVEL: 'debug' });
const { apiRateLimit, errorHandler, installAsyncErrorForwarding, notFoundHandler, requestContext, requestLogger, validateBody } = await import('../middleware');
const { HttpError, notFound, toErrorResponse, tooManyRequests } = await import('../errors');
const { redact, setLogSinkForTests } = await import('../logger');
const { TenancyError } = await import('../../tenancy/orgs');
const { InvalidIdError } = await import('../../data/docStore');
const { sendError } = await import('../../tenancy/middleware');
const { guard, PUBLIC } = await import('../../routeGuards');

let passed = 0; const ok = (n: string) => { passed++; console.log('  ✓', n); };
const logs: Array<{ level: string; line: string }> = [];
setLogSinkForTests((line, level) => logs.push({ level, line }));

installAsyncErrorForwarding();
const app = express();
app.use(requestContext());
app.use(requestLogger());
app.use(express.json({ limit: '1kb' }));
app.use('/api', apiRateLimit({ perMinute: 1000 }));

const r = express.Router();
r.post('/items', validateBody(z.object({ name: z.string().min(1, 'Name is required.'), qty: z.number().int().positive() })), (req, res) => res.status(201).json({ success: true, item: req.body }));
r.get('/items/:id', async (req) => { if (req.params.id !== 'known') throw notFound('That item doesn’t exist.'); });
r.get('/boom-sync', () => { throw new Error('database password=hunter2 at 10.0.0.5'); });
r.get('/boom-async', async () => { await new Promise((res) => setTimeout(res, 5)); throw new Error('secret connection string'); });
r.get('/tenancy', async () => { throw new TenancyError(403, 'not_a_member', 'You don’t have access to this organization.'); });
r.get('/bad-id', async () => { throw new InvalidIdError(); });
r.get('/deliberate-503', async () => { throw new HttpError(503, 'media_not_configured', 'Video isn’t configured.'); });
r.get('/legacy-sendError', async (_req, res) => { try { throw new Error('internal detail'); } catch (e) { sendError(res, e, 'legacy'); } });
r.get('/limited', async () => { throw tooManyRequests(30); });
app.use('/api', r);
app.use('/api/private', guard(PUBLIC.none), (_req, res) => res.json({ success: true }));
app.use('/api', notFoundHandler());
app.use(errorHandler());

// ---- Request ids ----
{
  const res = await request(app).get('/api/items/known-not').set('X-Request-Id', 'client-req-12345');
  assert.equal(res.headers['x-request-id'], 'client-req-12345');
  assert.equal(res.body.requestId, 'client-req-12345');
  const bad = await request(app).get('/api/nope').set('X-Request-Id', 'bad id with spaces <script>');
  assert.match(bad.headers['x-request-id'], /^[0-9a-f-]{36}$/);
  ok('request id: a well-formed incoming id is kept, anything else is replaced; echoed in header and error body');
}

// ---- Status codes and safe bodies ----
{
  let res = await request(app).post('/api/items').set('Content-Type', 'application/json').send('{"name": "x",');
  assert.equal(res.status, 400); assert.equal(res.body.code, 'invalid_json'); assert.equal(res.body.success, false);
  ok('malformed JSON → 400 invalid_json (JSON, not an HTML error page)');

  res = await request(app).post('/api/items').send({ name: 'x'.repeat(2000), qty: 1 });
  assert.equal(res.status, 413); assert.equal(res.body.code, 'payload_too_large');
  ok('oversized body → 413 payload_too_large');

  res = await request(app).post('/api/items').send({ name: '', qty: 2 });
  assert.equal(res.status, 400); assert.equal(res.body.code, 'invalid_input'); assert.equal(res.body.field, 'name'); assert.equal(res.body.error, 'Name is required.');
  res = await request(app).post('/api/items').send({ name: 'Widget', qty: -1 });
  assert.equal(res.status, 400); assert.equal(res.body.field, 'qty');
  res = await request(app).post('/api/items').send({ name: 'Widget', qty: 3, extra: 'dropped' });
  assert.equal(res.status, 201); assert.deepEqual(res.body.item, { name: 'Widget', qty: 3 });
  ok('validation → 400 invalid_input naming the field; valid input reaches the handler parsed');

  res = await request(app).get('/api/items/other');
  assert.equal(res.status, 404); assert.equal(res.body.code, 'not_found'); assert.equal(res.body.error, 'That item doesn’t exist.');
  res = await request(app).get('/api/does/not/exist');
  assert.equal(res.status, 404); assert.equal(res.body.code, 'not_found');
  ok('missing records and unknown routes → JSON 404');

  res = await request(app).get('/api/private');
  assert.equal(res.status, 401);
  res = await request(app).get('/api/tenancy');
  assert.equal(res.status, 403); assert.equal(res.body.code, 'not_a_member');
  res = await request(app).get('/api/bad-id');
  assert.equal(res.status, 400); assert.equal(res.body.code, 'invalid_id');
  ok('unauthenticated → 401; domain errors keep their status and code (403 not_a_member, 400 invalid_id)');

  res = await request(app).get('/api/limited');
  assert.equal(res.status, 429); assert.equal(res.headers['retry-after'], '30'); assert.equal(res.body.retryAfter, 30);
  res = await request(app).get('/api/deliberate-503');
  assert.equal(res.status, 503); assert.equal(res.body.code, 'media_not_configured');
  ok('rate-limit errors carry Retry-After; deliberate 503s keep their safe message');
}

// ---- Unexpected errors: generic message, details only in the log ----
{
  logs.length = 0;
  for (const path of ['/api/boom-sync', '/api/boom-async', '/api/legacy-sendError']) {
    const res = await request(app).get(path);
    assert.equal(res.status, 500, path);
    assert.equal(res.body.code, 'server_error');
    assert.equal(res.body.error, 'Something went wrong on our side. Please try again.');
    const text = JSON.stringify(res.body);
    assert.ok(!/hunter2|secret|internal detail|at .*\(|stack/i.test(text), `${path} leaked: ${text}`);
  }
  const errLines = logs.filter((l) => l.level === 'error');
  assert.ok(errLines.some((l) => l.line.includes('http.unhandled_error') && l.line.includes('hunter2')), 'the server log has the real error');
  assert.ok(errLines.some((l) => l.line.includes('secret connection string')), 'async errors reach the handler and the log');
  assert.ok(errLines.some((l) => l.line.includes('"tag":"legacy"')), 'sendError logs with its tag');
  ok('500s (sync, async and via sendError) show a generic message; the stack and cause go to the server log only');
}

// ---- Async route errors don't hang ----
{
  const t0 = Date.now();
  const res = await request(app).get('/api/boom-async').timeout(2000);
  assert.equal(res.status, 500); assert.ok(Date.now() - t0 < 1500);
  ok('a rejected async handler answers (Express 4 would otherwise leave the request hanging)');
}

// ---- Global rate limit ----
{
  const small = express();
  small.use(requestContext());
  small.use('/api', apiRateLimit({ perMinute: 3 }));
  small.get('/api/x', (_req, res) => res.json({ success: true }));
  small.get('/api/health', (_req, res) => res.json({ ok: true }));
  for (let i = 0; i < 3; i++) assert.equal((await request(small).get('/api/x')).status, 200);
  const res = await request(small).get('/api/x');
  assert.equal(res.status, 429); assert.equal(res.body.code, 'rate_limited'); assert.ok(Number(res.headers['retry-after']) > 0);
  assert.equal((await request(small).get('/api/health')).status, 200);
  ok('per-IP API limit → 429 rate_limited with Retry-After; the health check is exempt');
}

// ---- Logging ----
{
  logs.length = 0;
  await request(app).get('/api/items/other?token=abc123&email=x@y.z');
  const line = logs.find((l) => l.line.includes('"event":"http.request"'))!.line;
  const entry = JSON.parse(line);
  assert.equal(entry.path, '/api/items/other'); assert.equal(entry.status, 404); assert.ok(entry.ms >= 0);
  assert.ok(!line.includes('abc123') && !line.includes('x@y.z'), 'query strings are not logged');
  assert.deepEqual(redact({ password: 'p', apiKey: 'k', nested: { authorization: 'Bearer x', email: 'a@b.c', name: 'ok' } }),
    { password: '[redacted]', apiKey: '[redacted]', nested: { authorization: '[redacted]', email: '[redacted]', name: 'ok' } });
  ok('one log line per API request (path without query, status, duration); sensitive keys are redacted');
}

// ---- Mapping table ----
{
  assert.equal(toErrorResponse(new HttpError(500, 'db_down', 'DB host 10.1.1.1 down')).body.error, 'Something went wrong on our side. Please try again.');
  assert.equal(toErrorResponse({ status: 409, code: 'conflict', message: 'Already exists.' }).status, 409);
  assert.equal(toErrorResponse('just a string').status, 500);
  ok('HttpError 500s are masked; legacy {status} errors map; anything else is a 500');
}

// ---- server.ts installs async forwarding before any router is loaded ----
{
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../../../../server.ts', import.meta.url), 'utf8');
  const install = src.indexOf("import './src/server/http/installAsyncErrors'");
  const firstRouter = src.search(/import [^\n]* from '\.\/src\/routes\//);
  assert.ok(install > 0 && firstRouter > 0 && install < firstRouter, 'installAsyncErrors must be imported before the routers');
  assert.ok(/app\.use\(errorHandler\(\)\);/.test(src) && /app\.use\(requestContext\(\)\);/.test(src));
  ok('server.ts: async forwarding is installed before routers load; request context and error handler are mounted');
}

setLogSinkForTests(null);
console.log(`\n${passed} passed (HTTP layer)`);
process.exit(0);
