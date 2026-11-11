/**
 * Privacy & compliance: consent records (incl. the website form), data-subject requests (access/export,
 * correction, erasure with approval and dry-run preview, across every store), retention policies,
 * access reviews and incidents. Cross-tenant and non-admin attempts are refused.
 * Run: npx tsx src/server/__tests__/compliance.test.ts
 */
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';

let passed = 0; const ok = (n: string) => { passed++; console.log('  ✓', n); };
Object.assign(process.env, { NODE_ENV: 'test', SOCIAL_ACCOUNTS_DEV_AUTH: 'true', CRM_STORE: 'memory', APP_URL: 'https://app.example.com' });

const { guard, PUBLIC } = await import('../routeGuards');
const { getDocStore } = await import('../data/docStore');
const { listAudit } = await import('../audit/auditLog');
const { rotateLeadCaptureKey } = await import('../crm/crmRepository');
const { resetInboxCacheForTests } = await import('../../routes/messagingPlatform');
const { makeOrg, addMember, as } = await import('./fixtures');

const app = express(); app.use(express.json());
app.use('/api/compliance', guard(PUBLIC.none), (await import('../../routes/complianceApi')).default);
app.use('/api/leads', guard(PUBLIC.leads), (await import('../../routes/leadsApi')).default);

const st = await getDocStore();
const A = await makeOrg('ann'); const B = await makeOrg('bob');
await addMember(A.id, 'mia', 'MANAGER');
const EMAIL = 'pat@example.com';
const now = new Date().toISOString();
const old = new Date(Date.now() - 400 * 86_400_000).toISOString();

async function seed(orgId: string) {
  const O = `organizations/${orgId}`;
  await st.set(`${O}/leads/lead_p`, { id: 'lead_p', orgId, name: 'Pat Doe', email: 'Pat@Example.com', phone: '+1 555 010 2020', company: 'Doe Co', notes: 'Pat asked about pricing', status: 'converted', isConverted: true, convertedDealId: 'deal_p', createdAt: now, updatedAt: now });
  await st.set(`${O}/leads/lead_p/tasks/t1`, { id: 't1', title: 'Call Pat Doe', completed: false, createdAt: now });
  await st.set(`${O}/leads/lead_p/activities/a1`, { id: 'a1', type: 'created', title: 'Pat Doe created', description: 'Pat Doe from Doe Co', timestamp: now });
  await st.set(`${O}/contacts/c_p`, { id: 'c_p', name: 'Pat Doe', email: EMAIL, leadId: 'lead_p' });
  await st.set(`${O}/deals/deal_p`, { id: 'deal_p', name: 'Doe deal', client: 'Doe Co', value: 5000, leadId: 'lead_p' });
  await st.set(`${O}/activities/act_p`, { id: 'act_p', title: 'New lead: Pat Doe', description: 'Pat Doe', targetId: 'lead_p', timestamp: now });
  await st.set(`${O}/proposals/prop_p`, { id: 'prop_p', client: { name: 'Pat Doe', email: EMAIL, company: 'Doe Co' }, shareTokenHash: 'abc123', totals: { total: 100000 } });
  await st.set(`billing/${orgId}`, { version: 3 });
  await st.set(`billing/${orgId}/clients/bc_p`, { id: 'bc_p', name: 'Pat Doe', email: EMAIL, phone: '555' });
  await st.set(`billing/${orgId}/invoices/inv_p`, { id: 'inv_p', clientId: 'bc_p', billTo: { name: 'Pat Doe', email: EMAIL }, total: '50.00' });
  await st.set(`${O}/scheduled_meetings/m_p`, { id: 'm_p', title: 'Demo', guests: [EMAIL, 'other@example.com'], startTime: now });
  await st.set(`${O}/meeting_notes/n_p`, { id: 'n_p', title: 'Demo notes', body: 'Pat wants 3 seats', leadId: 'lead_p', createdAt: now });
  await st.set(`${O}/inbound_messages/sms_p`, { id: 'sms_p', channel: 'SMS', from: '+15550102020', body: 'Hi it is Pat', at: now });
  await st.set(`${O}/inbox_conversations/conv_p`, { id: 'conv_p', orgId, type: 'widget', channel: 'widget', title: 'Website chat', status: 'open', participants: [{ id: 'v1', name: 'Pat Doe', email: EMAIL, role: 'visitor' }], visitorMetadata: { email: EMAIL, name: 'Pat Doe' }, createdAt: now, updatedAt: now });
  await st.set(`${O}/inbox_conversations/conv_p/messages/msg1`, { id: 'msg1', conversationId: 'conv_p', senderType: 'visitor', senderName: 'Pat Doe', content: 'My address is 1 Main St', createdAt: now });
  await st.set(`${O}/inbox_conversations/conv_p/messages/msg2`, { id: 'msg2', conversationId: 'conv_p', senderType: 'user', senderName: 'Ann', content: 'Thanks!', createdAt: now });
}
await seed(A.id); await seed(B.id);
resetInboxCacheForTests();

