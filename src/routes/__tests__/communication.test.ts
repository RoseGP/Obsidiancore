/**
 * Voice / communication routes: no simulated replies, sends or tokens; receptionist knowledge and inbound
 * messages are stored per organization; numbers are routed to exactly one organization.
 * Run: npx tsx src/routes/__tests__/communication.test.ts
 */
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';

let passed = 0; const ok = (n: string) => { passed++; console.log('  ✓', n); };
Object.assign(process.env, {
  NODE_ENV: 'test', SOCIAL_ACCOUNTS_DEV_AUTH: 'true', CRM_STORE: 'memory',
  IVR_SKIP_SIGNATURE: 'true', ALLOW_UNSIGNED_WEBHOOKS: 'true',
});
for (const k of ['GEMINI_API_KEY', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER', 'TWILIO_API_KEY', 'TWILIO_API_SECRET',
  'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_ACCESS_TOKEN', 'META_APP_SECRET']) delete process.env[k];

const { MemoryDocStore, setDocStore } = await import('../../server/data/docStore');
const store = new MemoryDocStore(); setDocStore(store);
const { guard, PUBLIC } = await import('../../server/routeGuards');
const comm = (await import('../communication')).default;
const app = express(); app.use(express.json()); app.use(express.urlencoded({ extended: true }));
app.use('/api/communication', guard(PUBLIC.communication), comm);
const C = '/api/communication';
const as = (uid: string) => ({
  get: (p: string) => request(app).get(C + p).set('X-Dev-User-Id', uid),
  post: (p: string, b: any = {}) => request(app).post(C + p).set('X-Dev-User-Id', uid).send(b),
  del: (p: string) => request(app).delete(C + p).set('X-Dev-User-Id', uid),
});
const anon = request(app);

// ---- Sign-in ----
for (const [m, p] of [['get', '/receptionist/knowledge'], ['post', '/send'], ['get', '/inbound-routes'], ['get', '/inbound-messages'], ['post', '/voice-dialer/turn']] as const) {
  assert.equal((await (anon as any)[m](C + p).send({})).status, 401, p);
}
ok('staff routes require sign-in');

// ---- Knowledge: empty, per organization ----
let r = await as('olivia').get('/receptionist/knowledge');
assert.equal(r.status, 200);
assert.equal(r.body.store.qas.length, 0); assert.equal(r.body.store.profile.companyName, ''); assert.equal(r.body.store.profile.agentName, '');
assert.equal('readinessScore' in r.body.trainingMetrics, false);
assert.ok(!/Sophia|Howard Street|555-0199|Obsidian Core/.test(JSON.stringify(r.body)));
ok('a new organization starts with an empty knowledge base (no invented company, agent or score)');

r = await as('olivia').post('/receptionist/knowledge', { action: 'add_qa', qa: { question: 'When are you open?', answer: 'Mon-Fri 9-5.', category: 'general', keywords: ['hours'] } });
assert.equal(r.status, 200); const qaId = r.body.qa.id;
assert.equal((await as('olivia').post('/receptionist/knowledge', { action: 'add_qa', qa: { question: '', answer: 'x' } })).status, 400);
await as('olivia').post('/receptionist/knowledge', { action: 'update_profile', profile: { companyName: 'Acme Plumbing', agentName: 'Riley' } });
r = await as('olivia').get('/receptionist/knowledge');
assert.equal(r.body.store.qas.length, 1); assert.equal(r.body.store.profile.companyName, 'Acme Plumbing');
assert.equal((await as('bea').get('/receptionist/knowledge')).body.store.qas.length, 0);
assert.equal((await as('bea').del(`/receptionist/knowledge/qa/${qaId}`)).status, 404);
assert.equal((await as('bea').post('/receptionist/knowledge', { action: 'update_qa', qaId, updates: { answer: 'hacked' } })).status, 404);
assert.equal((await as('olivia').get('/receptionist/knowledge')).body.store.qas[0].answer, 'Mon-Fri 9-5.');
ok('Q&A and profile are saved for one organization; another can\'t read, edit or delete them');

const orgA = (await store.get('crm_user_memberships/olivia')).defaultOrgId;
await store.set(`organizations/${orgA}/members/rory`, { userId: 'rory', role: 'READ_ONLY', email: '', name: 'rory', joinedAt: new Date().toISOString() });
await store.set('crm_user_memberships/rory', { userId: 'rory', orgs: { [orgA]: 'READ_ONLY' }, defaultOrgId: orgA });
assert.equal((await as('rory').get('/receptionist/knowledge')).body.store.qas.length, 1);
assert.equal((await as('rory').post('/receptionist/knowledge', { action: 'add_qa', qa: { question: 'q', answer: 'a' } })).status, 403);
assert.equal((await as('rory').post('/inbound-routes', { kind: 'phone', number: '+15550001111' })).status, 403);
ok('read-only members can read but not change knowledge or numbers');

// ---- No AI key: say so, never a scripted answer ----
for (const [p, b] of [
  ['/receptionist/chat-query', { message: 'When are you open?' }],
  ['/voice-dialer/turn', { userMessage: 'I want a proposal' }],
  ['/voice-dialer/summary', { transcripts: [{ sender: 'lead', text: 'hi' }] }],
  ['/receptionist/ai-train', { rawText: 'We are open Monday to Friday from nine to five every week.' }],
  ['/intake-bot', { userMessage: 'Our CRM is slow' }],
  ['/replyzen-assistant', { prompt: 'summarize' }],
  ['/dashboard-assistant', { prompt: 'how are my deals?' }],
] as const) {
  r = await as('olivia').post(p, b);
  assert.equal(r.status, 503, p); assert.equal(r.body.code, 'ai_not_configured', p);
  assert.ok(!/78,?000|Alex|Evelyn|Sophia|Hannah|heuristic/.test(JSON.stringify(r.body)), p);
}
assert.equal((await as('olivia').post('/voice-dialer/summary', { transcripts: [] })).status, 400);
assert.equal((await as('olivia').get('/receptionist/knowledge')).body.store.qas.length, 1);
ok('without an AI key every assistant answers 503 ai_not_configured; nothing is invented or added');

