/**
 * One activity timeline: inbox notes and tasks reach the linked lead/contact timeline and the organization
 * feed; contact timelines include their leads' history; website visitors who give an email are linked to the
 * known person or become one (deduplicated) lead. Tenant isolation and roles.
 * Run: npx tsx src/server/crm/__tests__/timeline.test.ts
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
const inbox = await import('../../../routes/messagingPlatform');
const leadsRouter = (await import('../../../routes/leadsApi')).default;
const { contactsRouter } = await import('../../../routes/contactsApi');

const app = express(); app.use(express.json());
app.use('/api/messaging', guard(PUBLIC.messaging), inbox.default);
app.use('/api/leads', guard(PUBLIC.leads), leadsRouter);
app.use('/api/contacts', guard(PUBLIC.none), contactsRouter);
const as = (uid: string) => ({
  get: (p: string) => request(app).get(p).set('X-Dev-User-Id', uid),
  post: (p: string, b: any = {}) => request(app).post(p).set('X-Dev-User-Id', uid).send(b),
});
const M = '/api/messaging';
const feed = async (orgId: string) => store.list(`organizations/${orgId}/activities`);

// ---- Inbox notes → lead timeline + org feed ----
const lead = (await as('olivia').post('/api/leads', { name: 'Lia Lead', email: 'lia@x.test' })).body.lead;
const orgA = (await store.get('crm_user_memberships/olivia')).defaultOrgId;
let r = await as('olivia').post(`${M}/conversations`, { title: 'Lia thread', type: 'support', crmRecord: { type: 'lead', id: lead.id, title: 'Lia Lead' } });
const conv = r.body.conversation;
r = await as('olivia').post(`${M}/conversations/${conv.id}/notes`, { note: 'Wants the annual plan.' });
assert.equal(r.status, 201);
let leadView = (await as('olivia').get(`/api/leads/${lead.id}`)).body;
assert.ok(leadView.activities.some((a: any) => a.type === 'note_added' && a.description === 'Wants the annual plan.'));
assert.ok((await feed(orgA)).some((a: any) => a.type === 'note_added' && a.targetId === lead.id && a.targetType === 'lead'));
assert.ok((await as('olivia').get(`${M}/conversations/${conv.id}/activities`)).body.activities.some((a: any) => a.description === 'Wants the annual plan.'), 'still on the conversation too');
ok('a note in a lead-linked conversation shows on the lead timeline, the org feed and the conversation');

r = await as('olivia').post(`${M}/conversations/${conv.id}/tasks`, { title: 'Send annual pricing' });
leadView = (await as('olivia').get(`/api/leads/${lead.id}`)).body;
assert.ok(leadView.activities.some((a: any) => a.type === 'task_created' && /Send annual pricing/.test(a.title)));
ok('a task created in the inbox shows on the lead timeline');

// Older links labelled leads as "contact": still reach the lead.
r = await as('olivia').post(`${M}/conversations`, { title: 'Old link', type: 'support', crmRecord: { type: 'contact', id: lead.id, title: 'Lia Lead' } });
await as('olivia').post(`${M}/conversations/${r.body.conversation.id}/notes`, { note: 'From an old-style link.' });
leadView = (await as('olivia').get(`/api/leads/${lead.id}`)).body;
assert.ok(leadView.activities.some((a: any) => a.description === 'From an old-style link.'));
ok('older links that called a lead a "contact" still reach the lead');

// Contact-linked conversation → contact timeline; the contact timeline also includes its leads' history.
const contact = (await as('olivia').post('/api/contacts', { name: 'Lia Lead', email: 'lia@x.test', force: true })).body.contact;
r = await as('olivia').post(`${M}/conversations`, { title: 'Contact thread', type: 'support', crmRecord: { type: 'contact', id: contact.id, title: 'Lia' } });
await as('olivia').post(`${M}/conversations/${r.body.conversation.id}/notes`, { note: 'Renewal call booked.' });
let profile = (await as('olivia').get(`/api/contacts/${contact.id}`)).body;
assert.ok(profile.timeline.some((a: any) => a.description === 'Renewal call booked.' && a.via.type === 'contact'));
assert.ok(profile.timeline.some((a: any) => a.description === 'Wants the annual plan.' && a.via.type === 'lead'), 'lead history (same email) appears on the contact');
assert.equal(profile.leads.length, 1);
ok('contact timeline: its own notes plus the history of its leads');

// Unlinked conversation: note stays on the conversation only, nothing breaks.
r = await as('olivia').post(`${M}/conversations`, { title: 'Internal', type: 'group' });
const before = (await feed(orgA)).length;
assert.equal((await as('olivia').post(`${M}/conversations/${r.body.conversation.id}/notes`, { note: 'just us' })).status, 201);
assert.equal((await feed(orgA)).length, before);
ok('notes on unlinked conversations stay on the conversation');

// A link pointing at another organization's record writes nothing there.
const leadB = (await as('bea').post('/api/leads', { name: 'Bea Lead', email: 'b@x.test' })).body.lead;
r = await as('olivia').post(`${M}/conversations`, { title: 'Sneaky', type: 'support', crmRecord: { type: 'lead', id: leadB.id, title: 'x' } });
await as('olivia').post(`${M}/conversations/${r.body.conversation.id}/notes`, { note: 'should not cross' });
const orgB = (await store.get('crm_user_memberships/bea')).defaultOrgId;
assert.ok(!(await store.list(`organizations/${orgB}/leads/${leadB.id}/activities`)).some((a: any) => a.description === 'should not cross'));
assert.ok(!(await feed(orgB)).some((a: any) => a.description === 'should not cross'));
assert.equal((await as('bea').post(`${M}/conversations/${conv.id}/notes`, { note: 'x' })).status, 404);
ok('a note can’t reach another organization’s records or conversations');

// Read-only members can't add notes.
await store.set(`organizations/${orgA}/members/rory`, { userId: 'rory', role: 'READ_ONLY', email: '', name: 'Rory', joinedAt: new Date().toISOString() });
await store.set('crm_user_memberships/rory', { userId: 'rory', orgs: { [orgA]: 'READ_ONLY' }, defaultOrgId: orgA });
assert.equal((await as('rory').post(`${M}/conversations/${conv.id}/notes`, { note: 'x' })).status, 403);
ok('read-only members can’t add notes');

// ---- Website visitors ----
assert.equal((await as('olivia').post(`${M}/widgets`, { widgetKey: 'acme_chat', businessName: 'Acme' })).status, 201);
const anon = request(app);
const leadsOf = async () => (await store.list(`organizations/${orgA}/leads`));
const n0 = (await leadsOf()).length;
r = await anon.post(`${M}/visitor-init`).send({ widgetKey: 'acme_chat', visitorName: 'Vic' });
assert.equal(r.status, 200); assert.equal((await leadsOf()).length, n0, 'no email, no lead');
r = await anon.post(`${M}/visitor-init`).send({ widgetKey: 'acme_chat', visitorName: 'Bad', visitorEmail: 'not-an-email' });
assert.equal((await leadsOf()).length, n0);
r = await anon.post(`${M}/visitor-init`).send({ widgetKey: 'acme_chat', visitorName: 'Vera Visitor', visitorEmail: 'Vera@Shop.test', currentPage: 'https://acme.test/pricing' });
assert.equal(r.status, 200);
assert.ok(!JSON.stringify(r.body).includes('crmRecord'), 'the visitor isn’t shown internal CRM data');
let all = await leadsOf();
const vera = all.find((l: any) => l.email === 'vera@shop.test');
assert.ok(vera); assert.equal(vera.source, 'website_chat'); assert.equal(all.length, n0 + 1);
let convs = (await as('olivia').get(`${M}/conversations`)).body.conversations;
const vc = convs.find((c: any) => c.id === r.body.conversationId);
assert.deepEqual([vc.crmRecord.type, vc.crmRecord.id], ['lead', vera.id]);
r = await anon.post(`${M}/visitor-init`).send({ widgetKey: 'acme_chat', visitorName: 'Vera again', visitorEmail: 'vera@shop.test' });
assert.equal((await leadsOf()).length, n0 + 1, 'same email again → no second lead');
convs = (await as('olivia').get(`${M}/conversations`)).body.conversations;
assert.equal(convs.find((c: any) => c.id === r.body.conversationId).crmRecord.id, vera.id);
assert.ok((await store.list(`organizations/${orgA}/leads/${vera.id}/activities`)).some((a: any) => a.type === 'website_chat'));
r = await anon.post(`${M}/visitor-init`).send({ widgetKey: 'acme_chat', visitorName: 'Lia', visitorEmail: 'lia@x.test' });
convs = (await as('olivia').get(`${M}/conversations`)).body.conversations;
const lc = convs.find((c: any) => c.id === r.body.conversationId);
assert.deepEqual([lc.crmRecord.type, lc.crmRecord.id], ['contact', contact.id], 'a known contact is preferred over creating anything');
assert.equal((await leadsOf()).length, n0 + 1);
assert.equal((await store.list(`organizations/${orgB}/leads`)).length, 1, 'other organizations untouched');
ok('visitors with an email are linked to the known contact/lead or become one website_chat lead, never two');

console.log(`\n${passed} passed (timeline)`);
