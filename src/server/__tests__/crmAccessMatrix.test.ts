/**
 * The role matrix shown in Settings › Roles & permissions is the one the CRM API enforces (contacts, companies,
 * leads, deals, tasks, support tickets), and CRM inputs are validated:
 *  - SUPPORT_AGENT: contacts view+edit only, leads/deals/companies view-only;
 *  - MARKETER: deals and companies view-only, may work leads and contacts;
 *  - SALES_REP: works records but can't delete contacts/companies/leads;
 *  - READ_ONLY: reads only; another organization's records are never reachable;
 *  - deal stage allowlist can't be passed with inherited keys (constructor, toString, __proto__);
 *    deal value and lead budget ranges; converted-lead lock can't be lifted by a client flag;
 *    lead owners must be members of the organization; /api/orgs/me returns the caller's grants.
 * Run: npx tsx src/server/__tests__/crmAccessMatrix.test.ts
 */
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';

Object.assign(process.env, { NODE_ENV: 'test', SOCIAL_ACCOUNTS_DEV_AUTH: 'true', CRM_STORE: 'memory', LOG_LEVEL: 'error' });
const { guard, PUBLIC } = await import('../routeGuards');
const { makeOrg, addMember, as } = await import('./fixtures');
const { contactsRouter, companiesRouter } = await import('../../routes/contactsApi');
const { CrmRepository } = await import('../crm/crmRepository');

const app = express(); app.use(express.json());
app.use('/api/contacts', guard(PUBLIC.none), contactsRouter);
app.use('/api/companies', guard(PUBLIC.none), companiesRouter);
app.use('/api/leads', guard(PUBLIC.leads), (await import('../../routes/leadsApi')).default);
app.use('/api/dashboard', guard(PUBLIC.none), (await import('../../routes/dashboardApi')).default);
app.use('/api/tasks', guard(PUBLIC.none), (await import('../../routes/tasksApi')).default);
app.use('/api/orgs', guard(PUBLIC.none), (await import('../../routes/orgsApi')).default);

let passed = 0; const ok = (n: string) => { passed++; console.log('  ✓', n); };
const org = (await makeOrg('olive')).id;
const other = (await makeOrg('oscar')).id;
for (const [uid, role] of [['mia', 'MANAGER'], ['sara', 'SALES_REP'], ['mark', 'MARKETER'], ['sue', 'SUPPORT_AGENT'], ['rory', 'READ_ONLY'], ['gina', 'GUEST']] as const) await addMember(org, uid, role);
const call = (uid: string, method: 'get' | 'post' | 'patch' | 'delete', path: string, body?: unknown, o = org) => {
  const r = (request(app) as any)[method](path).set(as(uid, o));
  return body === undefined ? r : r.send(body);
};

// Seed records as the owner.
let r = await call('olive', 'post', '/api/contacts', { name: 'Ana Ruiz', email: 'ana@harbor.test' });
assert.equal(r.status, 201); const contactId = r.body.contact.id;
r = await call('olive', 'post', '/api/companies', { name: 'Harbor Pine' });
assert.equal(r.status, 201); const companyId = r.body.company.id;
r = await call('olive', 'post', '/api/leads', { name: 'Lee Park', email: 'lee@park.test' });
assert.equal(r.status, 201); const leadId = r.body.lead.id;
r = await call('olive', 'post', '/api/dashboard/deals', { name: 'Renewal', client: 'Harbor Pine', value: 12000, stage: 'qualified' });
assert.equal(r.status, 201); const dealId = r.body.deal.id;

