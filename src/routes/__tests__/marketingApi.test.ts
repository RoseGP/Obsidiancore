/**
 * Marketing API (/api/marketing): organization role matrix, workspace roles, validation, nothing simulated.
 * Run: npx tsx src/routes/__tests__/marketingApi.test.ts
 */
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';

Object.assign(process.env, { NODE_ENV: 'test', SOCIAL_ACCOUNTS_DEV_AUTH: 'true', CRM_STORE: 'memory', LOG_LEVEL: 'error' });
const { guard, PUBLIC } = await import('../../server/routeGuards');
const { errorHandler } = await import('../../server/http/middleware');
const { makeOrg, addMember, as } = await import('../../server/__tests__/fixtures');

const app = express(); app.use(express.json());
app.use('/api/marketing', guard(PUBLIC.none), (await import('../marketingApi')).default);
app.use(errorHandler());

let passed = 0; const ok = (n: string) => { passed++; console.log('  ✓', n); };
const org = (await makeOrg('mona')).id;
for (const [u, role] of [['max', 'MARKETER'], ['sal', 'SALES_REP'], ['sup', 'SUPPORT_AGENT'], ['ro', 'READ_ONLY'], ['mae', 'MARKETER']] as const) await addMember(org, u, role);
const M = '/api/marketing';
const call = (u: string, method: 'get' | 'post' | 'delete', path: string, body?: unknown, extra: Record<string, string> = {}) => {
  const r = (request(app) as any)[method](path).set(as(u, org, extra));
  return body === undefined ? r : r.send(body);
};

// ---- Organization role matrix ----
assert.equal((await request(app).get(`${M}/workspaces`)).status, 401);
for (const u of ['sup', 'ro']) assert.equal((await call(u, 'get', `${M}/workspaces`)).status, 403, u);
assert.equal((await call('sal', 'get', `${M}/workspaces`)).status, 200);
assert.equal((await call('sal', 'post', `${M}/workspaces`, { name: 'Nope' })).status, 403);
ok('role matrix: signed-out 401; support agent and read-only 403; sales rep may view but not create');

let r = await call('max', 'post', `${M}/workspaces`, { name: 'Spring launch' });
assert.equal(r.status, 201); const ws = r.body.workspace.id;
const H = { 'X-Workspace-Id': ws };

// ---- Validation ----
for (const body of [{}, { name: '' }, { name: 'x'.repeat(121) }, { name: 42 }]) assert.equal((await call('max', 'post', `${M}/workspaces`, body)).status, 400, JSON.stringify(body));
for (const body of [{ email: 'not-an-email' }, { email: 7 }, { email: 'a@b.test', tags: Array(21).fill('t') }, { email: 'a@b.test', firstName: 'x'.repeat(81) }]) {
  r = await call('max', 'post', `${M}/subscribers`, body, H);
  assert.equal(r.status, 400, JSON.stringify(body).slice(0, 60)); assert.equal(r.body.code, 'invalid_input');
}
r = await call('max', 'post', `${M}/subscribers`, { email: ' Ana@Harbor.TEST ', firstName: 'Ana', tags: ['vip'], role: 'admin', userId: 'x' }, H);
assert.equal(r.status, 201); assert.equal(r.body.subscriber.email, 'ana@harbor.test'); assert.equal(r.body.subscriber.role, undefined, 'unknown fields dropped');
for (const body of [{ name: 'C', subject: 'S', content: 'Hi' }, { name: 'C', subject: 'S', content: 'Hi', fromEmail: 'bad' }, { name: 'C', subject: 'x'.repeat(301), content: 'Hi', fromEmail: 'a@b.test' }]) {
  assert.equal((await call('max', 'post', `${M}/campaigns`, body, H)).status, 400);
}
assert.equal((await call('max', 'get', `${M}/subscribers?status=everything`, undefined, H)).status, 400);
assert.equal((await call('max', 'delete', `${M}/subscribers/..%2Fx`, undefined, H)).status, 400);
ok('validation: workspace, subscriber, campaign bodies and filters checked; emails normalized; unknown fields dropped');

// ---- Workspace roles and invitations ----
r = await call('max', 'post', `${M}/workspaces/${ws}/invitations`, { email: 'mae@example.com', role: 'member' });
assert.equal(r.status, 201); const token = r.body.invitation.token;
r = await call('mae', 'post', `${M}/invitations/accept`, { token }, { 'X-Dev-User-Email': 'someone-else@example.com' });
assert.equal(r.status, 400, 'invitation is bound to the invited address');
r = await call('mae', 'post', `${M}/invitations/accept`, { token });
assert.equal(r.status, 400, 'unverified email');
r = await call('mae', 'post', `${M}/invitations/accept`, { token }, { 'X-Dev-User-Email': 'mae@example.com' });
assert.equal(r.status, 200);
assert.equal((await call('mae', 'post', `${M}/workspaces/${ws}/invitations`, { email: 'x@example.com' })).status, 403, 'members can’t invite');
assert.equal((await call('mae', 'post', `${M}/api-tokens`, { name: 'ci' }, H)).status, 403, 'members can’t create tokens');
assert.equal((await call('max', 'post', `${M}/workspaces/${ws}/invitations`, { email: 'y@example.com', role: 'admin' })).status, 201, 'owner may invite admins');
assert.equal((await call('mae', 'get', `${M}/subscribers`, undefined, { 'X-Workspace-Id': 'ws_someone_else' })).status, 403);
ok('workspaces: invitations bound to the verified invited email; only owners/admins invite or manage tokens; other workspaces 403');

// ---- Nothing simulated ----
r = await call('max', 'post', `${M}/campaigns`, { name: 'Launch', subject: 'Hello', content: '<p>Hi</p>', fromEmail: 'team@example.com' }, H);
assert.equal(r.status, 201); const camp = r.body.campaign.id;
r = await call('max', 'post', `${M}/campaigns/${camp}/send`, undefined, H);
assert.equal(r.status, 501); assert.equal(r.body.code, 'not_available');
assert.equal((await call('max', 'get', `${M}/campaigns`, undefined, H)).body.campaigns[0].status, 'draft', 'not marked sent');
assert.equal((await call('max', 'post', `${M}/engine/command`, { command: 'npm list' }, H)).status, 501);
r = await call('max', 'get', `${M}/engine/status`, undefined, H);
assert.ok(!/node|v\d+\.\d+|rss|heap/i.test(JSON.stringify(r.body)), 'no runtime or memory details');
ok('nothing simulated: send and command console → 501; campaign stays draft; status has no runtime details');

console.log(`\n${passed} passed (marketing API)`);
process.exit(0);
