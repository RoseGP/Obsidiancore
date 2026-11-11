/**
 * Meeting notes: saved per organization, edited only by their author, final after "Save to CRM",
 * logged on the activity feed and the linked lead, isolated between organizations.
 * Run: npx tsx src/server/meetings/__tests__/notes.test.ts
 */
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';

let passed = 0; const ok = (n: string) => { passed++; console.log('  ✓', n); };
Object.assign(process.env, { NODE_ENV: 'test', SOCIAL_ACCOUNTS_DEV_AUTH: 'true', CRM_STORE: 'memory' });

const { MemoryDocStore, setDocStore } = await import('../../data/docStore');
const store = new MemoryDocStore(); setDocStore(store);
const { guard, PUBLIC } = await import('../../routeGuards');
const notes = (await import('../../../routes/meetingNotes')).default;
const app = express(); app.use(express.json({ limit: '1mb' }));
app.use('/api/meeting-notes', guard(PUBLIC.none), notes);
const as = (uid: string) => ({
  get: (p: string) => request(app).get(p).set('X-Dev-User-Id', uid),
  post: (p: string, b: any = {}) => request(app).post(p).set('X-Dev-User-Id', uid).send(b),
  put: (p: string, b: any = {}) => request(app).put(p).set('X-Dev-User-Id', uid).send(b),
  del: (p: string) => request(app).delete(p).set('X-Dev-User-Id', uid),
});
const N = '/api/meeting-notes';

assert.equal((await request(app).get(N)).status, 401);
assert.equal((await request(app).put(`${N}/mnote_x`).send({ meetingKey: 'm1', body: 'x' })).status, 401);
ok('signed-out callers are refused');

// Olivia's organization, a lead, and two more members
let r = await as('olivia').post(N, { meetingKey: 'room_abc' });
assert.equal(r.status, 201); const id = r.body.id; assert.match(id, /^mnote_[0-9a-f]+$/);
const orgA = (await store.get('crm_user_memberships/olivia')).defaultOrgId;
await store.set(`organizations/${orgA}/leads/lead_1`, { id: 'lead_1', orgId: orgA, name: 'Ada Lovelace', email: 'ada@acme.test' });
for (const [uid, role] of [['sam', 'SALES_REP'], ['rory', 'READ_ONLY']] as const) {
  await store.set(`organizations/${orgA}/members/${uid}`, { userId: uid, role, email: '', name: uid, joinedAt: new Date().toISOString() });
  await store.set(`crm_user_memberships/${uid}`, { userId: uid, orgs: { [orgA]: role }, defaultOrgId: orgA });
}

r = await as('olivia').put(`${N}/${id}`, { meetingKey: 'room_abc', title: 'Kickoff with Acme', body: 'Budget approved.', leadId: 'lead_1' });
assert.equal(r.status, 200); assert.equal(r.body.note.status, 'draft'); assert.equal(r.body.note.leadName, 'Ada Lovelace'); assert.equal(r.body.note.authorId, 'olivia');
r = await as('olivia').put(`${N}/${id}`, { meetingKey: 'room_abc', title: 'Kickoff with Acme', body: 'Budget approved.\n[14:02] Start in March.' });
assert.equal(r.body.note.leadId, 'lead_1'); assert.match(r.body.note.body, /March/);
assert.equal((await store.get(`organizations/${orgA}/meeting_notes/${id}`)).body.includes('March'), true);
ok('drafts are created and updated in the organization\'s store; the lead link is kept');

assert.equal((await as('olivia').put(`${N}/${id}`, { meetingKey: 'room_abc', body: 'x'.repeat(20_001) })).status, 400);
assert.equal((await as('olivia').put(`${N}/${id}`, { meetingKey: '../bad', body: 'x' })).status, 400);
assert.equal((await as('olivia').put(`${N}/${id}`, { meetingKey: 'other_room', body: 'x' })).status, 400);
assert.equal((await as('olivia').put(`${N}/bad%20id`, { meetingKey: 'room_abc' })).status, 400);
ok('size limit, unsafe meeting reference and a different meeting are refused');

assert.equal((await as('sam').put(`${N}/${id}`, { meetingKey: 'room_abc', body: 'mine now' })).body.code, 'not_author');
assert.equal((await as('sam').post(`${N}/${id}/complete`)).status, 403);
assert.equal((await as('rory').put(`${N}/mnote_rory`, { meetingKey: 'room_abc', body: 'hi' })).status, 403);
assert.equal((await as('rory').get(`${N}/${id}`)).status, 200);
ok('teammates can read but not edit someone else\'s notes; read-only members can\'t write');

// Another organization
assert.equal((await as('bea').get(`${N}/${id}`)).status, 404);
assert.equal((await as('bea').put(`${N}/${id}`, { meetingKey: 'room_abc', body: 'x' })).status, 200); // a separate note in Bea's org
assert.equal((await store.get(`organizations/${orgA}/meeting_notes/${id}`)).body.includes('March'), true);
assert.equal((await as('bea').post(`${N}/mnote_none/complete`)).status, 404);
assert.equal((await as('bea').get(N)).body.notes.every((n: any) => n.authorId === 'bea'), true);
assert.equal((await as('bea').put(`${N}/mnote_bea2`, { meetingKey: 'room_abc', body: 'x', leadId: 'lead_1' })).body.code, 'lead_not_found');
ok('another organization can\'t read, change, list or link to these notes or leads');

// Save to CRM
r = await as('olivia').post(`${N}/${id}/complete`);
assert.equal(r.status, 200); assert.equal(r.body.note.status, 'final'); assert.ok(r.body.note.completedAt);
const acts = await store.list(`organizations/${orgA}/activities`);
assert.ok(acts.some((a: any) => a.type === 'meeting_notes' && a.targetId === 'lead_1' && /Kickoff with Acme/.test(a.title)));
const leadActs = await store.list(`organizations/${orgA}/leads/lead_1/activities`);
assert.ok(leadActs.some((a: any) => a.type === 'meeting_notes' && /March/.test(a.description)));
assert.equal((await as('olivia').post(`${N}/${id}/complete`)).status, 200);
assert.equal((await store.list(`organizations/${orgA}/activities`)).filter((a: any) => a.type === 'meeting_notes').length, 1);
ok('Save to CRM makes the notes final and logs them once on the feed and on the lead');

r = await as('olivia').put(`${N}/${id}`, { meetingKey: 'room_abc', body: 'changed' });
assert.equal(r.status, 409); assert.equal(r.body.code, 'notes_final');
ok('saved notes are read-only');

const list = (await as('sam').get(`${N}?leadId=lead_1`)).body.notes;
assert.equal(list.length, 1); assert.equal(list[0].id, id);
assert.equal((await as('sam').get(`${N}?meetingKey=room_abc`)).body.notes.length, 1);
ok('notes can be listed by lead or meeting');

// Delete
const d2 = (await as('sam').post(N, { meetingKey: 'room_abc' })).body.id;
await as('sam').put(`${N}/${d2}`, { meetingKey: 'room_abc', body: 'scratch' });
assert.equal((await as('rory').del(`${N}/${d2}`)).status, 403);
assert.equal((await as('sam').del(`${N}/${d2}`)).status, 200);
assert.equal((await as('sam').del(`${N}/${id}`)).status, 403); // final, and Sam can't manage records
assert.equal((await as('olivia').del(`${N}/${id}`)).status, 200); // owner can
ok('drafts are deleted by their author; saved notes only by someone who manages records');

console.log(`\n${passed} passed (meeting notes)`);
process.exit(0);
