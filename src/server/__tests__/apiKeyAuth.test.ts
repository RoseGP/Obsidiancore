/**
 * Master API key tests: key generator, Express middleware (Firebase), Worker middleware (Cloudflare).
 * Run: npx tsx src/server/__tests__/apiKeyAuth.test.ts
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';

let passed = 0; const ok = (n: string) => { passed++; console.log('  ✓', n); };
const repo = process.cwd();

// ---- Key generator ----
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keygen-'));
  fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules\n');
  fs.writeFileSync(path.join(dir, '.env'), 'OTHER=1\nMASTER_API_KEY=old\n');
  const run = (...a: string[]) => execFileSync('node', [path.join(repo, 'scripts/generate-api-key.mjs'), ...a], { cwd: dir, encoding: 'utf8' });
  const out = run();
  const env = fs.readFileSync(path.join(dir, '.env'), 'utf8');
  const key = /^MASTER_API_KEY=([0-9a-f]+)$/m.exec(env)![1];
  assert.equal(key.length, 64); assert.match(env, /^OTHER=1$/m); assert.equal((env.match(/MASTER_API_KEY=/g) || []).length, 1);
  ok('generates a 256-bit (64 hex) key and replaces MASTER_API_KEY in .env, keeping other lines');
  assert.ok(!out.includes(key)); ok('the key is not printed (only a fingerprint)');
  assert.match(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8'), /^\.env$/m); ok('.env is added to .gitignore if it wasn’t ignored');
  if (process.platform !== 'win32') { assert.equal(fs.statSync(path.join(dir, '.env')).mode & 0o777, 0o600); ok('.env permissions set to 600'); }
  run('--rotate');
  const env2 = fs.readFileSync(path.join(dir, '.env'), 'utf8');
  assert.equal(/^MASTER_API_KEY_PREVIOUS=(.*)$/m.exec(env2)![1], key); assert.notEqual(/^MASTER_API_KEY=(.*)$/m.exec(env2)![1], key); ok('--rotate keeps the old key as MASTER_API_KEY_PREVIOUS');
  const keys = new Set(Array.from({ length: 20 }, () => { run(); return /^MASTER_API_KEY=(.*)$/m.exec(fs.readFileSync(path.join(dir, '.env'), 'utf8'))![1]; }));
  assert.equal(keys.size, 20); ok('keys are unique across runs');
}

const KEY = 'a'.repeat(64), OLD = 'b'.repeat(64);

// ---- Express / Firebase ----
{
  // Untyped import: functions/ is a separate CommonJS TypeScript project with its own tsconfig.
  const { createApiApp } = await import('../../../functions/src/app' as string);
  let keys: Array<string | undefined> = [KEY];
  const app = createApiApp(() => keys);
  let r = await request(app).get('/api/v1/health').set('x-api-key', KEY);
  assert.equal(r.status, 200); assert.equal(r.body.status, 'ok'); ok('Express: x-api-key → 200');
  r = await request(app).get('/api/v1/health').set('Authorization', `Bearer ${KEY}`);
  assert.equal(r.status, 200); ok('Express: Authorization: Bearer → 200');
  r = await request(app).get('/api/v1/health');
  assert.equal(r.status, 401); assert.deepEqual(r.body, { error: { code: 'missing_api_key', message: r.body.error.message } }); assert.match(r.headers['www-authenticate'], /Bearer/);
  ok('Express: missing key → 401 { error: { code: "missing_api_key" } } + WWW-Authenticate');
  for (const bad of [KEY.slice(0, -1), KEY + 'a', 'A'.repeat(64), '', 'x'.repeat(5000)]) {
    r = await request(app).get('/api/v1/health').set('x-api-key', bad);
    assert.equal(r.status, 401);
  }
  assert.equal(r.body.error.code, 'invalid_api_key'); ok('Express: wrong / truncated / extended / case-changed / huge keys → 401');
  assert.equal((await request(app).get('/api/v1/health').set('Authorization', `Basic ${KEY}`)).status, 401); ok('Express: other auth schemes ignored');
  keys = [KEY, OLD];
  assert.equal((await request(app).get('/api/v1/health').set('x-api-key', OLD)).status, 200); ok('Express: previous key accepted during rotation');
  keys = [undefined, ''];
  r = await request(app).get('/api/v1/health').set('x-api-key', KEY);
  assert.equal(r.status, 503); assert.equal(r.body.error.code, 'server_misconfigured'); ok('Express: no key configured → 503 (fails closed)');
  assert.ok(!JSON.stringify(r.body).includes(KEY)); ok('Express: responses never include the key');
}

// ---- Cloudflare Worker ----
{
  const worker = (await import('../../workers/healthApi')).default;
  const ctx: any = { waitUntil() {}, passThroughOnException() {} };
  const call = (headers: Record<string, string>, env: any = { MASTER_API_KEY: KEY }, method = 'GET', p = '/api/v1/health') => worker.fetch(new Request(`https://api.example${p}`, { method, headers }), env, ctx);
  let r = await call({ 'x-api-key': KEY });
  assert.equal(r.status, 200); assert.equal((await r.json()).status, 'ok'); ok('Worker: x-api-key → 200');
  assert.equal((await call({ Authorization: `Bearer ${KEY}` })).status, 200); ok('Worker: Authorization: Bearer → 200');
  r = await call({});
  assert.equal(r.status, 401); assert.equal((await r.json()).error.code, 'missing_api_key'); assert.match(r.headers.get('www-authenticate')!, /Bearer/); ok('Worker: missing → 401 missing_api_key');
  r = await call({ 'x-api-key': KEY.slice(0, -1) + 'b' });
  assert.equal(r.status, 401); assert.equal((await r.json()).error.code, 'invalid_api_key'); ok('Worker: wrong key → 401 invalid_api_key');
  assert.equal((await call({ 'x-api-key': OLD }, { MASTER_API_KEY: KEY, MASTER_API_KEY_PREVIOUS: OLD })).status, 200); ok('Worker: previous key accepted during rotation');
  assert.equal((await call({ 'x-api-key': KEY }, {})).status, 503); ok('Worker: no secret configured → 503 (fails closed)');
  assert.equal((await call({ 'x-api-key': KEY }, { API_KEY: KEY })).status, 200); ok('Worker: legacy API_KEY still accepted');
  r = await call({ Origin: 'https://evil.example', 'x-api-key': KEY });
  assert.equal(r.headers.get('access-control-allow-origin'), null); ok('Worker: no CORS for unlisted origins (server-to-server by default)');
  r = await call({ Origin: 'https://app.example', 'x-api-key': KEY }, { MASTER_API_KEY: KEY, ALLOWED_ORIGINS: 'https://app.example' });
  assert.equal(r.headers.get('access-control-allow-origin'), 'https://app.example'); ok('Worker: listed origin gets CORS headers');
  assert.equal((await call({}, { MASTER_API_KEY: KEY }, 'GET', '/other')).status, 401); ok('Worker: every route is behind the key (no unauthenticated 404 probing)');
}

console.log(`\n${passed} passed (api key auth)`);
