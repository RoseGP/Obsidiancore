/**
 * Centralized RBAC: the permission matrix agrees with the older rank checks, every role gets exactly the
 * access it should on representative endpoints, and guests are refused everywhere except what allows them.
 * Run: npx tsx src/server/__tests__/rbac.test.ts
 */
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';

let passed = 0; const ok = (n: string) => { passed++; console.log('  ✓', n); };
Object.assign(process.env, { NODE_ENV: 'test', SOCIAL_ACCOUNTS_DEV_AUTH: 'true', CRM_STORE: 'memory', APP_URL: 'https://app.example.com' });

const { guard, PUBLIC } = await import('../routeGuards');
const { ROLES, can } = await import('../tenancy/orgs');
const { canAccess, permissionTable, ROLE_MATRIX, MODULES, PERMISSIONS } = await import('../security/permissions');
const { allowGuest, requireTenant } = await import('../tenancy/middleware');
const { makeOrg, addMember, as } = await import('./fixtures');
const { CrmRepository } = await import('../crm/crmRepository');

const app = express(); app.use(express.json());
app.use('/api/leads', guard(PUBLIC.leads), (await import('../../routes/leadsApi')).default);
app.use('/api/orgs', guard(PUBLIC.none), (await import('../../routes/orgsApi')).default);
app.use('/api/dashboard', guard(PUBLIC.none), (await import('../../routes/dashboardApi')).default);
app.use('/api/security', guard(PUBLIC.none), (await import('../../routes/securityApi')).default);
app.use('/api/compliance', guard(PUBLIC.none), (await import('../../routes/complianceApi')).default);
app.use('/api/admin/audit-log', guard(PUBLIC.none), (await import('../../routes/adminAuditApi')).default);
app.get('/api/guest-ok', guard(PUBLIC.none), allowGuest, requireTenant, (_req, res) => res.json({ success: true }));

// ---- Matrix ----
assert.deepEqual([...ROLES].sort(), Object.keys(ROLE_MATRIX).sort());
for (const role of ['OWNER', 'ADMIN'] as const) for (const m of MODULES) for (const p of PERMISSIONS) assert.ok(canAccess(role, m, p), `${role} ${m}.${p}`);
ok('owners and admins hold every permission');
for (const role of ROLES) {
  for (const m of MODULES) {
    // Anything beyond viewing needs at least the old "write" rank; deleting/exporting CRM records needs manage_records.
    if (['create', 'edit', 'share'].some((p) => canAccess(role, m, p as any))) assert.ok(can(role, 'write'), `${role} ${m} write rank`);
    if (['leads', 'contacts', 'deals'].includes(m) && (canAccess(role, m, 'delete') || canAccess(role, m, 'export'))) assert.ok(can(role, 'manage_records'), `${role} ${m} delete/export rank`);
    if (canAccess(role, m, 'view') && role !== 'GUEST') assert.ok(can(role, 'read'));
  }
  if (canAccess(role, 'compliance', 'manage') || canAccess(role, 'audit', 'view') || canAccess(role, 'settings', 'manage')) assert.ok(can(role, 'manage_org'), `${role} admin`);
}
ok('the matrix never grants more than the older rank checks allow');
assert.deepEqual(Object.entries(ROLE_MATRIX.GUEST), [['meetings', ['view']]]);
assert.equal(can('GUEST', 'read'), false);
ok('GUEST can only view meetings and passes no rank check');
const table = permissionTable();
assert.equal(table.roles.length, ROLES.length); assert.ok(table.modules.includes('compliance'));
ok('the permission table lists every role and module');

// ---- Endpoints per role ----
const A = await makeOrg('own');
const roles = { adm: 'ADMIN', mgr: 'MANAGER', rep: 'SALES_REP', mkt: 'MARKETER', sup: 'SUPPORT_AGENT', ro: 'READ_ONLY', gst: 'GUEST' } as const;
for (const [uid, role] of Object.entries(roles)) await addMember(A.id, uid, role);
const repo = await CrmRepository.forOrg(A.id);
const seed = async (id: string) => repo.saveLead({ id, name: `Lead ${id}`, email: `${id}@example.com`, status: 'new', createdAt: new Date().toISOString() });