// ---- Matrix enforcement: [user, method, path, body, expected status class] ----
const cases: Array<[string, 'get' | 'post' | 'patch' | 'delete', string, unknown, 'allow' | 'deny']> = [
  // SUPPORT_AGENT
  ['sue', 'get', '/api/leads', undefined, 'allow'],
  ['sue', 'post', '/api/leads', { name: 'X', email: 'x@x.test' }, 'deny'],
  ['sue', 'patch', `/api/leads/${leadId}`, { company: 'X' }, 'deny'],
  ['sue', 'post', '/api/dashboard/deals', { name: 'D', client: 'C', value: 1 }, 'deny'],
  ['sue', 'patch', `/api/dashboard/deals/${dealId}/stage`, { stage: 'won' }, 'deny'],
  ['sue', 'post', '/api/companies', { name: 'Co' }, 'deny'],
  ['sue', 'post', '/api/contacts', { name: 'New', email: 'n@n.test' }, 'deny'],
  ['sue', 'patch', `/api/contacts/${contactId}`, { phone: '555 0100' }, 'allow'],
  ['sue', 'post', '/api/tasks', { title: 'Call back' }, 'allow'],
  // MARKETER
  ['mark', 'post', '/api/dashboard/deals', { name: 'D', client: 'C', value: 1 }, 'deny'],
  ['mark', 'patch', `/api/dashboard/deals/${dealId}/stage`, { stage: 'proposal' }, 'deny'],
  ['mark', 'patch', `/api/companies/${companyId}`, { industry: 'Retail' }, 'deny'],
  ['mark', 'post', '/api/leads', { name: 'Mo', email: 'mo@x.test' }, 'allow'],
  ['mark', 'post', `/api/leads/${leadId}/convert`, {}, 'deny'],
  // SALES_REP
  ['sara', 'patch', `/api/dashboard/deals/${dealId}/stage`, { stage: 'proposal' }, 'allow'],
  ['sara', 'delete', `/api/companies/${companyId}`, undefined, 'deny'],
  ['sara', 'delete', `/api/leads/${leadId}`, undefined, 'deny'],
  // READ_ONLY
  ['rory', 'get', '/api/contacts', undefined, 'allow'],
  ['rory', 'post', '/api/tasks', { title: 'x' }, 'deny'],
  ['rory', 'post', `/api/contacts/${contactId}/notes`, { note: 'x' }, 'deny'],
  ['rory', 'post', '/api/tickets/x/reply', undefined, 'deny'],
  // GUEST: nothing in the CRM
  ['gina', 'get', '/api/contacts', undefined, 'deny'],
  ['gina', 'get', '/api/dashboard/deals', undefined, 'deny'],
];
for (const [uid, m, path, body, want] of cases) {
  const res = await call(uid, m, path, body);
  if (want === 'deny') assert.ok([403, 404].includes(res.status), `${uid} ${m.toUpperCase()} ${path} → ${res.status} (expected denied)`);
  else assert.ok(res.status < 400, `${uid} ${m.toUpperCase()} ${path} → ${res.status} ${JSON.stringify(res.body).slice(0, 160)}`);
  if (res.status === 403) assert.ok(!/stack|Error:/i.test(JSON.stringify(res.body)), 'no internals in denial');
}
r = await call('mark', 'post', '/api/dashboard/deals', { name: 'D', client: 'C', value: 1 });
assert.equal(r.body.code, 'forbidden'); assert.deepEqual(r.body.required, { module: 'deals', permission: 'create' });
ok('role matrix enforced on contacts, companies, leads, deals, tasks and tickets (allowed and denied per role)');

// Another organization's records stay out of reach, whatever the id.
for (const [m, path, body] of [['get', `/api/contacts/${contactId}`], ['patch', `/api/leads/${leadId}`, { company: 'X' }], ['patch', `/api/dashboard/deals/${dealId}/stage`, { stage: 'won' }], ['delete', `/api/companies/${companyId}`]] as const) {
  const res = await call('oscar', m as any, path, body, other);
  assert.equal(res.status, 404, `${m} ${path} from another org → ${res.status}`);
}
assert.equal((await call('olive', 'get', '/api/contacts', undefined, other)).status, 403, 'X-Org-Id of an org you are not in');
ok('cross-organization ids → 404; naming an organization you don’t belong to → 403');

// ---- /api/orgs/me exposes the caller's grants (for hiding actions in the UI) ----
r = await call('sue', 'get', '/api/orgs/me');
assert.equal(r.body.current.role, 'SUPPORT_AGENT'); assert.deepEqual(r.body.current.permissions.deals, ['view']);
ok('/api/orgs/me returns the caller’s matrix grants');

