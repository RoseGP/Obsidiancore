/**
 * Contacts & companies: one record per person, duplicate detection, merge without data loss, soft delete,
 * profiles with linked records and communication history, lead conversion reusing the existing contact,
 * the backfill script, tenant isolation and role checks.
 * Run: npx tsx src/server/crm/__tests__/contacts.test.ts
 */
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';

let passed = 0; const ok = (n: string) => { passed++; console.log('  ✓', n); };
Object.assign(process.env, { NODE_ENV: 'test', SOCIAL_ACCOUNTS_DEV_AUTH: 'true', CRM_STORE: 'memory' });
delete process.env.GEMINI_API_KEY; delete process.env.ANTHROPIC_API_KEY;

const { MemoryDocStore, setDocStore } = await import('../../data/docStore');
const store = new MemoryDocStore(); setDocStore(store);
const { guard, PUBLIC } = await import('../../routeGuards');
const { contactsRouter, companiesRouter } = await import('../../../routes/contactsApi');
const leadsRouter = (await import('../../../routes/leadsApi')).default;
const { backfillContacts } = await import('../backfill');

const app = express(); app.use(express.json());
app.use('/api/contacts', guard(PUBLIC.none), contactsRouter);
app.use('/api/companies', guard(PUBLIC.none), companiesRouter);
app.use('/api/leads', guard(PUBLIC.leads), leadsRouter);
const as = (uid: string) => ({
  get: (p: string) => request(app).get(p).set('X-Dev-User-Id', uid),
  post: (p: string, b: any = {}) => request(app).post(p).set('X-Dev-User-Id', uid).send(b),
  patch: (p: string, b: any = {}) => request(app).patch(p).set('X-Dev-User-Id', uid).send(b),
  del: (p: string) => request(app).delete(p).set('X-Dev-User-Id', uid),
});
const C = '/api/contacts', CO = '/api/companies';

// ---- Auth ----
assert.equal((await request(app).get(C)).status, 401);
assert.equal((await request(app).post(C).send({ name: 'x' })).status, 401);
assert.equal((await request(app).get(CO)).status, 401);
ok('signed-out callers are refused');

// ---- Create + duplicates ----
let r = await as('olivia').post(CO, { name: 'Acme Inc', industry: 'Retail', website: 'https://www.acme.test/about' });
assert.equal(r.status, 201); const acme = r.body.company; assert.equal(acme.domain, 'acme.test');
r = await as('olivia').post(CO, { name: 'ACME' });
assert.equal(r.status, 409); assert.equal(r.body.code, 'possible_duplicate'); assert.equal(r.body.matches[0].id, acme.id);
ok('companies: create, and a second "ACME" is flagged as a duplicate of "Acme Inc"');

r = await as('olivia').post(C, { name: 'Hana Lee', email: 'Hana@Acme.test ', phone: '+1 (555) 010-0100', companyId: acme.id, tags: ['vip', 'vip', 'retail'] });
assert.equal(r.status, 201); const hana = r.body.contact;
assert.equal(hana.email, 'hana@acme.test'); assert.deepEqual(hana.tags, ['vip', 'retail']); assert.equal(hana.ownerId, 'olivia');
assert.equal((await as('olivia').post(C, { name: '', email: '' })).status, 400);
assert.equal((await as('olivia').post(C, { name: 'X', email: 'not-an-email' })).status, 400);
assert.equal((await as('olivia').post(C, { name: 'X', companyId: 'company_missing' })).status, 400);
r = await as('olivia').post(C, { name: 'H. Lee', phone: '555-010-0100' });
assert.equal(r.status, 409); assert.equal(r.body.matches[0].id, hana.id); assert.ok(r.body.matches[0].reasons.includes('Same phone'));
r = await as('olivia').post(C, { name: 'Hana Lee', email: 'hana.lee@gmail.test', company: 'acme inc.', force: true });
assert.equal(r.status, 201); const hana2 = r.body.contact;
ok('contacts: normalized email/tags, validation, duplicate check by phone; "save anyway" with force');

