/**
 * Audit log: append-only entries for security-relevant actions, no secrets or message content,
 * admin-only reading, CSV export, and no cross-organization access.
 * Run: npx tsx src/server/__tests__/audit.test.ts
 */
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';

let passed = 0; const ok = (n: string) => { passed++; console.log('  ✓', n); };
Object.assign(process.env, { NODE_ENV: 'test', SOCIAL_ACCOUNTS_DEV_AUTH: 'true', CRM_STORE: 'memory', APP_URL: 'https://app.example.com' });

const { guard, PUBLIC } = await import('../routeGuards');
const { recordAudit, listAudit, auditToCsv, scrubMeta, auditPath } = await import('../audit/auditLog');
const { getDocStore } = await import('../data/docStore');
const { makeOrg, addMember, as } = await import('./fixtures');
const orgs = (await import('../../routes/orgsApi')).default;
const audit = (await import('../../routes/adminAuditApi')).default;
const leads = (await import('../../routes/leadsApi')).default;

const app = express(); app.use(express.json());
app.use('/api/orgs', guard(PUBLIC.none), orgs);
app.use('/api/admin/audit-log', guard(PUBLIC.none), audit);
app.use('/api/leads', guard(PUBLIC.leads), leads);

const A = await makeOrg('ann'); const B = await makeOrg('bob');
await addMember(A.id, 'mia', 'MANAGER'); await addMember(A.id, 'sal', 'SALES_REP');

// ---- Service ----
const e = await recordAudit(A.id, { actorId: 'ann', action: 'test.event', target: { type: 'lead', id: 'lead_1' }, meta: { apiKey: 'sk_live_x', password: 'p', token: 't', body: 'secret message', notes: 'n', count: 3, ok: true, role: 'ADMIN' }, ip: '203.0.113.9' });
assert.ok(e);
assert.deepEqual(e!.meta, { count: 3, ok: true, role: 'ADMIN' });
assert.ok(e!.ipHash && !JSON.stringify(e).includes('203.0.113.9'));
ok('secrets, message content and raw IP addresses are never stored');
assert.deepEqual(scrubMeta({ nested: { a: 1 } as any, list: ['a', 'b'] }), { list: 'a, b' });
ok('only flat, short values are kept');

// ---- Wired actions ----
const inv = await request(app).post('/api/orgs/current/invitations').set(as('ann', A.id)).send({ email: 'new@example.com', role: 'READ_ONLY' });
assert.equal(inv.status, 201);
const role = await request(app).patch('/api/orgs/current/members/sal').set(as('ann', A.id)).send({ role: 'MARKETER' });
assert.equal(role.status, 200);
const key = await request(app).post('/api/orgs/current/embed-keys').set(as('ann', A.id)).send({ label: 'Site', kind: 'secret' });
assert.equal(key.status, 201);
const rows = (await listAudit(A.id, { limit: 100 })).entries;
const by = (a: string) => rows.find((r) => r.action === a);
assert.ok(by('member.invited')); assert.equal(by('member.invited')!.meta.role, 'READ_ONLY');
assert.equal(by('member.role_changed')!.meta.from, 'SALES_REP'); assert.equal(by('member.role_changed')!.meta.to, 'MARKETER');
assert.ok(by('api_key.created'));
assert.ok(!JSON.stringify(rows).includes(key.body.secret), 'the key secret must not be in the audit log');
assert.ok(!JSON.stringify(rows).includes(inv.body.acceptUrl || inv.body.token || '@@none@@'), 'the invite link must not be in the audit log');
ok('invitations, role changes and API keys are audited (without the key or invite link)');

// Lead export and delete are audited.
const { CrmRepository } = await import('../crm/crmRepository');
const repo = await CrmRepository.forOrg(A.id);
await repo.saveLead({ id: 'lead_x', name: 'Zed', email: 'zed@example.com', status: 'new', createdAt: new Date().toISOString() });
const exp = await request(app).get('/api/leads/export').set(as('mia', A.id));
assert.equal(exp.status, 200); assert.match(exp.text, /zed@example.com/);
const del = await request(app).delete('/api/leads/lead_x').set(as('mia', A.id));
assert.equal(del.status, 200);
const after = (await listAudit(A.id, { limit: 100 })).entries;
assert.equal(after.find((r) => r.action === 'data.exported')!.meta.rows, 1);
assert.equal(after.find((r) => r.action === 'record.deleted')!.target.id, 'lead_x');
ok('lead exports and deletions are audited');

// ---- Reading ----
assert.equal((await request(app).get('/api/admin/audit-log')).status, 401);
assert.equal((await request(app).get('/api/admin/audit-log').set(as('mia', A.id))).status, 403);
ok('signed-out callers and non-admins can’t read the audit log');
const page1 = await request(app).get('/api/admin/audit-log?limit=2').set(as('ann', A.id));
assert.equal(page1.status, 200); assert.equal(page1.body.entries.length, 2); assert.ok(page1.body.nextBefore);
const page2 = await request(app).get(`/api/admin/audit-log?limit=2&before=${encodeURIComponent(page1.body.nextBefore)}`).set(as('ann', A.id));
assert.ok(page2.body.entries.every((x: any) => x.at < page1.body.nextBefore));
const filtered = await request(app).get('/api/admin/audit-log?action=member.invited').set(as('ann', A.id));
assert.ok(filtered.body.entries.length >= 1 && filtered.body.entries.every((x: any) => x.action === 'member.invited'));
ok('newest first, paginated, filterable by action');
const csv = await request(app).get('/api/admin/audit-log?format=csv').set(as('ann', A.id));
assert.equal(csv.status, 200); assert.match(csv.headers['content-type'], /text\/csv/);
assert.match(csv.text.split('\n')[0], /^at,actorId,actorEmail,action/);
assert.ok((await listAudit(A.id, { action: 'audit.exported' })).entries.length === 1);
assert.match(auditToCsv([{ ...e!, target: { type: 'x', label: '=HYPERLINK("evil")' } }]), /'=HYPERLINK/);
ok('CSV export works, is itself audited, and neutralizes spreadsheet formulas');

// ---- Tenancy ----
const bOwnB = await request(app).get('/api/admin/audit-log').set(as('bob', B.id));
assert.equal(bOwnB.status, 200);
assert.ok(bOwnB.body.entries.every((x: any) => x.orgId === B.id));
assert.equal((await request(app).get('/api/admin/audit-log').set(as('bob', A.id))).status, 403);
ok('an organization only sees its own audit log; another org’s id is refused');

// ---- Append-only ----
const st = await getDocStore();
const count = (await st.list(auditPath(A.id))).length;
for (const m of ['put', 'patch', 'delete'] as const) assert.equal((await (request(app) as any)[m](`/api/admin/audit-log/${e!.id}`).set(as('ann', A.id))).status, 404);
assert.equal((await st.list(auditPath(A.id))).length, count);
ok('there is no API to change or delete audit entries');

console.log(`\n${passed} passed (audit)`);
process.exit(0);