// ---- Sending: no simulated success ----
r = await as('olivia').post('/send', { to: '+15550002222', channel: 'sms', body: 'Hi' });
assert.equal(r.status, 503); assert.equal(r.body.code, 'sms_not_configured');
r = await as('olivia').post('/send', { to: '+15550002222', channel: 'whatsapp', body: 'Hi' });
assert.equal(r.status, 503); assert.equal(r.body.code, 'whatsapp_not_configured');
assert.equal((await as('olivia').post('/send', { to: 'not a number', channel: 'sms', body: 'Hi' })).status, 400);
assert.equal((await as('rory').post('/send', { to: '+15550002222', channel: 'sms', body: 'Hi' })).status, 403);
assert.equal((await store.list(`organizations/${orgA}/outbound_messages`)).length, 0);
ok('SMS/WhatsApp without credentials say "not configured" and nothing is logged as sent');

// ---- Inbound routing ----
r = await as('olivia').post('/inbound-routes', { kind: 'phone', number: '+1 (555) 000-1111' });
assert.equal(r.status, 201); const routeId = r.body.route.id;
assert.equal((await as('bea').post('/inbound-routes', { kind: 'phone', number: '+15550001111' })).status, 409);
assert.equal((await as('bea').del(`/inbound-routes/${routeId}`)).status, 404);
assert.equal((await as('bea').get('/inbound-routes')).body.routes.length, 0);
await as('olivia').post('/inbound-routes', { kind: 'whatsapp', number: '1098765432' });
ok('a number belongs to one organization; others can\'t take, see or remove it');

r = await anon.post(`${C}/twilio-sms`).type('form').send({ From: '+15557770000', To: '+15550001111', Body: 'Is my order ready?', MessageSid: 'SM1' });
assert.equal(r.status, 200);
await anon.post(`${C}/twilio-sms`).type('form').send({ From: '+15557770000', To: '+15559999999', Body: 'to nobody', MessageSid: 'SM2' });
await anon.post(`${C}/whatsapp-webhook`).send({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: {
  metadata: { phone_number_id: '1098765432' }, contacts: [{ profile: { name: 'Vic' } }],
  messages: [{ id: 'wamid.1', from: '15557770000', type: 'text', text: { body: 'Hello on WhatsApp' }, timestamp: '1700000000' }],
} }] }] });
await anon.post(`${C}/twiml-voicemail-saved`).type('form').send({ From: '+15557770000', To: '+15550001111', RecordingUrl: 'https://api.twilio.com/rec/RE1', RecordingDuration: '12' });
r = await as('olivia').get('/inbound-messages');
assert.equal(r.body.messages.length, 2); assert.equal(r.body.voicemails.length, 1);
assert.ok(r.body.messages.some((m: any) => m.channel === 'SMS' && m.body === 'Is my order ready?'));
assert.ok(r.body.messages.some((m: any) => m.channel === 'WHATSAPP' && m.contactName === 'Vic'));
assert.ok(!JSON.stringify(r.body).includes('to nobody'));
const b = await as('bea').get('/inbound-messages');
assert.equal(b.body.messages.length, 0); assert.equal(b.body.voicemails.length, 0);
ok('inbound SMS, WhatsApp and voicemail land only in the number owner\'s organization; unrouted ones are dropped');

r = await anon.post(`${C}/incoming-call`).type('form').send({ From: '+15557770000', To: '+15550001111' });
assert.equal(r.status, 200); assert.ok(!/Obsidian/.test(r.text));
assert.equal((await as('olivia').post('/twilio-video-token', { roomName: 'board' })).body.code, 'video_not_configured');
assert.equal((await as('olivia').post('/trigger-outbound', {})).status, 501);
ok('call prompts are neutral; video token and outbound calling report what isn\'t set up');

// ---- Message slips ----
r = await as('olivia').post('/message-slips', { callerName: 'Pat', notes: 'Call me back', callbackNumber: '+15557770000', urgency: 'high' });
assert.equal(r.status, 201); const slipId = r.body.slip.id;
assert.equal((await as('olivia').post('/message-slips', { callerName: '', notes: 'x' })).status, 400);
assert.equal((await as('bea').get('/message-slips')).body.slips.length, 0);
assert.equal((await request(app).patch(`${C}/message-slips/${slipId}`).set('X-Dev-User-Id', 'bea').send({ status: 'resolved' })).status, 404);
assert.equal((await request(app).patch(`${C}/message-slips/${slipId}`).set('X-Dev-User-Id', 'olivia').send({ status: 'resolved' })).status, 200);
assert.equal((await as('olivia').get('/message-slips')).body.slips[0].status, 'resolved');
assert.equal((await as('rory').post('/message-slips', { callerName: 'x', notes: 'y' })).status, 403);
ok('message slips are stored per organization; others can\'t see or change them');

await as('olivia').post('/receptionist/knowledge', { action: 'reset' });
assert.equal((await as('olivia').get('/receptionist/knowledge')).body.store.qas.length, 0);
ok('reset clears the organization\'s knowledge (it doesn\'t restore invented defaults)');

console.log(`\n${passed} passed (communication)`);
process.exit(0);