r = await as('olivia').get(`${C}/duplicates`);
// Fuzzy matching: same name and a similar email name (hana / hana.lee) but nothing else in common → "possible", not "likely".
assert.equal(r.body.groups.length, 1); assert.equal(r.body.groups[0].level, 'possible');
assert.ok(r.body.groups[0].score >= 0.7 && r.body.groups[0].score < 0.85, String(r.body.groups[0].score));
assert.ok(!r.body.groups[0].reasons.includes('Same name and company'));
assert.ok(r.body.groups[0].reasons.some((x: string) => /Email names .* similar/.test(x)));
assert.deepEqual(r.body.leadMatches, []);
await as('olivia').patch(`${C}/${hana.id}`, { company: 'Acme Inc' });
r = await as('olivia').get(`${C}/duplicates`);
assert.equal(r.body.groups.length, 1); assert.equal(r.body.groups[0].contacts.length, 2); assert.ok(r.body.groups[0].reasons.includes('Same name and company'));
assert.equal(r.body.groups[0].level, 'likely'); assert.ok(r.body.groups[0].reasons.includes('Same company after normalization'));
assert.equal(r.body.groups[0].pairs.length, 1); assert.deepEqual([...r.body.groups[0].pairs[0].ids].sort(), [hana.id, hana2.id].sort());
ok('possible-duplicates list: a fuzzy "possible" match, then "likely" once the company matches after normalization (Acme Inc / acme inc.)');

r = await as('olivia').get(`${C}?q=hana`); assert.equal(r.body.count, 2);
r = await as('olivia').get(`${C}?q=0100`); assert.equal(r.body.count, 1);
r = await as('olivia').get(`${C}?tag=vip`); assert.equal(r.body.count, 1);
ok('search by name, phone digits and tag');

// ---- Linked records + profile ----
const orgA = (await store.get('crm_user_memberships/olivia')).defaultOrgId;
await store.set(`organizations/${orgA}/proposals/prop_1`, { id: 'prop_1', number: 'P-0001', title: 'Website', status: 'sent', client: { name: 'Hana', email: 'hana.lee@gmail.test', company: 'Acme' }, contactId: null, totals: { total: 100000 }, createdAt: new Date().toISOString() });
await store.set(`billing/${orgA}/clients/cl_1`, { id: 'cl_1', name: 'Hana Lee', email: 'hana@acme.test' });
await store.set(`organizations/${orgA}/scheduled_meetings/smt_1`, { id: 'smt_1', title: 'Kickoff', guests: ['hana@acme.test'], startTime: new Date(Date.now() + 86_400_000).toISOString(), status: 'SCHEDULED' });
await store.set(`organizations/${orgA}/inbound_messages/in_1`, { id: 'in_1', from: '+15550100100', channel: 'WHATSAPP', body: 'Can you send the quote?', at: new Date().toISOString() });
await store.set(`organizations/${orgA}/tasks/task_x`, { id: 'task_x', orgId: orgA, title: 'Call Hana back', contactId: hana2.id, status: 'open', completed: false, createdAt: new Date().toISOString() });
r = await as('olivia').get(`${C}/${hana.id}`);
assert.equal(r.status, 200); assert.equal(r.body.company.id, acme.id);
assert.equal(r.body.invoicingClients.length, 1); assert.equal(r.body.meetings.length, 1);
assert.equal(r.body.communications.length, 1); assert.equal(r.body.communications[0].channel, 'WHATSAPP');
assert.equal(r.body.proposals.length, 0);
assert.ok(r.body.timeline.some((a: any) => a.title === 'Contact created'));
ok('profile: company, invoicing client, meeting and WhatsApp history matched by id, email and phone');

// ---- Merge: every link moves, nothing is lost ----
assert.equal((await as('olivia').post(`${C}/merge`, { keepId: hana.id, mergeIds: [] })).status, 400);
r = await as('olivia').post(`${C}/merge`, { keepId: hana.id, mergeIds: [hana2.id] });
assert.equal(r.status, 200); assert.equal(r.body.moved.tasks, 1);
const kept = r.body.contact;
assert.ok(kept.altEmails.includes('hana.lee@gmail.test')); assert.deepEqual(kept.mergedFrom, [hana2.id]);
const tomb = await store.get(`organizations/${orgA}/contacts/${hana2.id}`);
assert.equal(tomb.mergedInto, hana.id); assert.equal(tomb.email, 'hana.lee@gmail.test', 'the merged record keeps its data');
assert.equal((await store.get(`organizations/${orgA}/tasks/task_x`)).contactId, hana.id);
r = await as('olivia').get(`${C}/${hana.id}`);
assert.equal(r.body.proposals.length, 1, 'the proposal sent to the other email now shows on the kept contact');
assert.equal(r.body.tasks.length, 1);
assert.ok(r.body.timeline.some((a: any) => a.type === 'merged'));
assert.ok(r.body.timeline.some((a: any) => a.mergedFromContactId === hana2.id), 'timeline of the merged contact moved too');
assert.equal((await as('olivia').get(`${C}/${hana2.id}`)).body.mergedInto, hana.id);
assert.equal((await as('olivia').get(C)).body.count, 1);
ok('merge re-points tasks, keeps both emails, moves the timeline and leaves a tombstone with all data');

