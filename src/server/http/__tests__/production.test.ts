/**
 * Production serving and shutdown: hashed assets cached as immutable, index.html revalidated, a missing chunk
 * is a 404 (not index.html), SPA fallback for app routes, API 404s untouched; graceful shutdown lets an
 * in-flight request finish, refuses new connections, runs cleanup once and exits 0 (or 1 on timeout).
 * Run: npx tsx src/server/http/__tests__/production.test.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import request from 'supertest';

Object.assign(process.env, { NODE_ENV: 'test', LOG_LEVEL: 'error' });
const { serveBuiltApp, installGracefulShutdown } = await import('../production');
const { notFoundHandler } = await import('../middleware');

let passed = 0; const ok = (n: string) => { passed++; console.log('  ✓', n); };

// ---- serveBuiltApp ----
const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'obsidian-dist-'));
fs.mkdirSync(path.join(dist, 'assets'));
fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>Obsidian</title>');
fs.writeFileSync(path.join(dist, 'assets', 'index-abc123.js'), 'console.log(1)');
fs.writeFileSync(path.join(dist, 'favicon.svg'), '<svg/>');

const app = express();
app.use('/api', notFoundHandler());
serveBuiltApp(app, dist);

let r = await request(app).get('/assets/index-abc123.js');
assert.equal(r.status, 200); assert.match(r.headers['content-type'], /javascript/);
assert.match(r.headers['cache-control'], /max-age=31536000/); assert.match(r.headers['cache-control'], /immutable/);
ok('hashed assets: served with a one-year immutable cache');

r = await request(app).get('/assets/index-old999.js');
assert.equal(r.status, 404); assert.ok(!r.text.includes('<title>Obsidian</title>'));
ok('a chunk from an older deploy is a 404, not index.html with status 200');

for (const p of ['/', '/index.html', '/deals', '/settings/security']) {
  r = await request(app).get(p);
  assert.equal(r.status, 200, p); assert.match(r.text, /<title>Obsidian<\/title>/, p); assert.equal(r.headers['cache-control'], 'no-cache', p);
}
ok('index.html (and client-side routes) are always revalidated: a new deploy is picked up on the next load');

r = await request(app).get('/favicon.svg');
assert.equal(r.status, 200); assert.ok(!/immutable/.test(r.headers['cache-control'] || ''));
r = await request(app).get('/api/nope');
assert.equal(r.status, 404); assert.match(r.headers['content-type'], /json/);
ok('other static files use normal caching; unknown API paths still get the JSON 404');
fs.rmSync(dist, { recursive: true, force: true });

// ---- installGracefulShutdown ----
{
  let release!: () => void;
  const slow = new Promise<void>((res) => { release = res; });
  const srv = http.createServer(async (req, res) => { if (req.url === '/slow') await slow; res.end('done'); });
  await new Promise<void>((res) => srv.listen(0, '127.0.0.1', () => res()));
  const port = (srv.address() as any).port;
  const exits: number[] = []; let cleanups = 0;
  const shutdown = installGracefulShutdown(srv, { signals: [], timeoutMs: 5000, exit: (c) => exits.push(c), beforeClose: () => { cleanups++; } });

  const inflight = fetch(`http://127.0.0.1:${port}/slow`).then((x) => x.text());
  await new Promise((res) => setTimeout(res, 50));
  await shutdown('SIGTERM');
  await shutdown('SIGTERM');
  assert.equal(cleanups, 1, 'cleanup runs once');
  await assert.rejects(fetch(`http://127.0.0.1:${port}/`, { headers: { connection: 'close' } }), 'new connections are refused');
  assert.deepEqual(exits, [], 'does not exit while a request is still running');
  release();
  assert.equal(await inflight, 'done');
  for (let i = 0; i < 50 && !exits.length; i++) await new Promise((res) => setTimeout(res, 20));
  assert.deepEqual(exits, [0]);
  ok('shutdown: in-flight request finishes, new connections refused, cleanup once, then exit 0');
}
{
  const srv = http.createServer((_req, _res) => { /* never answers */ });
  await new Promise<void>((res) => srv.listen(0, '127.0.0.1', () => res()));
  const port = (srv.address() as any).port;
  const exits: number[] = [];
  const shutdown = installGracefulShutdown(srv, { signals: [], timeoutMs: 150, exit: (c) => exits.push(c) });
  const hung = fetch(`http://127.0.0.1:${port}/`).catch(() => 'aborted');
  await new Promise((res) => setTimeout(res, 50));
  await shutdown('SIGTERM');
  for (let i = 0; i < 50 && !exits.length; i++) await new Promise((res) => setTimeout(res, 20));
  assert.deepEqual(exits, [1]);
  srv.closeAllConnections(); await hung;
  ok('shutdown: a request that never finishes → forced exit 1 after the timeout');
}

console.log(`\n${passed} passed (production serving and shutdown)`);
process.exit(0);
