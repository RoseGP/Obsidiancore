/**
 * Inbox (live chat + team messaging): organization isolation, signed-in authorship, visitor checks,
 * honest "not available"/"not configured" answers, and data that survives a restart.
 * Run: npx tsx src/routes/__tests__/messaging.test.ts
 */
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';

let passed = 0; const ok = (n: string) => { passed++; console.log('  ✓', n); };
Object.assign(process.env, { NODE_ENV: 'test', SOCIAL_ACCOUNTS_DEV_AUTH: 'true', CRM_STORE: 'memory' });
delete process.env.GEMINI_API_KEY; delete process.env.ANTHROPIC_API_KEY;

const { MemoryDocStore, setDocStore } = await import('../../server/data/docStore');
const store = new MemoryDocStore(); setDocStore(store);
const { guard, PUBLIC } = await import('../../server/routeGuards');
const mod = await import('../messagingPlatform');
const { flushInbox, resetInboxCacheForTests } = mod;
const app = express(); app.use(express.json());
app.use('/api/messaging', guard(PUBLIC.messaging), mod.default);
const as = (uid: string) => ({
  get: (p: string) => request(app).get(p).set('X-Dev-User-Id', uid),
  post: (p: string, b: any = {}) => request(app).post(p).set('X-Dev-User-Id', uid).send(b),
  patch: (p: string, b: any = {}) => request(app).patch(p).set('X-Dev-User-Id', uid).send(b),
  del: (p: string) => request(app).delete(p).set('X-Dev-User-Id', uid),
});
const anon = request(app);
const M = '/api/messaging';
const settle = async (uid: string) => {
  const orgId = (await store.get(`crm_user_memberships/${uid}`))?.defaultOrgId;
  if (orgId) await flushInbox(orgId);
};

// ---- Sign-in and isolation ----
assert.equal((await anon.get(`${M}/conversations`)).status, 401);
assert.equal((await anon.post(`${M}/conversations`).send({ title: 'x' })).status, 401);
ok('team routes require sign-in');

let r = await as('olivia').post(`${M}/conversations`, { title: 'Deal room', type: 'group' });
assert.equal(r.status, 201); const conv = r.body.conversation;
assert.ok(!JSON.stringify(conv).includes('user_agent_1'));
r = await as('olivia').post(`${M}/conversations/${conv.id}/messages`, { content: 'Hello', senderId: 'someone_else', senderName: 'Alex Rivera' });
assert.equal(r.status, 201); assert.equal(r.body.message.senderId, 'olivia'); assert.notEqual(r.body.message.senderName, 'Alex Rivera');
const msgId = r.body.message.id;
ok('messages are authored by the signed-in user, whatever the body claims');

assert.equal((await as('bea').get(`${M}/conversations`)).body.conversations.length, 0);
assert.equal((await as('bea').get(`${M}/conversations/${conv.id}`)).status, 404);
assert.equal((await as('bea').get(`${M}/conversations/${conv.id}/messages`)).status, 404);
assert.equal((await as('bea').post(`${M}/conversations/${conv.id}/messages`, { content: 'hi' })).status, 404);
assert.equal((await as('bea').del(`${M}/conversations/${conv.id}`)).status, 404);
assert.equal((await as('bea').get(`${M}/search?q=Hello`)).body.results?.messages?.length ?? 0, 0);
ok('another organization can\'t list, read, post to or delete the conversation');

// A second member of the same organization can't edit or delete Olivia's message; an admin (owner) can.
const orgA = (await store.get('crm_user_memberships/olivia')).defaultOrgId;
await store.set(`organizations/${orgA}/members/sam`, { userId: 'sam', role: 'SALES_REP', email: '', name: 'Sam', joinedAt: new Date().toISOString() });
await store.set('crm_user_memberships/sam', { userId: 'sam', orgs: { [orgA]: 'SALES_REP' }, defaultOrgId: orgA });
assert.equal((await as('sam').patch(`${M}/conversations/${conv.id}/messages/${msgId}`, { content: 'edited', userId: 'olivia' })).status, 403);
assert.equal((await as('sam').del(`${M}/conversations/${conv.id}/messages/${msgId}`)).status, 403);
assert.equal((await as('olivia').patch(`${M}/conversations/${conv.id}/messages/${msgId}`, { content: 'Hello again' })).status, 200);
ok('only the author or an admin can edit or delete a message');

r = await as('olivia').post(`${M}/conversations/${conv.id}/tasks`, { title: 'Send contract' });
assert.equal(r.status, 201); assert.ok(!JSON.stringify(r.body).includes('Alex Rivera'));
ok('tasks and notes are attributed to the signed-in user');

// ---- Honest answers ----
assert.equal((await as('olivia').post(`${M}/upload`, {})).status, 501);
r = await as('olivia').post(`${M}/conversations/${conv.id}/execute-ai`, { prompt: 'Summarize' });
assert.equal(r.status, 503); assert.equal(r.body.code, 'ai_not_configured');
assert.equal((await as('olivia').get(`${M}/test-suite`)).status, 404);
const prompts = (await as('olivia').get(`${M}/prompts`)).body.prompts;
assert.ok(!/SOC 2|ISO 27001|Alex Rivera|NovaCrest|AlphaTech/.test(JSON.stringify(prompts)));
ok('uploads say not available, AI says not configured, no test endpoint, no invented claims in templates');

// ---- Widget + visitor ----
assert.equal((await as('olivia').post(`${M}/widgets`, { widgetKey: '../bad key' })).status, 400);
r = await as('olivia').post(`${M}/widgets`, { widgetKey: 'acme_chat', businessName: 'Acme' });
assert.equal(r.status, 201);
assert.equal((await as('bea').post(`${M}/widgets`, { widgetKey: 'acme_chat', businessName: 'Evil' })).status, 409);
assert.equal((await as('bea').get(`${M}/widgets`)).body.widgets.length, 0);
ok('a widget key belongs to one organization');

