/**
 * Phase 1 tenancy tests: organization isolation, roles, invitations, lead capture keys, conversion races,
 * chat session privacy and AI tool scoping. Runs against the strict in-memory store (no Google credentials).
 * Run: npx tsx src/server/__tests__/tenancy.test.ts
 */
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';

let passed = 0; const ok = (n: string) => { passed++; console.log('  ✓', n); };
Object.assign(process.env, { NODE_ENV: 'test', SOCIAL_ACCOUNTS_DEV_AUTH: 'true', CRM_STORE: 'memory', APP_URL: 'https://crm.example.test' });
delete process.env.LEGACY_LEAD_CAPTURE_ORG_ID; delete process.env.CRM_AUTO_PROVISION_ORG; delete process.env.GEMINI_API_KEY;

const { MemoryDocStore, setDocStore, assertId } = await import('../data/docStore');
const store = new MemoryDocStore(); setDocStore(store);
const { guard, PUBLIC } = await import('../routeGuards');
const leads = (await import('../../routes/leadsApi')).default;
const dashboard = (await import('../../routes/dashboardApi')).default;
const orgs = (await import('../../routes/orgsApi')).default;
const chat = (await import('../../routes/chat')).default;
const { executeCrmTool } = await import('../../services/crmAiAssistant');

const app = express(); app.use(express.json());
app.use('/api/orgs', guard(PUBLIC.none), orgs);
app.use('/api/leads', guard(PUBLIC.leads), leads);
app.use('/api/dashboard', guard(PUBLIC.none), dashboard);
app.use('/api/chat', guard(PUBLIC.none), chat);
const as = (uid: string, email?: string) => ({ 'X-Dev-User-Id': uid, ...(email ? { 'X-Dev-User-Email': email } : {}) });

// ---- Path safety ----
assert.throws(() => assertId('a/b')); assert.throws(() => assertId('..')); assert.throws(() => assertId(''));
ok('ids containing "/" or ".." are rejected before reaching the store');

// ---- Personal organizations ----
let r = await request(app).get('/api/orgs/me').set(as('alice'));
assert.equal(r.status, 200); const orgA = r.body.current.orgId; assert.equal(r.body.current.role, 'OWNER');
ok('first sign-in gets a personal organization as OWNER');
r = await request(app).get('/api/orgs/me').set(as('alice'));
assert.equal(r.body.current.orgId, orgA); assert.equal(r.body.organizations.length, 1); ok('…and only one, on repeat requests');
await Promise.all([1, 2, 3].map(() => request(app).get('/api/orgs/me').set(as('carol'))));
r = await request(app).get('/api/orgs/me').set(as('carol'));
assert.equal(r.body.organizations.length, 1); ok('concurrent first requests still create a single organization');
const orgB = (await request(app).get('/api/orgs/me').set(as('bob'))).body.current.orgId;
assert.notEqual(orgA, orgB);

// ---- Cross-organization isolation ----
r = await request(app).post('/api/leads').set(as('alice')).send({ name: 'Ada Lovelace', email: 'ada@acme.test', company: 'Acme' });
assert.equal(r.status, 201); const leadA = r.body.lead.id; assert.equal(r.body.lead.orgId, orgA);
ok('lead created in the caller’s organization');
r = await request(app).get('/api/leads').set(as('bob'));
assert.equal(r.body.count, 0); ok('another organization’s list does not include it');
assert.equal((await request(app).get(`/api/leads/${leadA}`).set(as('bob'))).status, 404); ok('GET by id from another organization → 404');
assert.equal((await request(app).patch(`/api/leads/${leadA}`).set(as('bob')).send({ name: 'pwned' })).status, 404); ok('PATCH from another organization → 404');
assert.equal((await request(app).delete(`/api/leads/${leadA}`).set(as('bob'))).status, 404); ok('DELETE from another organization → 404');
assert.equal((await request(app).post(`/api/leads/${leadA}/convert`).set(as('bob')).send({})).status, 404); ok('convert from another organization → 404');
r = await request(app).post('/api/leads/bulk/status').set(as('bob')).send({ ids: [leadA], status: 'unqualified' });
assert.equal(r.body.count, 0); assert.deepEqual(r.body.skipped, [leadA]); ok('bulk update skips ids from another organization');
r = await request(app).get('/api/leads').set(as('bob')).set('X-Org-Id', orgA);
assert.equal(r.status, 403); ok('X-Org-Id naming an organization you don’t belong to → 403');
r = await request(app).get(`/api/leads/${leadA}`).set(as('alice'));
assert.equal(r.body.lead.name, 'Ada Lovelace'); ok('the owner’s lead is untouched by all of the above');
assert.equal((await request(app).get('/api/leads/..%2F..%2Fcrm_user_memberships%2Falice').set(as('bob'))).status, 400); ok('path-traversal id → 400');

