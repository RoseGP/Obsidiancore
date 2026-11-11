/**
 * /api/reports and the contact matching endpoints over HTTP: signed-out callers refused, another organization
 * gets nothing, READ_ONLY can read, roles without report access are refused, input validation, stage history
 * recorded on stage changes, the fuzzy match check on contact create and "this lead looks like contact X".
 * Run: npx tsx src/routes/__tests__/reportsApi.test.ts
 */
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';

let passed = 0; const ok = (n: string) => { passed++; console.log('  ✓', n); };
Object.assign(process.env, { NODE_ENV: 'test', SOCIAL_ACCOUNTS_DEV_AUTH: 'true', CRM_STORE: 'memory' });

const { MemoryDocStore, setDocStore } = await import('../../server/data/docStore');
const store = new MemoryDocStore(); setDocStore(store);
const { guard, PUBLIC } = await import('../../server/routeGuards');
const reports = (await import('../reportsApi')).default;
const dashboard = (await import('../dashboardApi')).default;
const { contactsRouter } = await import('../contactsApi');
const { makeOrg, addMember, as } = await import('../../server/__tests__/fixtures');

const app = express(); app.use(express.json());
app.use('/api/reports', guard(PUBLIC.none), reports);
app.use('/api/dashboard', guard(PUBLIC.none), dashboard);
app.use('/api/contacts', guard(PUBLIC.none), contactsRouter);

const A = await makeOrg('owner_a'); const B = await makeOrg('owner_b');
await addMember(A.id, 'ro', 'READ_ONLY'); await addMember(A.id, 'sup', 'SUPPORT_AGENT'); await addMember(A.id, 'gst', 'GUEST');
const get = (uid: string, org: string, p: string) => request(app).get(p).set(as(uid, org));

const DAY = 86_400_000; const now = Date.now();
const iso = (d: number) => new Date(now + d * DAY).toISOString();
const ymd = (d: number) => iso(d).slice(0, 10);
const O = `organizations/${A.id}`;
for (let i = 0; i < 6; i++) await store.set(`${O}/deals/won${i}`, { id: `won${i}`, name: `Won ${i}`, stage: 'won', value: 1000 * (i + 1), contactId: i === 0 ? 'c_ann' : null, client: `Client ${i}`, createdAt: iso(-90 - i), closedAt: iso(-20 - i * 10) });
for (let i = 0; i < 2; i++) await store.set(`${O}/deals/lost${i}`, { id: `lost${i}`, name: `Lost ${i}`, stage: 'lost', value: 500, createdAt: iso(-80), lostFromStage: 'proposal' });
await store.set(`${O}/deals/open1`, { id: 'open1', name: 'Big renewal', stage: 'proposal', value: 40000, expectedClose: ymd(10), createdAt: iso(-30), stageEnteredAt: iso(-3) });
await store.set(`${O}/deals/open2`, { id: 'open2', name: 'Old quote', stage: 'negotiation', value: 3000, expectedClose: ymd(-12), createdAt: iso(-60), stageEnteredAt: iso(-4) });
await store.set(`${O}/deals/open3`, { id: 'open3', name: 'No value yet', stage: 'discovery', createdAt: iso(-2) });
await store.set(`${O}/contacts/c_ann`, { id: 'c_ann', name: 'Ann Archer', email: 'ann@archer.test', createdAt: iso(-100) });
await store.set(`${O}/contacts/c_bob`, { id: 'c_bob', name: 'Bob Jones', email: 'bob@acme.com', createdAt: iso(-100) });
await store.set(`${O}/leads/lead1`, { id: 'lead1', name: 'Robert Jones', email: 'robert.jones@acme.com', source: 'website', status: 'new', createdAt: iso(-1) });

// ---- Access ----
assert.equal((await request(app).get('/api/reports/forecast')).status, 401);
assert.equal((await request(app).get('/api/reports/segments')).status, 401);
assert.equal((await request(app).get('/api/reports/deal-actions')).status, 401);
assert.equal((await request(app).get('/api/reports/pipeline')).status, 401);
ok('signed-out callers are refused on every report');