assert.equal((await anon.post(`${M}/visitor-init`).send({ widgetKey: 'nope' })).status, 404);
r = await anon.post(`${M}/visitor-init`).send({ widgetKey: 'acme_chat', visitorName: 'Vic' });
assert.equal(r.status, 200);
const vconv = r.body.conversationId; const vid = r.body.visitorId;
assert.match(vid, /^vis_[A-Za-z0-9_-]{20,}$/);
assert.equal((await anon.post(`${M}/visitor-message`).send({ conversationId: vconv, visitorId: 'vis_guess', content: 'hi' })).status, 404);
assert.equal((await anon.get(`${M}/visitor-messages/${vconv}?visitorId=vis_guess`)).status, 404);
assert.equal((await anon.post(`${M}/visitor-message`).send({ conversationId: vconv, visitorId: vid, content: 'x'.repeat(4001) })).status, 400);
assert.equal((await anon.post(`${M}/visitor-message`).send({ conversationId: vconv, visitorId: vid, content: 'Need help' })).status, 201);
await as('olivia').post(`${M}/conversations/${vconv}/messages`, { content: 'internal only', isInternalNote: true });
assert.equal(JSON.stringify((await anon.get(`${M}/visitor-messages/${vconv}?visitorId=${vid}`)).body).includes('internal only'), false);
assert.equal(JSON.stringify((await anon.post(`${M}/visitor-init`).send({ widgetKey: 'acme_chat', visitorId: vid })).body).includes('internal only'), false);
assert.equal((await as('bea').get(`${M}/conversations/${vconv}`)).status, 404);
assert.ok((await as('olivia').get(`${M}/conversations`)).body.conversations.some((c: any) => c.id === vconv));
ok('visitors need their own id to read or post, never see internal notes; chats land only in the widget owner\'s inbox');

// ---- Survives a restart ----
await settle('olivia'); await settle('bea');
assert.ok(JSON.stringify([...store.data.keys()]).includes(`organizations/${orgA}/inbox_conversations/${conv.id}`));
resetInboxCacheForTests();
r = await as('olivia').get(`${M}/conversations/${conv.id}/messages`);
assert.equal(r.status, 200); assert.equal(r.body.messages.some((m: any) => m.content === 'Hello again'), true);
assert.equal((await as('olivia').get(`${M}/conversations/${conv.id}/tasks`)).body.tasks[0].title, 'Send contract');
resetInboxCacheForTests();
r = await anon.get(`${M}/visitor-messages/${vconv}?visitorId=${vid}`);
assert.equal(r.status, 200); assert.equal(r.body.messages.some((m: any) => m.content === 'Need help'), true);
assert.equal((await as('bea').get(`${M}/conversations/${conv.id}`)).status, 404);
ok('conversations, messages, tasks and visitor chats survive a restart, still isolated');

// ---- Linking a conversation to a CRM record uses the organization's real leads/deals ----
{
  const orgO = (await store.get('crm_user_memberships/olivia')).defaultOrgId;
  const orgB = (await store.get('crm_user_memberships/bea')).defaultOrgId;
  await store.set(`organizations/${orgO}/leads/lead_link_1`, { id: 'lead_link_1', name: 'Avery Lee', email: 'avery@example.com', company: 'Northwind', status: 'new' });
  await store.set(`organizations/${orgO}/deals/deal_link_1`, { id: 'deal_link_1', name: 'Website redesign', client: 'Northwind', value: 4200, stage: 'proposal' });
  await store.set(`organizations/${orgB}/leads/lead_other_org`, { id: 'lead_other_org', name: 'Someone Else', status: 'new' });
  const recs = (await as('olivia').get(`${M}/crm-records`)).body.records;
  assert.ok(recs.some((x: any) => x.id === 'lead_link_1') && recs.some((x: any) => x.id === 'deal_link_1'));
  r = await as('olivia').post(`${M}/conversations/${conv.id}/link-crm`, { recordId: 'lead_link_1' });
  assert.equal(r.status, 200); assert.equal(r.body.conversation.crmRecord.id, 'lead_link_1'); assert.equal(r.body.conversation.crmRecord.title, 'Avery Lee');
  r = await as('olivia').post(`${M}/conversations/${conv.id}/link-crm`, { recordId: 'deal_link_1', type: 'deal' });
  assert.equal(r.status, 200); assert.equal(r.body.conversation.crmRecord.type, 'deal'); assert.equal(r.body.conversation.crmRecord.companyName, 'Northwind');
  assert.equal((await as('olivia').post(`${M}/conversations/${conv.id}/link-crm`, { recordId: 'lead_other_org' })).status, 404);
  assert.equal((await as('olivia').post(`${M}/conversations/${conv.id}/link-crm`, { recordId: '../../x' })).status, 404);
  assert.equal((await as('bea').post(`${M}/conversations/${conv.id}/link-crm`, { recordId: 'lead_other_org' })).status, 404);
  r = await as('olivia').post(`${M}/conversations/${conv.id}/link-crm`, { recordId: null });
  assert.equal(r.status, 200); assert.equal(r.body.conversation.crmRecord, undefined);
  ok('link-crm links to this organization\'s leads/deals; other organizations\' records and conversations are 404');
}

await as('olivia').del(`${M}/conversations/${conv.id}`); await settle('olivia');
assert.equal([...store.data.keys()].some((k) => k.includes(`inbox_conversations/${conv.id}`)), false);
ok('deleting a conversation deletes its stored messages');

console.log(`\n${passed} passed (messaging)`);
process.exit(0);
