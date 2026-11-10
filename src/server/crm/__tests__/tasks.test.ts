/**
 * One task list: /api/tasks CRUD + views, links checked in the organization, old lead tasks and inbox tasks
 * shown (read-through) and kept in step (write-through), the migration script, tenant isolation and roles.
 * Run: npx tsx src/server/crm/__tests__/tasks.test.ts
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
const tasksRouter = (await import('../../../routes/tasksApi')).default;
const leadsRouter = (await import('../../../routes/leadsApi')).default;
const inbox = await import('../../../routes/messagingPlatform');
const { migrateTasks } = await import('../backfill');
const { inboxTaskId } = await import('../tasks');

const app = express(); app.use(express.json());
app.use('/api/tasks', guard(PUBLIC.none), tasksRouter);
app.use('/api/leads', guard(PUBLIC.leads), leadsRouter);
app.use('/api/messaging', guard(PUBLIC.messaging), inbox.default);
const as = (uid: string) => ({
  get: (p: string) => request(app).get(p).set('X-Dev-User-Id', uid),
  post: (p: string, b: any = {}) => request(app).post(p).set('X-Dev-User-Id', uid).send(b),
  patch: (p: string, b: any = {}) => request(app).patch(p).set('X-Dev-User-Id', uid).send(b),
  del: (p: string) => request(app).delete(p).set('X-Dev-User-Id', uid),
});
const T = '/api/tasks';
const DAY = 86_400_000;
const iso = (ms: number) => new Date(Date.now() + ms).toISOString();

assert.equal((await request(app).get(T)).status, 401);
assert.equal((await request(app).post(T).send({ title: 'x' })).status, 401);
ok('signed-out callers are refused');

// ---- CRUD + views ----
let r = await as('olivia').post(T, { title: '' });
assert.equal(r.status, 400);
assert.equal((await as('olivia').post(T, { title: 'x', dueDate: 'not a date' })).status, 400);
assert.equal((await as('olivia').post(T, { title: 'x', leadId: 'lead_missing' })).status, 400);
assert.equal((await as('olivia').post(T, { title: 'x', leadId: '../etc' })).status, 400);
r = await as('olivia').post(T, { title: 'Send pricing', type: 'email', priority: 'medium', dueDate: iso(-DAY) });
assert.equal(r.status, 201); const overdue = r.body.task;
assert.equal(overdue.priority, 'normal'); assert.equal(overdue.assigneeId, 'olivia'); assert.equal(overdue.status, 'open'); assert.equal(overdue.completed, false);
const later = (await as('olivia').post(T, { title: 'Quarterly review', dueDate: iso(10 * DAY), type: 'meeting' })).body.task;
const soon = (await as('olivia').post(T, { title: 'Call back', type: 'call', dueDate: iso(30 * 60_000) })).body.task;
const teammate = (await as('olivia').post(T, { title: 'For the team', assigneeId: 'sam', assignedTo: 'Sam' })).body.task;
ok('create: validation, defaults (assigned to me, open), priority vocabulary normalized');

r = await as('olivia').get(`${T}?view=mine`);
assert.deepEqual(r.body.tasks.map((t: any) => t.id), [overdue.id, soon.id, later.id], 'dated tasks first, earliest due first');
r = await as('olivia').get(`${T}?view=team`); assert.equal(r.body.count, 4);
r = await as('olivia').get(`${T}?view=overdue`); assert.deepEqual(r.body.tasks.map((t: any) => t.id), [overdue.id]);
r = await as('olivia').get(`${T}?view=due_soon`); assert.deepEqual(r.body.tasks.map((t: any) => t.id).sort(), [overdue.id, soon.id].sort());
r = await as('olivia').get(`${T}?view=upcoming`); assert.deepEqual(r.body.tasks.map((t: any) => t.id), [soon.id, later.id]);
r = await as('olivia').get(`${T}?view=team&q=quarterly`); assert.equal(r.body.count, 1);
ok('views: mine, team, overdue, due soon (reminders), upcoming, search');

r = await as('olivia').post(`${T}/${overdue.id}/complete`);
assert.equal(r.body.task.status, 'done'); assert.ok(r.body.task.completedAt);
assert.equal((await as('olivia').get(`${T}?view=overdue`)).body.count, 0);
assert.equal((await as('olivia').get(`${T}?view=done`)).body.count, 1);
r = await as('olivia').patch(`${T}/${overdue.id}`, { completed: false, title: 'Send pricing v2' });
assert.equal(r.body.task.status, 'open'); assert.equal(r.body.task.completedAt, null); assert.equal(r.body.task.title, 'Send pricing v2');
assert.equal((await as('olivia').patch(`${T}/${overdue.id}`, { status: 'weird' })).status, 400);
assert.equal((await as('olivia').del(`${T}/${teammate.id}`)).status, 200);
assert.equal((await as('olivia').get(`${T}?view=team`)).body.count, 3);
assert.ok((await store.list(`organizations/${(await store.get('crm_user_memberships/olivia')).defaultOrgId}/tasks`)).find((t: any) => t.id === teammate.id).deletedAt, 'deleted tasks are kept for history');
assert.equal((await as('olivia').get(`${T}/${teammate.id}`)).status, 404);
ok('complete / reopen / edit / delete (kept for history)');

// ---- Lead tasks: old endpoints write through, old data reads through ----
const lead = (await as('olivia').post('/api/leads', { name: 'Lia Lead', email: 'lia@x.test' })).body.lead;
r = await as('olivia').post(`/api/leads/${lead.id}/tasks`, { title: 'Intro call', priority: 'high' });
assert.equal(r.status, 201); const lt = r.body.task;
const orgA = (await store.get('crm_user_memberships/olivia')).defaultOrgId;
assert.ok(await store.get(`organizations/${orgA}/tasks/${lt.id}`), 'lead task is in the unified list');
assert.ok(await store.get(`organizations/${orgA}/leads/${lead.id}/tasks/${lt.id}`), 'and mirrored on the lead (same id) for older readers');
r = await as('olivia').get(`${T}?leadId=${lead.id}`); assert.equal(r.body.count, 1);
r = await as('olivia').patch(`/api/leads/${lead.id}/tasks/${lt.id}/toggle`);
assert.equal(r.body.completed, true);
assert.equal((await store.get(`organizations/${orgA}/tasks/${lt.id}`)).status, 'done');
assert.equal((await store.get(`organizations/${orgA}/leads/${lead.id}/tasks/${lt.id}`)).completed, true);
// A task created on the unified list with a lead shows in the lead drawer (GET /api/leads/:id).
await as('olivia').post(T, { title: 'Send proposal', leadId: lead.id, dueDate: iso(DAY) });
r = await as('olivia').get(`/api/leads/${lead.id}`);
assert.equal(r.body.tasks.length, 2); assert.ok(r.body.tasks.some((t: any) => t.title === 'Send proposal'));
assert.ok(r.body.activities.some((a: any) => /Task added: Send proposal/.test(a.title)), 'the lead timeline records it');
ok('lead tasks: the lead endpoints write to the unified list and the lead mirror stays in step');

// Old-only data (created before the unified list existed).
await store.set(`organizations/${orgA}/leads/${lead.id}/tasks/task_old1`, { id: 'task_old1', title: 'Old follow-up', dueDate: iso(-2 * DAY), completed: false, priority: 'urgent', assignedTo: 'olivia', createdAt: iso(-5 * DAY) });
r = await as('olivia').get(`${T}?view=team&leadId=${lead.id}`);
const old = r.body.tasks.find((t: any) => t.id === 'task_old1');
assert.ok(old && old.readThrough && old.priority === 'urgent' && old.legacy.kind === 'lead');
assert.ok((await as('olivia').get(`${T}?view=overdue`)).body.tasks.some((t: any) => t.id === 'task_old1'));
r = await as('olivia').patch(`/api/leads/${lead.id}/tasks/task_old1`, { completed: true });
assert.equal(r.status, 200);
const adopted = await store.get(`organizations/${orgA}/tasks/task_old1`);
assert.ok(adopted && adopted.status === 'done', 'changing an old task copies it into the unified list');
assert.equal((await store.get(`organizations/${orgA}/leads/${lead.id}/tasks/task_old1`)).completed, true);
assert.equal((await as('bea').patch(`/api/leads/${lead.id}/tasks/task_old1`, { completed: false })).status, 404);
ok('old lead tasks show up (read-through) and are copied over the first time they change');

// ---- Inbox tasks ----
let c = await as('olivia').post('/api/messaging/conversations', { title: 'Support thread', type: 'support', crmRecord: { type: 'lead', id: lead.id, title: 'Lia Lead' } });
const conv = c.body.conversation;
r = await as('olivia').post(`/api/messaging/conversations/${conv.id}/tasks`, { title: 'Reply with invoice', priority: 'medium' });
assert.equal(r.status, 201); const it = r.body.task;
const uid = inboxTaskId(conv.id, it.id); assert.equal(it.unifiedTaskId, uid);
const u = await store.get(`organizations/${orgA}/tasks/${uid}`);
assert.ok(u); assert.equal(u.conversationId, conv.id); assert.equal(u.leadId, lead.id, 'linked to the conversation’s lead'); assert.equal(u.priority, 'normal');
r = await as('olivia').patch(`/api/messaging/conversations/${conv.id}/tasks/${it.id}`, { status: 'completed' });
assert.equal((await store.get(`organizations/${orgA}/tasks/${uid}`)).status, 'done');
// Changes made on the task list show in the conversation's Tasks tab.
await as('olivia').patch(`${T}/${uid}`, { title: 'Reply with invoice #42', completed: false });
r = await as('olivia').get(`/api/messaging/conversations/${conv.id}/tasks`);
assert.equal(r.body.tasks[0].title, 'Reply with invoice #42'); assert.equal(r.body.tasks[0].status, 'pending');
await as('olivia').del(`${T}/${uid}`);
assert.equal((await as('olivia').get(`/api/messaging/conversations/${conv.id}/tasks`)).body.tasks.length, 0);
ok('inbox tasks: created on the task list, linked to the conversation and its lead, kept in step both ways');

// Inbox tasks from before: read-through, then migrated.
c = await as('olivia').post('/api/messaging/conversations', { title: 'Older thread', type: 'support' });
const conv2 = c.body.conversation;
await inbox.flushInbox(orgA);
await store.set(`organizations/${orgA}/inbox_conversations/${conv2.id}/meta/crm`, { tasks: [{ id: 'task_1700', title: 'Legacy inbox task', status: 'pending', priority: 'high', dueDate: '2026-01-02', assignee: 'Olivia', createdAt: '2026-01-01T00:00:00.000Z' }], activities: [] });
inbox.resetInboxCacheForTests();
r = await as('olivia').get(`${T}?view=team&conversationId=${conv2.id}`);
assert.equal(r.body.count, 1); assert.equal(r.body.tasks[0].legacy.kind, 'inbox'); assert.equal(r.body.tasks[0].id, inboxTaskId(conv2.id, 'task_1700'));
ok('older inbox tasks show up on the task list');

// ---- Migration: dry run, apply, idempotent ----
await store.set(`organizations/${orgA}/leads/${lead.id}/tasks/task_old2`, { id: 'task_old2', title: 'Another old one', completed: false, priority: 'low', createdAt: iso(-9 * DAY) });
let m = await migrateTasks(orgA, { apply: false });
assert.deepEqual([m.found, m.lead, m.inbox, m.applied], [2, 1, 1, false], JSON.stringify(m));
const before = (await store.list(`organizations/${orgA}/tasks`)).length;
assert.equal((await migrateTasks(orgA, { apply: false })).found, m.found, 'dry run writes nothing');
m = await migrateTasks(orgA, { apply: true });
const after = (await store.list(`organizations/${orgA}/tasks`)).length;
assert.equal(after, before + m.found);
const migratedInbox = await store.get(`organizations/${orgA}/tasks/${inboxTaskId(conv2.id, 'task_1700')}`);
assert.ok(migratedInbox?.migratedAt); assert.equal(migratedInbox.legacy.taskId, 'task_1700');
assert.equal((await store.get(`organizations/${orgA}/leads/${lead.id}/tasks/task_old2`)).unifiedTaskId, 'task_old2', 'lead copy gets a back-reference');
assert.equal((await store.get(`organizations/${orgA}/tasks/task_old2`)).leadId, lead.id);
assert.ok(await store.get(`organizations/${orgA}/inbox_conversations/${conv2.id}/meta/crm`), 'originals stay');
m = await migrateTasks(orgA, { apply: true });
assert.equal(m.found, 0); assert.equal((await store.list(`organizations/${orgA}/tasks`)).length, after);
assert.equal((await as('olivia').get(`${T}?view=team&conversationId=${conv2.id}`)).body.count, 1, 'no duplicates after migration');
ok('migration: dry run, copies with back-references, keeps originals, second run finds nothing');

// ---- Isolation and roles ----
assert.equal((await as('bea').get(`${T}?view=team`)).body.count, 0);
assert.equal((await as('bea').get(`${T}/${later.id}`)).status, 404);
assert.equal((await as('bea').patch(`${T}/${later.id}`, { title: 'pwned' })).status, 404);
assert.equal((await as('bea').del(`${T}/${later.id}`)).status, 404);
assert.equal((await as('bea').post(T, { title: 'x', leadId: lead.id })).status, 400, 'can’t attach to another organization’s lead');
assert.equal((await store.get(`organizations/${orgA}/tasks/${later.id}`)).title, 'Quarterly review');
const addMember = async (id: string, role: string) => {
  await store.set(`organizations/${orgA}/members/${id}`, { userId: id, role, email: `${id}@a.test`, name: id, joinedAt: new Date().toISOString() });
  await store.set(`crm_user_memberships/${id}`, { userId: id, orgs: { [orgA]: role }, defaultOrgId: orgA });
};
await addMember('rory', 'READ_ONLY');
assert.ok((await as('rory').get(`${T}?view=team`)).body.count > 0);
assert.equal((await as('rory').post(T, { title: 'nope' })).status, 403);
assert.equal((await as('rory').patch(`${T}/${later.id}`, { title: 'nope' })).status, 403);
assert.equal((await as('rory').post(`${T}/${later.id}/complete`)).status, 403);
assert.equal((await as('rory').del(`${T}/${later.id}`)).status, 403);
assert.equal((await as('rory').post(`/api/messaging/conversations/${conv.id}/tasks`, { title: 'nope' })).status, 403);
ok('another organization sees and changes nothing; read-only members can view but not change tasks');

console.log(`\n${passed} passed (tasks)`);