// ---- Access control ----
assert.equal((await request(app).get('/api/compliance/requests')).status, 401);
assert.equal((await request(app).get('/api/compliance/requests').set(as('mia', A.id))).status, 403);
ok('signed-out callers and non-admins are refused');

// ---- Consent ----
const c1 = await request(app).post('/api/compliance/consents').set(as('ann', A.id)).send({ email: EMAIL, purpose: 'marketing_email', status: 'granted', source: 'phone call' });
assert.equal(c1.status, 201);
await request(app).post('/api/compliance/consents').set(as('ann', A.id)).send({ email: EMAIL, purpose: 'marketing_email', status: 'withdrawn' });
const cl = await request(app).get(`/api/compliance/consents?email=${EMAIL}`).set(as('ann', A.id));
assert.equal(cl.body.current.marketing_email, 'withdrawn'); assert.equal(cl.body.consents.length, 2);
assert.equal((await request(app).post('/api/compliance/consents').set(as('ann', A.id)).send({ email: 'bad', purpose: 'sms', status: 'granted' })).status, 400);
ok('consent is recorded per purpose; the latest entry is the current status');

const key = await rotateLeadCaptureKey(A.id);
const cap = await request(app).post('/api/leads/capture').set('X-Lead-Capture-Key', key).send({ name: 'Form Person', email: 'form@example.com', consent: { marketing_email: true, sms: false, bogus: true } });
assert.equal(cap.status, 201);
const fc = await request(app).get('/api/compliance/consents?email=form@example.com').set(as('ann', A.id));
assert.deepEqual(fc.body.current, { marketing_email: 'granted', sms: 'withdrawn' });
assert.match(fc.body.consents[0].source, /^website_form/);
ok('the website form records the consent it sends (unknown purposes ignored)');

// ---- Access/export request ----
const ar = await request(app).post('/api/compliance/requests').set(as('ann', A.id)).send({ type: 'access', subjectEmail: EMAIL });
assert.equal(ar.status, 201); assert.equal(ar.body.request.status, 'requested'); assert.ok(ar.body.request.dueBy);
assert.equal((await request(app).post(`/api/compliance/requests/${ar.body.request.id}/execute`).set(as('ann', A.id))).status, 409);
await request(app).post(`/api/compliance/requests/${ar.body.request.id}/approve`).set(as('ann', A.id));
const ex = await request(app).post(`/api/compliance/requests/${ar.body.request.id}/execute`).set(as('ann', A.id));
assert.equal(ex.status, 200);
const bundle = ex.body.bundle;
assert.equal(bundle.leads[0].id, 'lead_p'); assert.equal(bundle.leads[0].tasks.length, 1);
assert.equal(bundle.contacts.length, 1); assert.equal(bundle.deals.length, 1); assert.equal(bundle.proposals.length, 1);
assert.equal(bundle.invoicing.clients.length, 1); assert.equal(bundle.invoicing.invoices.length, 1);
assert.equal(bundle.meetings.length, 1); assert.equal(bundle.meetingNotes.length, 1); assert.equal(bundle.phone.messages.length, 1);
assert.equal(bundle.inbox.length, 1); assert.equal(bundle.inbox[0].messages.length, 2); assert.equal(bundle.consents.length, 2);
assert.ok(!JSON.stringify(bundle).includes('abc123'), 'share token hashes are not exported');
ok('an approved access request exports everything held about the person, across every store, without secrets');

// Another organization can't see or act on it.
assert.equal((await request(app).get(`/api/compliance/requests/${ar.body.request.id}/preview`).set(as('bob', B.id))).status, 404);
assert.equal((await request(app).post(`/api/compliance/requests/${ar.body.request.id}/execute`).set(as('bob', A.id))).status, 403);
ok('requests are invisible to other organizations');