// ---- Dashboard isolation and honesty ----
r = await request(app).post('/api/dashboard/deals').set(as('alice')).send({ name: 'Pilot', client: 'Acme', value: 1000, stage: 'qualified' });
assert.equal(r.status, 201);
assert.equal((await request(app).get('/api/dashboard/deals').set(as('bob'))).body.deals.length, 0); ok('deals are per organization');
r = await request(app).get('/api/dashboard/stats').set(as('bob'));
assert.equal(r.body.stats.totalPipelineValue, 0); assert.equal(r.body.stats.callsToday, null); ok('empty organization shows zeros and unknowns, never sample data');
r = await request(app).get('/api/dashboard/activities').set(as('bob'));
assert.equal(r.body.activities.length, 0); ok('activity feed is per organization');

// ---- Conversion: one transaction, no duplicates ----
const conv = await Promise.all([1, 2, 3].map(() => request(app).post(`/api/leads/${leadA}/convert`).set(as('alice')).send({ dealValue: 5000 })));
assert.equal(conv.filter((x) => x.status === 200).length, 1); assert.equal(conv.filter((x) => x.status === 409).length, 2);
ok('three simultaneous conversions → exactly one deal, two 409s');
assert.equal((await request(app).get('/api/dashboard/deals').set(as('alice'))).body.deals.length, 2); ok('…and exactly one extra deal exists');

// ---- Invitations and roles ----
r = await request(app).post('/api/orgs/current/invitations').set(as('alice')).send({ email: 'dave@acme.test', role: 'READ_ONLY' });
assert.equal(r.status, 201); const token = new URL(r.body.acceptUrl).searchParams.get('invite')!;
assert.equal(r.body.delivered, false); assert.ok(!JSON.stringify(r.body.invitation).includes('tokenHash')); ok('invitation returns a one-time link, no stored hash, delivered:false');
assert.equal((await request(app).post('/api/orgs/invitations/accept').set(as('mallory', 'mallory@evil.test')).send({ token })).status, 403); ok('invitation can’t be used with a different email');
assert.equal((await request(app).post('/api/orgs/invitations/accept').set(as('dave')).send({ token })).status, 403); ok('…or without a verified email');
r = await request(app).post('/api/orgs/invitations/accept').set(as('dave', 'dave@acme.test')).send({ token });
assert.equal(r.status, 200); assert.equal(r.body.orgId, orgA); ok('invited user with the verified email joins');
assert.equal((await request(app).post('/api/orgs/invitations/accept').set(as('dave', 'dave@acme.test')).send({ token })).status, 404); ok('invitation link works only once');

r = await request(app).get('/api/leads').set(as('dave')).set('X-Org-Id', orgA);
assert.equal(r.status, 200); assert.equal(r.body.count, 1); ok('READ_ONLY member can read');
assert.equal((await request(app).post('/api/leads').set(as('dave')).set('X-Org-Id', orgA).send({ name: 'X', email: 'x@y.test' })).status, 403); ok('READ_ONLY member can’t create');
assert.equal((await request(app).post('/api/orgs/current/invitations').set(as('dave')).set('X-Org-Id', orgA).send({ email: 'e@x.test', role: 'ADMIN' })).status, 403); ok('READ_ONLY member can’t invite');
assert.equal((await request(app).patch('/api/orgs/current/members/dave').set(as('dave')).set('X-Org-Id', orgA).send({ role: 'OWNER' })).status, 403); ok('member can’t promote themselves');

await request(app).patch('/api/orgs/current/members/dave').set(as('alice')).send({ role: 'SALES_REP' });
assert.equal((await request(app).post('/api/leads').set(as('dave')).set('X-Org-Id', orgA).send({ name: 'Y', email: 'y@y.test' })).status, 201); ok('after promotion to SALES_REP, can create');
assert.equal((await request(app).post('/api/leads/bulk/status').set(as('dave')).set('X-Org-Id', orgA).send({ ids: [leadA], status: 'new' })).status, 403); ok('SALES_REP can’t run bulk changes (MANAGER+)');
assert.equal((await request(app).patch('/api/orgs/current/members/alice').set(as('alice')).send({ role: 'ADMIN' })).status, 409); ok('the last OWNER can’t be demoted');
assert.equal((await request(app).delete('/api/orgs/current/members/alice').set(as('alice'))).status, 409); ok('…or leave');