const expect = async (uid: string, method: 'get' | 'post' | 'delete' | 'put', path: string, status: number, body?: any) => {
  const r = await (request(app) as any)[method](path).set(as(uid, A.id)).send(body ?? {});
  assert.equal(r.status, status, `${uid} ${method.toUpperCase()} ${path} → ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
  return r;
};

for (const uid of ['own', 'adm', 'mgr', 'rep', 'mkt', 'sup', 'ro']) await expect(uid, 'get', '/api/leads', 200);
await expect('gst', 'get', '/api/leads', 403);
await expect('gst', 'get', '/api/dashboard/stats', 403);
await expect('gst', 'get', '/api/orgs/current/members', 403);
await expect('gst', 'get', '/api/guest-ok', 200);
ok('guests are refused on CRM routes and reach only routes that allow guests');

for (const uid of ['own', 'adm', 'mgr']) await expect(uid, 'get', '/api/leads/export', 200);
for (const uid of ['rep', 'mkt', 'sup', 'ro']) await expect(uid, 'get', '/api/leads/export', 403);
ok('only managers and admins can export leads');

for (const uid of ['rep', 'mkt', 'sup', 'ro']) { await seed(`l_${uid}`); await expect(uid, 'delete', `/api/leads/l_${uid}`, 403); }
await seed('l_mgr'); await expect('mgr', 'delete', '/api/leads/l_mgr', 200);
for (const uid of ['rep', 'ro']) await expect(uid, 'post', '/api/leads/bulk', 403, { action: 'delete', leadIds: ['l_rep'] });
const bulk = await expect('mgr', 'post', '/api/leads/bulk', 200, { action: 'delete', leadIds: ['l_rep', 'l_ro'] });
assert.equal(bulk.body.count, 2);
ok('only managers and admins can delete leads (one by one or in bulk)');

await expect('ro', 'post', '/api/leads', 403, { name: 'X', email: 'x@example.com' });
for (const uid of ['rep', 'mkt']) await expect(uid, 'post', '/api/leads', 201, { name: `New ${uid}`, email: `${uid}-new@example.com` });
// The role matrix (leads: view only for support agents) is now enforced on the API, not just the rank check.
await expect('sup', 'post', '/api/leads', 403, { name: 'New sup', email: 'sup-new@example.com' });
ok('read-only members can’t create records; the other working roles can');

for (const uid of ['own', 'adm']) { await expect(uid, 'get', '/api/compliance/requests', 200); await expect(uid, 'get', '/api/admin/audit-log', 200); await expect(uid, 'get', '/api/security/overview', 200); }
for (const uid of ['mgr', 'rep', 'mkt', 'sup', 'ro']) { await expect(uid, 'get', '/api/compliance/requests', 403); await expect(uid, 'get', '/api/admin/audit-log', 403); await expect(uid, 'put', '/api/security/policy', 403, { maxSessionHours: 1 }); }
ok('compliance, the audit log and security settings are admin-only');

for (const uid of ['own', 'ro', 'sup']) { const r = await expect(uid, 'get', '/api/security/roles', 200); assert.ok(r.body.roles.some((x: any) => x.role === 'SUPPORT_AGENT')); }
ok('every member can read the roles table');

await expect('rep', 'post', '/api/orgs/current/invitations', 403, { email: 'g@example.com', role: 'GUEST' });
const inv = await expect('adm', 'post', '/api/orgs/current/invitations', 201, { email: 'g@example.com', role: 'GUEST' });
assert.equal(inv.body.invitation.role, 'GUEST');
await expect('adm', 'post', '/api/orgs/current/invitations', 201, { email: 's@example.com', role: 'SUPPORT_AGENT' });
ok('admins can invite support agents and guests; sales reps can’t invite');

// Cross-tenant: membership in one org grants nothing in another.
const B = await makeOrg('other');
const r = await request(app).get('/api/leads').set(as('mgr', B.id));
assert.equal(r.status, 403);
ok('a role in one organization grants nothing in another');

console.log(`\n${passed} passed (rbac)`);
process.exit(0);