// ---- Notes, update, soft delete, restore ----
assert.equal((await as('olivia').post(`${C}/${hana.id}/notes`, { note: '' })).status, 400);
assert.equal((await as('olivia').post(`${C}/${hana.id}/notes`, { note: 'Prefers email.' })).status, 201);
r = await as('olivia').patch(`${C}/${hana.id}`, { title: 'COO', email: 'bad' });
assert.equal(r.status, 400);
r = await as('olivia').patch(`${C}/${hana.id}`, { title: 'COO' });
assert.equal(r.body.contact.title, 'COO');
r = await as('olivia').get(`${C}/${hana.id}`);
assert.ok(r.body.timeline.some((a: any) => a.description === 'Prefers email.'));
assert.equal((await as('olivia').del(`${C}/${hana.id}`)).status, 200);
assert.equal((await as('olivia').get(C)).body.count, 0);
assert.ok(await store.get(`organizations/${orgA}/contacts/${hana.id}`), 'soft delete keeps the record');
assert.equal((await as('olivia').get(`${C}?includeDeleted=true`)).body.count, 1);
assert.equal((await as('olivia').post(`${C}/${hana.id}/restore`)).status, 200);
assert.equal((await as('olivia').get(C)).body.count, 1);
ok('notes reach the timeline; soft delete hides the contact but keeps it; restore brings it back');

// ---- Company profile ----
r = await as('olivia').get(`${CO}/${acme.id}`);
assert.equal(r.status, 200); assert.equal(r.body.contacts.length, 1); assert.equal(r.body.totals.contacts, 1);
assert.equal((await as('olivia').post(`${CO}/${acme.id}/notes`, { note: 'Renewal in May' })).status, 201);
r = await as('olivia').get(`${CO}/${acme.id}`);
assert.ok(r.body.timeline.some((a: any) => a.description === 'Renewal in May'));
assert.ok(r.body.timeline.some((a: any) => a.via?.type === 'contact'), 'company timeline includes its contacts\' activity');
assert.equal((await as('olivia').patch(`${CO}/${acme.id}`, { parentCompanyId: acme.id })).status, 400);
ok('company profile: contacts, totals, its own notes and its contacts\' timeline');

// ---- Lead conversion reuses the existing contact and company ----
r = await as('olivia').post('/api/leads', { name: 'Hana Lee', email: 'hana@acme.test', company: 'Acme Inc' });
const leadId = r.body.lead.id;
r = await as('olivia').post(`/api/leads/${leadId}/convert`, { dealValue: 5000 });
assert.equal(r.status, 200);
assert.equal(r.body.conversion.contactId, hana.id, 'same email → same contact');
assert.equal(r.body.conversion.companyId, acme.id, 'same company name → same company');
assert.equal((await as('olivia').get(C)).body.count, 1); assert.equal((await as('olivia').get(CO)).body.count, 1);
const kept2 = await store.get(`organizations/${orgA}/contacts/${hana.id}`);
assert.equal(kept2.title, 'COO', 'existing contact data is kept'); assert.ok(kept2.leadIds.includes(leadId));
r = await as('olivia').get(`${C}/${hana.id}`);
assert.equal(r.body.leads.length, 1); assert.equal(r.body.deals.length, 1);
ok('converting a lead for a known person links to their contact and company instead of creating duplicates');