// ---- Public lead form: attributed by key only ----
r = await request(app).post('/api/leads/capture').set('X-Org-Id', orgA).send({ name: 'Web', email: 'web@lead.test' });
assert.equal(r.status, 401); ok('lead form without a key is rejected (X-Org-Id ignored)');
r = await request(app).post('/api/orgs/current/lead-capture-key').set(as('bob'));
const keyB = r.body.key; assert.match(keyB, /^lck_/);
r = await request(app).post('/api/leads/capture').set('X-Lead-Capture-Key', keyB).send({ name: 'Web Lead', email: 'web@lead.test' });
assert.equal(r.status, 201); assert.equal(r.body.lead, undefined); ok('lead form with a valid key → 201, record not echoed to the anonymous caller');
assert.equal((await request(app).get('/api/leads').set(as('bob'))).body.count, 1); assert.equal((await request(app).get('/api/leads').set(as('alice'))).body.count, 2);
ok('…and it lands in the key’s organization only');
await request(app).post('/api/orgs/current/lead-capture-key').set(as('bob'));
assert.equal((await request(app).post('/api/leads/capture').set('X-Lead-Capture-Key', keyB).send({ name: 'Old', email: 'old@lead.test' })).status, 401); ok('rotating the key revokes the old one');

// ---- Chat sessions are private to user and organization ----
await store.set(`organizations/${orgA}/chat_sessions/sess_alice`, { sessionId: 'sess_alice', userId: 'alice', orgId: orgA, messages: [{ role: 'user', content: 'secret' }] });
assert.equal((await request(app).get('/api/chat/session/sess_alice').set(as('alice'))).status, 200);
assert.equal((await request(app).get('/api/chat/session/sess_alice').set(as('dave')).set('X-Org-Id', orgA)).status, 404); ok('chat session is private even within the same organization');
assert.equal((await request(app).get('/api/chat/session/sess_alice').set(as('bob'))).status, 404); ok('…and invisible from another organization');

// ---- AI tools act only in the caller's organization, with the caller's role ----
let t: any = await executeCrmTool('search_leads', { query: 'ada' }, { userId: 'bob', orgId: orgB, role: 'OWNER' });
assert.equal(t.count, 0); ok('AI search_leads can’t see another organization’s leads');
t = await executeCrmTool('create_lead', { name: 'AI Lead', email: 'ai@lead.test' }, { userId: 'dave', orgId: orgA, role: 'READ_ONLY' });
assert.match(t.error, /read-only/); ok('AI write tools refused for READ_ONLY users');
t = await executeCrmTool('create_followup_task', { title: 'Call', leadId: leadA }, { userId: 'bob', orgId: orgB, role: 'OWNER' });
assert.ok(t.success); assert.equal((await store.list(`organizations/${orgA}/leads/${leadA}/tasks`)).length, 0); ok('AI can’t attach a task to another organization’s lead');
t = await executeCrmTool('get_pipeline_summary', {}, { userId: 'bob', orgId: orgB, role: 'OWNER' });
assert.equal(t.activeDealsCount, 0); ok('AI pipeline summary is per organization (no sample data)');

// ---- Legacy migration: copies into one organization, never deletes, idempotent ----
const { migrateLegacy } = await import('../../scripts/migrateLegacyCrmToOrg');
const legacy: Record<string, Array<{ id: string; data: any }>> = {
  crm_leads: [{ id: 'lead-1', data: { name: 'Old Lead', email: 'old@x.test' } }, { id: 'bad/id', data: {} }],
  'crm_leads/lead-1/tasks': [{ id: 'task-1', data: { title: 'Old task' } }],
  crm_deals: [{ id: 'deal-1', data: { name: 'Old deal', value: 10 } }],
};
const source = { list: async (c: string) => structuredClone(legacy[c] || []) };
const silent = () => {};
let rep = await migrateLegacy({ source, target: store, orgId: orgB, apply: false, log: silent });
assert.equal(rep.leads.copied, 1); assert.equal(await store.get(`organizations/${orgB}/leads/lead-1`), null); ok('migration dry run writes nothing');
rep = await migrateLegacy({ source, target: store, orgId: orgB, apply: true, log: silent });
assert.equal((await store.get(`organizations/${orgB}/leads/lead-1`)).orgId, orgB);
assert.equal((await store.get(`organizations/${orgB}/leads/lead-1/tasks/task-1`)).title, 'Old task');
assert.equal(rep.leads.invalidIds, 1); ok('migration copies leads with subcollections and deals; unsafe ids are skipped and reported');
rep = await migrateLegacy({ source, target: store, orgId: orgB, apply: true, log: silent });
assert.equal(rep.leads.copied, 0); assert.equal(rep.leads.skipped, 1); ok('re-running the migration is a no-op');
assert.equal(legacy.crm_leads.length, 2); ok('source data is never modified');
await assert.rejects(migrateLegacy({ source, target: store, orgId: 'org_missing', apply: true, log: silent })); ok('migration refuses an organization that doesn’t exist');

console.log(`\n${passed} passed (tenancy)`);
process.exit(0);