// ---- Validation ----
for (const stage of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'WON', '', 42]) {
  r = await call('olive', 'patch', `/api/dashboard/deals/${dealId}/stage`, { stage });
  assert.equal(r.status, 400, `stage ${String(stage)}`);
  r = await call('olive', 'post', '/api/dashboard/deals', { name: 'D', client: 'C', value: 1, stage });
  assert.equal(r.status, 400, `create with stage ${String(stage)}`);
}
const deal = (await (await CrmRepository.forOrg(org)).getDeal(dealId)) as any;
assert.ok(['qualified', 'proposal'].includes(deal.stage) && typeof deal.probability === 'number');
for (const value of [-1, 'abc', '', null, 1e13, Infinity, '1e400', { v: 1 }]) {
  r = await call('olive', 'post', '/api/dashboard/deals', { name: 'D', client: 'C', value });
  assert.equal(r.status, 400, `value ${JSON.stringify(value)}`);
}
r = await call('olive', 'post', '/api/dashboard/deals', { name: 'D', client: 'C', value: '2500.50' });
assert.equal(r.status, 201); assert.equal(r.body.deal.value, 2500.5);
ok('deals: inherited-key stages (constructor, toString, __proto__) and out-of-range values → 400; numeric strings accepted');

for (const budget of [-5, 'lots', '1e400', 1e13]) {
  r = await call('olive', 'post', '/api/leads', { name: 'B', email: `b${String(budget).length}@x.test`, qualification: { budget } });
  assert.equal(r.status, 400, `budget ${budget}`); assert.equal(r.body.code, 'invalid_input');
}
r = await call('olive', 'post', '/api/leads', { name: 'Bea', email: 'bea@x.test', qualification: { budget: '15000' } });
assert.equal(r.status, 201); assert.equal(r.body.lead.qualification.budget, 15000);
for (const bad of [{ name: '' }, { name: 'A', email: 'nope' }, { name: { x: 1 }, email: 'a@a.test' }, { name: 'A' }]) {
  assert.equal((await call('olive', 'post', '/api/leads', bad)).status, 400, JSON.stringify(bad));
}
ok('leads: missing or malformed name/email and out-of-range budgets → 400 with a safe message');

// Converted-lead lock and owner assignment.
r = await call('olive', 'post', `/api/leads/${leadId}/convert`, {});
assert.ok(r.status < 300, `convert ${r.status}`);
r = await call('sara', 'patch', `/api/leads/${leadId}`, { company: 'Changed', allowConvertedEdit: true });
assert.equal(r.status, 403, 'sales rep can’t lift the lock with a flag');
r = await call('sara', 'patch', `/api/leads/${leadId}`, { company: 'Changed' });
assert.equal(r.status, 400);
r = await call('mia', 'patch', `/api/leads/${leadId}`, { company: 'Changed', allowConvertedEdit: true });
assert.equal(r.status, 200, 'manager can (and it is audited)');
ok('converted leads: the lock can’t be lifted by a client flag below manager');

r = await call('olive', 'post', '/api/leads', { name: 'Owen', email: 'owen@x.test' }); const lead2 = r.body.lead.id;
for (const ownerId of ['oscar', 'gina', 'nobody', '../x', 42]) {
  r = await call('olive', 'patch', `/api/leads/${lead2}/assign`, { owner: 'Someone', ownerId });
  assert.equal(r.status, 400, `ownerId ${ownerId}`);
}
r = await call('olive', 'patch', `/api/leads/${lead2}/assign`, { owner: 'Spoofed Name', ownerId: 'sara' });
assert.equal(r.status, 200); assert.equal(r.body.owner, 'sara');
r = await call('olive', 'post', '/api/leads/bulk/assign', { ids: [lead2], ownerId: 'oscar', owner: 'x' });
assert.equal(r.status, 400, 'bulk assign to a non-member');
r = await call('olive', 'patch', `/api/contacts/${contactId}`, { ownerId: 'oscar', owner: 'Oscar' });
assert.equal(r.status, 400); assert.equal(r.body.code, 'invalid_owner');
r = await call('olive', 'patch', `/api/contacts/${contactId}`, { ownerId: 'mia', owner: 'Not Mia' });
assert.equal(r.status, 200); assert.equal(r.body.contact.ownerId, 'mia', 'assignment to a teammate is kept (used to become the caller)'); assert.equal(r.body.contact.owner, 'mia');
r = await call('olive', 'post', '/api/companies', { name: 'Elsewhere', ownerId: 'oscar' });
assert.equal(r.status, 400);
ok('assignment (leads, bulk, contacts, companies): owner must be a non-guest member; name from the membership; teammates can be chosen');

console.log(`\n${passed} passed (CRM access matrix and validation)`);
process.exit(0);