// ---- Tenant isolation ----
assert.equal((await as('bea').get(C)).body.count, 0);
assert.equal((await as('bea').get(`${C}/${hana.id}`)).status, 404);
assert.equal((await as('bea').patch(`${C}/${hana.id}`, { name: 'Pwned' })).status, 404);
assert.equal((await as('bea').del(`${C}/${hana.id}`)).status, 404);
assert.equal((await as('bea').post(`${C}/merge`, { keepId: hana.id, mergeIds: [hana2.id] })).status, 404);
assert.equal((await as('bea').get(`${CO}/${acme.id}`)).status, 404);
r = await as('bea').post(C, { name: 'Bea’s client', companyId: acme.id });
assert.equal(r.status, 400, 'can’t attach a contact to another organization’s company');
assert.equal((await store.get(`organizations/${orgA}/contacts/${hana.id}`)).name, 'Hana Lee');
ok('another organization can’t read, change, delete, merge or link to these records');

// ---- Roles ----
const addMember = async (uid: string, role: string) => {
  await store.set(`organizations/${orgA}/members/${uid}`, { userId: uid, role, email: `${uid}@a.test`, name: uid, joinedAt: new Date().toISOString() });
  await store.set(`crm_user_memberships/${uid}`, { userId: uid, orgs: { [orgA]: role }, defaultOrgId: orgA });
};
await addMember('rory', 'READ_ONLY'); await addMember('sam', 'SALES_REP');
assert.equal((await as('rory').get(C)).body.count, 1);
assert.equal((await as('rory').post(C, { name: 'Nope' })).status, 403);
assert.equal((await as('rory').patch(`${C}/${hana.id}`, { name: 'Nope' })).status, 403);
assert.equal((await as('rory').post(`${CO}`, { name: 'Nope' })).status, 403);
assert.equal((await as('sam').del(`${C}/${hana.id}`)).status, 403);
assert.equal((await as('sam').post(`${C}/merge`, { keepId: hana.id, mergeIds: [hana2.id] })).status, 403);
assert.equal((await as('sam').post(C, { name: 'Sam’s lead', email: 'sl@x.test' })).status, 201);
ok('read-only can view but not change; sales reps can add but not delete or merge');

// ---- Backfill: idempotent, additive ----
const orgB = (await store.get('crm_user_memberships/bea')).defaultOrgId;
await store.set(`organizations/${orgB}/leads/l1`, { id: 'l1', name: 'Old Convert', email: 'old@x.test', status: 'converted', isConverted: true, convertedContactId: 'contact_gone' });
await store.set(`organizations/${orgB}/leads/l2`, { id: 'l2', name: 'Old Convert again', email: 'OLD@x.test', status: 'converted', isConverted: true });
await store.set(`organizations/${orgB}/leads/l3`, { id: 'l3', name: 'Open', email: 'open@x.test', status: 'new' });
await store.set(`organizations/${orgB}/proposals/p1`, { id: 'p1', client: { email: 'old@x.test' } });
await store.set(`billing/${orgB}/clients/c1`, { id: 'c1', name: 'Old', email: 'old@x.test' });
let b = await backfillContacts(orgB, { apply: false });
assert.deepEqual([b.contactsCreated, b.leadsLinked, b.proposalsLinked, b.invoicingClientsLinked], [1, 2, 1, 1]);
assert.equal((await store.list(`organizations/${orgB}/contacts`)).length, 0, 'dry run writes nothing');
b = await backfillContacts(orgB, { apply: true });
const made = await store.list(`organizations/${orgB}/contacts`);
assert.equal(made.length, 1, 'two leads with the same email → one contact');
assert.equal((await store.get(`organizations/${orgB}/leads/l2`)).convertedContactId, made[0].id);
assert.equal((await store.get(`organizations/${orgB}/proposals/p1`)).crmContactId, made[0].id);
assert.equal((await store.get(`organizations/${orgB}/proposals/p1`)).client.email, 'old@x.test', 'embedded client data kept');
assert.equal((await store.get(`billing/${orgB}/clients/c1`)).contactId, made[0].id);
b = await backfillContacts(orgB, { apply: true });
assert.deepEqual([b.contactsCreated, b.leadsLinked, b.proposalsLinked, b.invoicingClientsLinked], [0, 0, 0, 0]);
assert.equal((await store.list(`organizations/${orgB}/contacts`)).length, 1);
assert.equal((await store.list(`organizations/${orgA}/contacts`)).length, 3, 'other organizations untouched');
ok('backfill: dry run first, one contact per email, links proposals and invoicing clients, re-run changes nothing');

console.log(`\n${passed} passed (contacts)`);