// ---- Correction ----
const cr = await request(app).post('/api/compliance/requests').set(as('ann', A.id)).send({ type: 'correction', subjectEmail: EMAIL, corrections: { company: 'Doe & Sons' } });
assert.equal(cr.status, 201);
assert.equal((await request(app).post('/api/compliance/requests').set(as('ann', A.id)).send({ type: 'correction', subjectEmail: EMAIL })).status, 400);
await request(app).post(`/api/compliance/requests/${cr.body.request.id}/approve`).set(as('ann', A.id));
await request(app).post(`/api/compliance/requests/${cr.body.request.id}/execute`).set(as('ann', A.id));
assert.equal((await st.get(`organizations/${A.id}/leads/lead_p`)).company, 'Doe & Sons');
ok('corrections are applied to the lead and contact after approval');

// ---- Erasure ----
const dr = await request(app).post('/api/compliance/requests').set(as('ann', A.id)).send({ type: 'deletion', subjectEmail: EMAIL, details: 'Email from Pat' });
const id = dr.body.request.id;
const pv = await request(app).get(`/api/compliance/requests/${id}/preview`).set(as('ann', A.id));
assert.equal(pv.status, 200); assert.equal(pv.body.preview.applied, false);
assert.equal(pv.body.preview.counts.leads, 1); assert.equal(pv.body.preview.counts.inboxMessages, 1);
assert.equal((await st.get(`organizations/${A.id}/leads/lead_p`)).name, 'Pat Doe');
ok('erasure shows a preview first and changes nothing');
const rj = await request(app).post('/api/compliance/requests').set(as('ann', A.id)).send({ type: 'deletion', subjectEmail: 'x@example.com' });
await request(app).post(`/api/compliance/requests/${rj.body.request.id}/reject`).set(as('ann', A.id)).send({ reason: 'Identity not verified' });
assert.equal((await request(app).post(`/api/compliance/requests/${rj.body.request.id}/execute`).set(as('ann', A.id))).status, 409);
ok('a rejected request can’t be carried out');

await request(app).post(`/api/compliance/requests/${id}/approve`).set(as('ann', A.id));
const done = await request(app).post(`/api/compliance/requests/${id}/execute`).set(as('ann', A.id));
assert.equal(done.status, 200); assert.equal(done.body.request.status, 'completed');
assert.ok(!JSON.stringify(done.body.request).includes(EMAIL), 'the request no longer holds the email');
const O = `organizations/${A.id}`;
const lead = await st.get(`${O}/leads/lead_p`);
assert.equal(lead.name, 'Removed contact'); assert.equal(lead.email, ''); assert.equal(lead.phone, ''); assert.equal(lead.notes, ''); assert.ok(lead.anonymizedAt);
assert.equal((await st.get(`${O}/leads/lead_p/tasks/t1`)).title, 'Follow-up (contact removed)');
assert.equal((await st.get(`${O}/contacts/c_p`)).email, '');
const deal = await st.get(`${O}/deals/deal_p`); assert.equal(deal.value, 5000); assert.equal(deal.client, 'Removed contact');
assert.equal((await st.get(`${O}/activities/act_p`)).description, '');
const prop = await st.get(`${O}/proposals/prop_p`); assert.equal(prop.client.email, ''); assert.equal(prop.totals.total, 100000);
assert.equal((await st.get(`billing/${A.id}/clients/bc_p`)).email, '');
const inv = await st.get(`billing/${A.id}/invoices/inv_p`); assert.equal(inv.billTo.email, ''); assert.equal(inv.total, '50.00');
assert.equal((await st.get(`billing/${A.id}`)).version, 4);
assert.deepEqual((await st.get(`${O}/scheduled_meetings/m_p`)).guests, ['other@example.com']);
assert.match((await st.get(`${O}/meeting_notes/n_p`)).body, /removed/);
assert.match((await st.get(`${O}/inbound_messages/sms_p`)).body, /removed/);
const msgs = await st.list(`${O}/inbox_conversations/conv_p/messages`);
assert.match(msgs.find((m) => m.id === 'msg1').content, /removed/); assert.equal(msgs.find((m) => m.id === 'msg2').content, 'Thanks!');
const conv = await st.get(`${O}/inbox_conversations/conv_p`); assert.equal(conv.participants[0].email, ''); assert.equal(conv.visitorMetadata.email, undefined);
const cons = (await st.list(`${O}/consents`)).filter((c) => c.subjectErased);
assert.equal(cons.length, 2); assert.ok(cons.every((c) => c.email === '' && c.emailHash));
assert.equal((await st.list(`${O}/dsr_tombstones`)).length, 1);
assert.ok(await st.get(`${O}/leads/lead_p`), 'records are anonymized, never hard-deleted');
ok('erasure anonymizes every store (records, amounts and ids kept), keeps a hashed tombstone and consent proof');
assert.equal((await st.get(`organizations/${B.id}/leads/lead_p`)).email, 'Pat@Example.com');
assert.equal((await st.list(`organizations/${B.id}/inbox_conversations/conv_p/messages`)).find((m) => m.id === 'msg1').content, 'My address is 1 Main St');
ok('the same person in another organization is untouched');
const acts = (await listAudit(A.id, { limit: 200 })).entries.map((e) => e.action);
for (const a of ['consent.recorded', 'privacy_request.created', 'privacy_request.approved', 'privacy_request.rejected', 'data.exported', 'privacy_request.corrected', 'privacy_request.erased']) assert.ok(acts.includes(a), a);
assert.ok(!JSON.stringify((await listAudit(A.id, { limit: 200 })).entries).includes(EMAIL), 'audit entries mask the email');
ok('every step is audited, with the email masked');