let r = await get('ro', A.id, '/api/reports/forecast');
assert.equal(r.status, 200); assert.equal(r.headers['cache-control'], 'private, no-store');
assert.equal((await get('ro', A.id, '/api/reports/segments')).status, 200);
assert.equal((await get('ro', A.id, '/api/reports/deal-actions')).status, 200);
assert.equal((await get('ro', A.id, '/api/reports/pipeline')).status, 200);
assert.equal((await get('sup', A.id, '/api/reports/forecast')).status, 403);
assert.equal((await get('gst', A.id, '/api/reports/segments')).status, 403);
ok('READ_ONLY can read every report; SUPPORT_AGENT and GUEST (no report access) are refused');

// ---- Forecast ----
r = await get('owner_a', A.id, '/api/reports/forecast?months=3');
assert.equal(r.body.success, true); assert.equal(r.body.months, 3); assert.equal(r.body.buckets.length, 3);
assert.equal(r.body.deals.length, 3); assert.equal(r.body.model.closedDeals, 8); assert.equal(r.body.confidence, 'medium');
const big = r.body.deals.find((d: any) => d.id === 'open1');
assert.equal(big.basisKind, 'history'); assert.match(big.basis, /Your history \(n=8\)/);
assert.deepEqual(r.body.noValue.map((x: any) => x.id), ['open3']);
assert.equal(r.body.total.pipeline, 43000);
assert.equal((await get('owner_a', A.id, '/api/reports/forecast?months=0')).status, 400);
assert.equal((await get('owner_a', A.id, '/api/reports/forecast?months=abc')).status, 400);
assert.equal((await get('owner_a', A.id, '/api/reports/forecast?months=13')).status, 400);
assert.equal((await get('owner_a', A.id, '/api/reports/forecast?months=12')).body.buckets.length, 12);
ok('forecast: per-deal basis from the org’s history, deals without a value listed, months validated (1–12)');

// ---- Other organization ----
r = await get('owner_b', B.id, '/api/reports/forecast');
assert.equal(r.status, 200); assert.equal(r.body.deals.length, 0); assert.equal(r.body.confidence, 'low'); assert.equal(r.body.total.pipeline, 0); assert.equal(r.body.history.total, 0);
r = await get('owner_b', B.id, '/api/reports/segments'); assert.equal(r.body.customers, 0); assert.equal(r.body.prospects, 0);
r = await get('owner_b', B.id, '/api/reports/deal-actions'); assert.deepEqual(r.body.deals, []);
r = await get('owner_b', B.id, '/api/reports/deal-actions?dealId=open1'); assert.deepEqual(r.body.deals, []);
r = await get('owner_b', B.id, '/api/reports/pipeline'); assert.ok(r.body.stages.every((s: any) => s.open === 0 && s.movedOn === 0)); assert.deepEqual(r.body.sources, []);
assert.equal((await request(app).get('/api/reports/forecast').set(as('owner_b', A.id))).status, 403, 'not a member of A');
ok('another organization sees none of these deals, customers or actions, even by deal id; asking for A’s data as a non-member is refused');

// ---- Segments, actions, pipeline ----
r = await get('owner_a', A.id, '/api/reports/segments');
assert.equal(r.body.method, 'fixed'); assert.equal(r.body.customers, 6); assert.equal(r.body.prospects, 1); // Bob has no purchase
assert.ok(r.body.segments.flatMap((s: any) => s.members).some((m: any) => m.id === 'c_ann'));
r = await get('owner_a', A.id, '/api/reports/deal-actions');
assert.equal(r.body.deals[0].dealId, 'open1'); // highest expected value
assert.equal(r.body.deals.find((d: any) => d.dealId === 'open2').primary.type, 'close_date_passed');
r = await get('owner_a', A.id, '/api/reports/deal-actions?dealId=open2');
assert.deepEqual(r.body.deals.map((d: any) => d.dealId), ['open2']);
assert.equal((await get('owner_a', A.id, '/api/reports/deal-actions?dealId=../x')).status, 400);
r = await get('owner_a', A.id, '/api/reports/pipeline');
assert.equal(r.body.sources[0].label, 'Website'); assert.equal(r.body.sources[0].leads, 1);
ok('segments, deal actions (one deal by id, invalid ids rejected) and pipeline health for the organization');

