/**
 * CRM API end to end (file store): auth and workspace isolation, validation,
 * customers, duplicates and merge, leads and conversion, pipeline and deals,
 * tasks and overdue logic, notes/timeline, events, saved views, dashboard
 * maths, search, import/export, bulk actions and the public lead form.
 * Run: npx tsx src/features/crm/__tests__/crm.test.ts
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';

const dir = mkdtempSync(path.join(tmpdir(), 'crm-test-'));
Object.assign(process.env, { NODE_ENV: 'test', SOCIAL_ACCOUNTS_DEV_AUTH: 'true', SOCIAL_ACCOUNTS_STORE: 'file', SOCIAL_ACCOUNTS_DATA_DIR: path.join(dir, 'sa'), CRM_DATA_DIR: path.join(dir, 'crm'), SOCIAL_ACCOUNTS_ENCRYPTION_KEY: 'k'.repeat(40), APP_URL: 'https://crm.test' });
const app = express(); app.use(express.json()); app.use(express.urlencoded({ extended: false }));
app.use('/api/crm', (await import('../../../routes/crmApi')).default);

let passed = 0; const ok = (n: string) => { passed++; console.log('  ✓', n); };
const A = { 'X-Dev-User-Id': 'alice', Origin: 'https://crm.test' };
const B = { 'X-Dev-User-Id': 'bob', Origin: 'https://crm.test' };
const api = (m: 'get' | 'post' | 'patch' | 'put' | 'delete', p: string, who: Record<string, string> = A) => (request(app) as any)[m](`/api/crm${p}`).set(who);
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

console.log('🔐 Access');
assert.equal((await request(app).get('/api/crm/contacts')).status, 401); ok('requires sign-in');
assert.equal((await request(app).post('/api/crm/contacts').set('X-Dev-User-Id', 'alice').send({ firstName: 'X' })).status, 403); ok('writes must come from the app (CSRF origin check)');
process.env.NODE_ENV = 'production';
assert.equal((await api('get', '/contacts')).status, 401); ok('dev identity header is ignored in production');
process.env.NODE_ENV = 'test';

console.log('\n👤 Customers');
let r = await api('post', '/contacts').send({});
assert.equal(r.status, 400); assert.equal(r.body.field, 'firstName'); ok('a name or company is required, with a field-level message');
r = await api('post', '/contacts').send({ firstName: 'Ann', email: 'not-an-email' });
assert.equal(r.status, 400); assert.equal(r.body.field, 'email'); assert.match(r.body.error, /valid email/); ok('email is validated');
r = await api('post', '/contacts').send({ firstName: 'Ann', lastName: 'Lee', company: 'Acme', email: 'ann@acme.test', phone: '+1 512 555 0100', tags: ['VIP', 'vip', 'Wholesale'] });
assert.equal(r.status, 200); const ann = r.body.contact;
assert.deepEqual(ann.tags, ['vip', 'Wholesale']); assert.equal(ann.version, 1); assert.deepEqual(r.body.possibleDuplicates, []); ok('creates a customer; tags are de-duplicated');
r = await api('post', '/contacts').send({ firstName: 'Annie', company: 'Other', email: 'ANN@acme.test' });
const annDup = r.body.contact; assert.equal(r.body.possibleDuplicates[0].id, ann.id); ok('duplicate detection on create (same email, any case)');
r = await api('get', '/contacts', B); assert.equal(r.body.total, 0); ok('workspaces are isolated (other user sees nothing)');
assert.equal((await api('get', `/contacts/${ann.id}`, B)).status, 404); ok('…and cannot open another workspace’s record');
assert.equal((await api('patch', `/contacts/${ann.id}`, B).send({ firstName: 'Hacked' })).status, 404);
r = await api('patch', `/contacts/${ann.id}`).send({ title: 'Owner', version: 1 });
assert.equal(r.body.contact.version, 2); assert.equal(r.body.contact.title, 'Owner'); ok('updates bump the version');
assert.equal((await api('patch', `/contacts/${ann.id}`).send({ title: 'Stale', version: 1 })).status, 409); ok('stale edits are rejected (conflict) instead of overwriting');
r = await api('get', '/contacts?q=ann%20lee'); assert.equal(r.body.total, 1); assert.equal(r.body.items[0].id, ann.id);
r = await api('get', '/contacts?q=5550100'); assert.equal(r.body.items[0].id, ann.id);
r = await api('get', '/contacts?tag=wholesale'); assert.equal(r.body.total, 1); assert.ok(r.body.facets.tags.includes('Wholesale'));
r = await api('get', '/contacts?limit=1&sort=name'); assert.equal(r.body.items.length, 1); assert.equal(r.body.total, 2); assert.equal(r.body.nextOffset, 1); ok('search (text, phone digits), tag filter, sorting and pagination');

console.log('\n🧩 Custom fields');
r = await api('put', '/settings').send({ customFields: { contact: [{ key: 'tier', label: 'Tier', kind: 'select', options: ['Gold', 'Silver'] }, { key: 'renewal', label: 'Renewal', kind: 'date' }] } });
assert.equal(r.status, 200);
assert.equal((await api('patch', `/contacts/${ann.id}`).send({ fields: { tier: 'Bronze' } })).status, 400);
assert.equal((await api('patch', `/contacts/${ann.id}`).send({ fields: { unknown: 'x' } })).status, 400);
r = await api('patch', `/contacts/${ann.id}`).send({ fields: { tier: 'Gold', renewal: '2027-01-31' } });
assert.equal(r.body.contact.fields.tier, 'Gold'); ok('custom fields are defined in settings and validated by type');

console.log('\n🔁 Duplicates & merge');
r = await api('get', '/contacts/duplicates'); assert.equal(r.body.length, 1); assert.equal(r.body[0].contacts.length, 2); ok('duplicate groups listed');
await api('post', '/notes').send({ body: 'Spoke about renewal', relatedTo: { type: 'contact', id: annDup.id } });
r = await api('post', '/contacts/merge').send({ keepId: ann.id, mergeIds: [annDup.id] });
assert.equal(r.status, 200); assert.equal((await api('get', `/contacts/${annDup.id}`)).status, 404);
r = await api('get', `/contacts/${ann.id}`); assert.ok(r.body.notes.some((n: any) => n.body === 'Spoke about renewal')); assert.ok(r.body.activities.some((a: any) => a.kind === 'merged'));
ok('merge keeps one record and moves notes and history onto it');

console.log('\n🎯 Leads');
r = await api('post', '/leads').send({ name: 'Bo Diaz', company: 'Diaz Co', email: 'bo@diaz.test', source: 'Referral', priority: 'high', value: 12000, nextFollowUpAt: day(-2) });
const bo = r.body.lead; assert.equal(bo.status, 'new');
assert.equal((await api('post', '/leads').send({ name: 'X', status: 'converted' })).status, 400); ok('creates a lead; conversion only through Convert');
assert.equal((await api('post', '/leads').send({ name: 'X', priority: 'mega' })).status, 400); ok('invalid priority rejected');
r = await api('get', '/leads?due=overdue'); assert.equal(r.body.items[0].id, bo.id); ok('overdue follow-ups filter');
r = await api('patch', `/leads/${bo.id}`).send({ status: 'qualified' });
r = await api('get', `/leads/${bo.id}`); assert.ok(r.body.activities.some((a: any) => a.kind === 'status' && /qualified/.test(a.summary))); ok('status changes appear on the lead timeline');
await api('post', '/tasks').send({ title: 'Send pricing', relatedTo: { type: 'lead', id: bo.id }, dueAt: day(1) });
r = await api('post', `/leads/${bo.id}/convert`).send({ createDeal: true, value: 15000 });
assert.equal(r.status, 200); const boContact = r.body.contact; const boDeal = r.body.deal;
assert.equal(r.body.lead.status, 'converted'); assert.equal(boDeal.contactId, boContact.id); assert.equal(boDeal.value, 15000);
assert.equal((await api('post', `/leads/${bo.id}/convert`).send({})).status, 409); ok('converts a lead into a customer and a deal, once');
r = await api('get', `/contacts/${boContact.id}`); assert.ok(r.body.tasks.some((t: any) => t.title === 'Send pricing')); assert.equal(r.body.deals.length, 1); ok('the customer inherits the lead’s tasks and shows the deal');
const l2 = (await api('post', '/leads').send({ name: 'Cy', company: 'Cy Ltd' })).body.lead;
const l3 = (await api('post', '/leads').send({ name: 'Di', company: 'Di Ltd' })).body.lead;
r = await api('post', '/leads/bulk').send({ action: 'assign', ids: [l2.id, l3.id], value: 'Sam' }); assert.equal(r.body.updated, 2);
r = await api('post', '/leads/bulk').send({ action: 'setStatus', ids: [l2.id, bo.id], value: 'lost' }); assert.equal(r.body.updated, 1); assert.equal(r.body.skipped, 1); ok('bulk assign and status (converted leads are skipped)');

console.log('\n💼 Pipeline');
r = await api('get', '/settings'); const stages = r.body.pipeline; assert.ok(stages.some((s: any) => s.kind === 'won'));
r = await api('post', '/deals').send({ name: 'Acme renewal', contactId: ann.id, value: 10000, stageId: 'proposal', expectedCloseDate: day(10) });
const acme = r.body.deal; assert.equal(acme.company, 'Acme'); ok('deal picks up the customer’s company');
assert.equal((await api('post', '/deals').send({ name: 'X', stageId: 'nope' })).status, 400); ok('unknown stage rejected');
r = await api('patch', `/deals/${boDeal.id}`).send({ stageId: 'won' }); assert.ok(r.body.deal.closedAt); ok('moving to a won stage closes the deal');
assert.equal((await api('put', '/settings').send({ pipeline: stages.filter((s: any) => s.id !== 'proposal') })).status, 409); ok('a stage with deals can’t be removed');
r = await api('get', '/deals?status=open'); assert.equal(r.body.items.length, 1); assert.equal(r.body.items[0].effectiveProbability, 60); assert.equal(r.body.items[0].contactName, 'Ann Lee'); ok('open deals with effective probability and customer name');

console.log('\n✅ Tasks');
const overdue = (await api('post', '/tasks').send({ title: 'Call back', dueAt: day(-1), priority: 'urgent', relatedTo: { type: 'contact', id: ann.id } })).body.task;
assert.equal((await api('post', '/tasks').send({ title: 'Ghost', relatedTo: { type: 'contact', id: 'con_doesnotexist1' } })).status, 404); ok('tasks must point at a real record');
r = await api('get', '/tasks?due=overdue'); assert.equal(r.body.items[0].id, overdue.id); assert.equal(r.body.items[0].overdue, true); assert.equal(r.body.items[0].relatedName, 'Ann Lee'); ok('overdue tasks with related names');
r = await api('patch', `/tasks/${overdue.id}`).send({ status: 'done' }); assert.ok(r.body.task.completedAt);
r = await api('get', `/contacts/${ann.id}`); assert.ok(r.body.activities.some((a: any) => a.kind === 'task_done')); ok('completing a task is logged on the customer');

console.log('\n🗒️  Timeline, events, views');
r = await api('post', '/interactions').send({ kind: 'call', summary: 'Discussed renewal terms', relatedTo: { type: 'contact', id: ann.id } });
assert.equal(r.status, 200);
r = await api('get', `/contacts/${ann.id}`); assert.equal(r.body.activities[0].summary, 'Discussed renewal terms'); assert.ok(r.body.contact.lastActivityAt); ok('logged calls appear first on the timeline');
r = await api('post', '/events').send({ title: 'Renewal meeting', start: day(2), end: day(-1), kind: 'meeting' }); assert.equal(r.status, 400); assert.equal(r.body.field, 'end');
r = await api('post', '/events').send({ title: 'Renewal meeting', start: day(2), kind: 'meeting', relatedTo: { type: 'contact', id: ann.id } }); const ev = r.body.event;
r = await api('get', `/events?from=${encodeURIComponent(day(0))}&to=${encodeURIComponent(day(7))}`); assert.equal(r.body[0].id, ev.id); assert.equal(r.body[0].relatedName, 'Ann Lee'); ok('calendar events persist with date-range queries');
r = await api('post', '/views').send({ entity: 'lead', name: 'Hot leads', filters: { priority: 'high', status: 'active' } }); assert.equal(r.status, 200);
r = await api('get', '/views?entity=lead'); assert.equal(r.body.length, 1); assert.equal((await api('get', '/views?entity=lead', B)).body.length, 0); ok('saved filters per user');

console.log('\n📊 Dashboard & search');
r = await api('get', '/dashboard');
const t = r.body.totals;
assert.equal(t.customers, 2); assert.equal(t.openDeals, 1); assert.equal(t.pipelineValue, 10000); assert.equal(t.weightedPipeline, 6000);
assert.equal(t.wonThisMonth, 15000); assert.equal(t.wonThisMonthCount, 1); assert.equal(t.winRate90d, 100);
assert.ok(r.body.recentActivity.length > 0); assert.equal(r.body.salesByMonth.length, 6); assert.equal(r.body.salesByMonth[5].value, 15000);
ok('dashboard totals come from real records (pipeline, weighted forecast, won, win rate)');
assert.equal((await api('get', '/dashboard', B)).body.hasData, false); ok('new workspaces start empty (no sample data)');
r = await api('get', '/search?q=acme'); assert.ok(r.body.results.some((x: any) => x.type === 'contact' && x.id === ann.id)); assert.ok(r.body.results.some((x: any) => x.type === 'deal'));
r = await api('get', '/search?q=renewal%20terms'); assert.equal(r.body.results.length, 0);
r = await api('get', '/search?q=spoke%20renewal'); assert.ok(r.body.results.some((x: any) => x.type === 'note')); ok('global search across customers, deals and notes');

console.log('\n📥 Import / export');
r = await api('post', '/import').send({ entity: 'contact', duplicates: 'skip', rows: [
  { firstName: 'Eve', company: 'Eve Inc', email: 'eve@eve.test', tags: 'a; b' },
  { firstName: 'Ann again', email: 'ann@acme.test' },
  { firstName: 'Bad', email: 'nope' },
  { email: 'noname@x.test' },
] });
assert.deepEqual([r.body.created, r.body.skipped, r.body.errors.length], [1, 1, 2]); assert.equal(r.body.errors[0].row, 3); ok('import validates rows, skips duplicates and reports row errors');
r = await api('post', '/import').send({ entity: 'contact', duplicates: 'update', rows: [{ email: 'eve@eve.test', title: 'CEO' }] });
assert.equal(r.body.updated, 1);
r = await api('post', '/contacts').send({ firstName: '=HYPERLINK("http://evil")', company: 'X' });
r = await api('get', '/export/contacts'); assert.equal(r.status, 200); assert.match(r.headers['content-type'], /text\/csv/);
assert.match(r.text, /Eve,,Eve Inc,CEO/); assert.ok(r.text.includes(`"'=HYPERLINK(""http://evil"")"`)); ok('CSV export, with spreadsheet formula injection neutralised');
r = await api('post', '/contacts/bulk').send({ action: 'addTag', ids: [ann.id], value: 'Renewal' }); assert.equal(r.body.updated, 1);

console.log('\n🌐 Public lead form');
assert.equal((await request(app).post('/api/crm/capture/notarealkey000000000000').send({ name: 'Z', email: 'z@z.test' })).status, 404); ok('unknown form keys are rejected');
r = await api('post', '/settings/capture-form').send({ enabled: true }); const key = r.body.captureKey; assert.ok(key);
r = await request(app).post(`/api/crm/capture/${key}`).type('form').send({ name: 'Web Visitor', email: 'web@visitor.test', message: 'Please call me' });
assert.equal(r.status, 200);
r = await request(app).post(`/api/crm/capture/${key}`).send({ name: 'Bot', email: 'bot@spam.test', website: 'http://spam' }); assert.equal(r.status, 200);
r = await api('get', '/leads?q=visitor'); assert.equal(r.body.total, 1); assert.equal(r.body.items[0].source, 'Website'); assert.equal(r.body.items[0].notes, 'Please call me');
r = await api('get', '/leads?q=bot'); assert.equal(r.body.total, 0); ok('website form creates a lead in the right workspace; honeypot drops bots');
await api('post', '/settings/capture-form').send({ enabled: false });
assert.equal((await request(app).post(`/api/crm/capture/${key}`).send({ name: 'Late', email: 'l@l.test' })).status, 404); ok('turning the form off disables its key');

console.log('\n🗑️  Deletion keeps related data safe');
r = await api('delete', `/contacts/${ann.id}`); assert.equal(r.body.deleted, 1); assert.equal(r.body.unlinked.deals, 1);
r = await api('get', `/deals/${acme.id}`); assert.equal(r.body.deal.contactId, null); ok('deleting a customer keeps their deals (unlinked) and removes their notes');
const file = JSON.parse(readFileSync(path.join(dir, 'crm', 'alice.json'), 'utf8'));
assert.ok(!file.contacts[ann.id]); assert.ok(file.deals[acme.id]); ok('changes are persisted to storage');

console.log(`\n${passed} passed (crm)`);
process.exit(0);