// ---- Retention ----
await st.set(`${O}/leads/old_lead`, { id: 'old_lead', name: 'Old', email: 'old@example.com', status: 'new', createdAt: old, updatedAt: old });
assert.equal((await request(app).put('/api/compliance/retention').set(as('ann', A.id)).send({ policies: { audit_log: { enabled: true, days: 30, action: 'archive' } } })).status, 400);
assert.equal((await request(app).put('/api/compliance/retention').set(as('ann', A.id)).send({ policies: { audit_log: { enabled: true, days: 400, action: 'anonymize' } } })).status, 400);
assert.equal((await request(app).put('/api/compliance/retention').set(as('ann', A.id)).send({ policies: { consents: { enabled: true, days: 400, action: 'archive' } } })).status, 400);
ok('the audit log keeps at least a year (archive only) and consent records aren’t subject to retention');
const put = await request(app).put('/api/compliance/retention').set(as('ann', A.id)).send({ policies: { leads: { enabled: true, days: 365, action: 'anonymize' } } });
assert.equal(put.status, 200);
const dry = await request(app).post('/api/compliance/retention/run').set(as('ann', A.id)).send({});
assert.equal(dry.body.run.results[0].matched, 1); assert.equal(dry.body.run.results[0].applied, 0);
assert.equal((await st.get(`${O}/leads/old_lead`)).email, 'old@example.com');
ok('retention runs are dry runs unless asked to apply');
const real = await request(app).post('/api/compliance/retention/run').set(as('ann', A.id)).send({ apply: true });
assert.equal(real.body.run.results[0].applied, 1);
assert.equal((await st.get(`${O}/leads/old_lead`)).email, '');
assert.equal((await st.get(`${O}/leads/lead_p`)).anonymizedAt !== undefined, true);
const { runRetention } = await import('../compliance/retention');
const auto = await runRetention(A.id, { apply: true, autoApplyOnly: true });
assert.equal(auto.results[0].applied, 0, 'the sweeper doesn’t apply a policy that isn’t set to apply automatically');
ok('applying anonymizes only records past the limit; the sweeper only applies auto-apply policies');

// ---- Access reviews ----
const rv = await request(app).get('/api/compliance/access-reviews').set(as('ann', A.id));
assert.equal(rv.status, 200);
const annRow = rv.body.members.find((m: any) => m.userId === 'ann');
assert.equal(annRow.role, 'OWNER'); assert.ok(annRow.lastActiveAt); assert.equal(annRow.lastSignInMfa, false);
const cmp = await request(app).post('/api/compliance/access-reviews').set(as('ann', A.id)).send({ notes: 'Quarterly review: all roles correct.' });
assert.equal(cmp.status, 201); assert.equal(cmp.body.review.members.length, 2);
ok('access reviews list members with role, last activity and two-step status, and record completion');

// ---- Incidents ----
const inc = await request(app).post('/api/compliance/incidents').set(as('ann', A.id)).send({ title: 'Lost laptop', severity: 'high', personalDataInvolved: true });
assert.equal(inc.status, 201); assert.equal(inc.body.incident.status, 'open');
const upd = await request(app).patch(`/api/compliance/incidents/${inc.body.incident.id}`).set(as('ann', A.id)).send({ status: 'resolved', actions: 'Remote wipe confirmed' });
assert.equal(upd.body.incident.status, 'resolved'); assert.ok(upd.body.incident.resolvedAt);
assert.equal((await request(app).patch(`/api/compliance/incidents/${inc.body.incident.id}`).set(as('bob', B.id)).send({ status: 'closed' })).status, 404);
assert.equal((await request(app).post('/api/compliance/incidents').set(as('ann', A.id)).send({ severity: 'high' })).status, 400);
ok('incidents can be recorded and updated, only by their own organization');

console.log(`\n${passed} passed (compliance)`);
process.exit(0);
