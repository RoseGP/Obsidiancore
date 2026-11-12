/**
 * Cloudflare email worker (src/index.ts, deployed by wrangler.toml / wrangler.jsonc): authentication and input
 * validation through the real fetch handler. The worker is bundled with esbuild; only the Cloudflare-only
 * packages it imports (`agents`, `@cloudflare/voice`) are stubbed.
 *
 * Before the fix: any non-empty Authorization value passed, two hard-coded tokens and unsigned JWTs were
 * accepted, attachment links were signed with a public fallback secret, /connect was open, and /api/send took
 * any `from` and pasted CR/LF from the body into MIME headers.
 * Run: npx tsx src/workers/__tests__/emailWorker.test.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

let passed = 0; const ok = (n: string) => { passed++; console.log('  ✓', n); };
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');

const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'email-worker-')), 'worker.mjs');
await build({
  entryPoints: [path.join(root, 'src/index.ts')], bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'silent',
  external: ['cloudflare:email'],
  plugins: [{
    name: 'cf-stubs',
    setup(b) {
      b.onResolve({ filter: /^(agents|@cloudflare\/voice)$/ }, (a) => ({ path: a.path, namespace: 'stub' }));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export class Agent {}; export const withVoice = (c) => c; export class WorkersAIFluxSTT {}; export class WorkersAITTS {};', loader: 'js' }));
    },
  }],
});
const mod: any = await import(pathToFileURL(out).href);
const worker = mod.default;

const KEY = 'k'.repeat(24) + '-test-master-api-key';
const baseEnv = { MASTER_API_KEY: KEY, DOMAIN_NAME: 'mail.example.test' } as any;
const call = (p: string, init: RequestInit & { env?: any } = {}) => worker.fetch(new Request(`https://worker.test${p}`, init), init.env ?? baseEnv, { waitUntil() {}, passThroughOnException() {} });
const json = (r: Response) => r.json() as Promise<any>;

// ---- Authentication ----
for (const [label, headers] of [
  ['no credentials', {}],
  ['any non-empty Authorization value', { Authorization: 'hello' }],
  ['a random bearer token', { Authorization: 'Bearer not-the-key' }],
  ['removed hard-coded token #1', { Authorization: 'Bearer demo_webmail_jwt_token_2026' }], // lint-guards: allow (negative test)
  ['removed hard-coded token #2', { 'X-API-Key': 'enterprise_sandbox_token_default_sha512' }], // lint-guards: allow (negative test)
  ['an unsigned JWT with admin claims', { Authorization: 'Bearer eyJhbGciOiJub25lIn0.eyJyb2xlIjoiYWRtaW4ifQ.' }],
] as Array<[string, Record<string, string>]>) {
  const r = await call('/api/emails', { headers });
  assert.equal(r.status, 401, label);
}
ok('/api/emails: missing key, arbitrary values, the removed hard-coded tokens and unsigned JWTs → 401');

let r = await call('/api/turn-credentials', { headers: { Authorization: 'Bearer eyJhbGciOiJub25lIn0.eyJyb2xlIjoiYWRtaW4ifQ.x' } });
assert.equal(r.status, 401);
r = await call('/api/turn-credentials', { headers: { 'x-zero-trust-token': 'any-string' } });
assert.equal(r.status, 401);
ok('/api/turn-credentials: unsigned JWTs and arbitrary "zero-trust" strings → 401');

r = await call('/api/emails', { headers: { Authorization: `Bearer ${KEY}` }, env: { DOMAIN_NAME: 'x.test' } });
assert.equal(r.status, 503); assert.equal((await json(r)).error.code, 'server_misconfigured');
ok('no key configured → 503 for every request (fails closed)');

r = await call('/api/emails', { headers: { Authorization: `Bearer ${KEY}` } });
assert.notEqual(r.status, 401); assert.notEqual(r.status, 503);
r = await call('/api/emails', { headers: { 'X-API-Key': 'old-key-still-valid-during-rotation-xx' }, env: { ...baseEnv, MASTER_API_KEY_PREVIOUS: 'old-key-still-valid-during-rotation-xx' } });
assert.notEqual(r.status, 401);
ok('the configured key (and the previous key during a rotation) is accepted');

r = await call('/connect?leadId=lead_1', { headers: { Upgrade: 'websocket' } });
assert.equal(r.status, 401);
ok('/connect (voice assistant WebSocket) needs the API key');

// ---- Attachment links ----
r = await call('/api/attachments/download?id=att_1&expires=9999999999&sig=' + 'A'.repeat(43));
assert.equal(r.status, 503);
ok('attachment download without a signing secret → 503 (no public fallback secret)');
const SECRET = 's'.repeat(40);
const url = await mod.generatePresignedDownloadUrl('att_1', SECRET, 'https://worker.test', 600);
const forged = await mod.generatePresignedDownloadUrl('att_1', 'cloudflare_r2_attachment_secret_key_2026', 'https://worker.test', 600); // lint-guards: allow (negative test)
const env2 = { ...baseEnv, ATTACHMENT_URL_SECRET: SECRET };
r = await worker.fetch(new Request(forged), env2, {});
assert.equal(r.status, 403);
r = await worker.fetch(new Request(url.replace('att_1', 'att_2')), env2, {});
assert.equal(r.status, 403);
r = await worker.fetch(new Request(url), env2, {});
assert.notEqual(r.status, 403);
ok('links signed with the old fallback secret or for another attachment → 403; a correctly signed link passes');

// ---- /api/send validation ----
const send = (body: unknown) => call('/api/send', { method: 'POST', headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const valid = { userId: 'usr_1', from: 'team@mail.example.test', to: 'client@example.com', subject: 'Hello', text: 'Hi' };
for (const [label, body] of [
  ['missing userId', { ...valid, userId: undefined }],
  ['from on another domain', { ...valid, from: 'ceo@bank.example' }],
  ['missing from (no default sender any more)', { ...valid, from: undefined }],
  ['CR/LF in subject (header injection)', { ...valid, subject: 'Hi\r\nBcc: victim@example.com' }],
  ['CR/LF in recipient', { ...valid, to: 'a@example.com\r\nBcc: b@example.com' }],
  ['display name / angle brackets in recipient', { ...valid, to: 'Eve <eve@example.com>' }],
  ['comma-joined recipients', { ...valid, to: 'a@example.com,b@example.com' }],
  ['too many recipients', { ...valid, to: Array.from({ length: 51 }, (_, i) => `u${i}@example.com`) }],
  ['subject too long', { ...valid, subject: 'x'.repeat(301) }],
  ['no body', { ...valid, text: undefined }],
  ['body too large', { ...valid, text: 'x'.repeat(512 * 1024 + 1) }],
  ['non-object body', ['x']],
] as Array<[string, unknown]>) {
  const res = await send(body);
  assert.equal(res.status, 400, label);
  assert.ok(!JSON.stringify(await json(res)).includes('victim@'), `${label}: value not echoed`);
}
r = await call('/api/send', { method: 'POST', headers: { Authorization: `Bearer ${KEY}` }, body: '{not json' });
assert.equal(r.status, 400);
ok('/api/send: foreign or missing sender, CR/LF injection, malformed or excessive recipients, oversized fields → 400');

r = await send(valid);
assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
ok('/api/send: a valid message on the worker’s own domain is accepted');

fs.rmSync(path.dirname(out), { recursive: true, force: true });
console.log(`\n${passed} passed (email worker)`);
process.exit(0);