// ---- Stage history recorded on stage changes ----
r = await request(app).post('/api/dashboard/deals').set(as('owner_a', A.id)).send({ name: 'Fresh', client: 'Fresh Co', value: 100, stage: 'discovery' });
assert.equal(r.status, 201); const fresh = r.body.deal.id;
let doc = await store.get(`${O}/deals/${fresh}`);
assert.equal(doc.stageHistory.length, 1); assert.equal(doc.stageHistory[0].stage, 'discovery'); assert.ok(doc.stageEnteredAt);
await request(app).patch(`/api/dashboard/deals/${fresh}/stage`).set(as('owner_a', A.id)).send({ stage: 'proposal' }).expect(200);
await request(app).patch(`/api/dashboard/deals/${fresh}/stage`).set(as('owner_a', A.id)).send({ stage: 'lost' }).expect(200);
doc = await store.get(`${O}/deals/${fresh}`);
assert.deepEqual(doc.stageHistory.map((e: any) => [e.from, e.stage]), [[null, 'discovery'], ['discovery', 'proposal'], ['proposal', 'lost']]);
assert.equal(doc.lostFromStage, 'proposal'); assert.ok(doc.closedAt);
r = await get('owner_a', A.id, '/api/reports/forecast');
assert.equal(r.body.model.closedDeals, 9); assert.equal(r.body.model.unknownLost, 0);
ok('stage changes record history, the stage a lost deal was lost from and the close time; reports use them');

// ---- Contact matching ----
r = await request(app).post('/api/contacts/match').set(as('owner_a', A.id)).send({ name: 'Robert Jones', email: 'robert.jones@acme.com' });
assert.equal(r.status, 200); assert.equal(r.body.matches[0].id, 'c_bob'); assert.equal(r.body.matches[0].level, 'likely');
assert.ok(r.body.matches[0].reasons.some((x: string) => /Bob\/Robert/.test(x)));
assert.deepEqual((await request(app).post('/api/contacts/match').set(as('owner_b', B.id)).send({ name: 'Robert Jones', email: 'robert.jones@acme.com' })).body.matches, []);
assert.equal((await request(app).post('/api/contacts/match').send({ name: 'x' })).status, 401);
r = await request(app).post('/api/contacts').set(as('owner_a', A.id)).send({ name: 'Robert Jones', email: 'robert.jones@acme.com' });
assert.equal(r.status, 409); assert.equal(r.body.code, 'possible_duplicate'); assert.equal(r.body.matches[0].id, 'c_bob'); assert.ok(r.body.matches[0].score >= 0.85);
r = await request(app).post('/api/contacts').set(as('owner_a', A.id)).send({ name: 'Robert Jones', email: 'robert.jones@acme.com', force: true });
assert.equal(r.status, 201);
r = await get('owner_a', A.id, '/api/contacts/duplicates');
assert.ok(Array.isArray(r.body.groups) && r.body.groups[0].contacts.length === 2 && 'reasons' in r.body.groups[0]);
assert.equal(r.body.leadMatches[0].lead.id, 'lead1'); assert.ok(['c_bob', r.body.groups[0].contacts[1].id].includes(r.body.leadMatches[0].contact.id));
assert.deepEqual((await get('owner_b', B.id, '/api/contacts/duplicates')).body.leadMatches, []);
assert.equal((await store.list(`${O}/contacts`)).filter((c: any) => c.mergedInto).length, 0, 'nothing merged automatically');
ok('contact create warns on a likely fuzzy match (Bob/Robert at acme.com); duplicates list keeps its fields and adds lead matches; nothing auto-merged; tenant-scoped');

console.log(`\n${passed} passed (reports api)`);
process.exit(0);
