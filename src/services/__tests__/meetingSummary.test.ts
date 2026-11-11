/**
 * AI meeting recap: prompt building, tolerant parsing, and POST /api/meetings/ai-summary
 * (auth, roles, validation, no-provider and bad-reply handling), against a stand-in Claude client.
 * Run: npx tsx src/services/__tests__/meetingSummary.test.ts
 */
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';

let passed = 0; const ok = (n: string) => { passed++; console.log('  ✓', n); };
Object.assign(process.env, { NODE_ENV: 'test', SOCIAL_ACCOUNTS_DEV_AUTH: 'true', CRM_STORE: 'memory', ANTHROPIC_API_KEY: 'test-key' });
delete process.env.GEMINI_API_KEY; delete process.env.ANTHROPIC_MODEL; delete process.env.OMNIROUTE_GATEWAY_URL;

const { MemoryDocStore, setDocStore } = await import('../../server/data/docStore');
const store = new MemoryDocStore(); setDocStore(store);
const svc = await import('../ai/aiService');
const ms = await import('../meetingSummary');

/** Stand-in Claude: returns the scripted text replies in order and records each request body. */
function fakeClaude(replies: string[]) {
  const calls: any[] = []; let i = 0;
  return {
    calls,
    messages: {
      stream(body: any) {
        calls.push(JSON.parse(JSON.stringify(body)));
        const text = replies[i++] ?? '';
        const handlers: Record<string, Function[]> = {};
        const s = {
          on(ev: string, fn: Function) { (handlers[ev] ??= []).push(fn); return s; },
          async finalMessage() {
            for (const fn of handlers.text ?? []) fn(text);
            return { model: body.model, content: [{ type: 'text', text }], stop_reason: 'end_turn' };
          },
        };
        return s;
      },
    },
  };
}

const GOOD = JSON.stringify({
  summary: 'Acme agreed to a 3-month pilot of the CRM.',
  keyPoints: ['Pilot scope: sales team only', 'Budget approved'],
  decisions: ['Start the pilot on Monday'],
  actionItems: [
    { title: 'Send pilot agreement', owner: 'Camelia', dueInDays: 2, priority: 'high' },
    { title: 'Schedule onboarding', owner: '', dueInDays: -4, priority: 'urgent' },
    { title: '   ' },
  ],
  followUpEmail: { subject: 'Next steps for your pilot', body: 'Thanks for your time today.' },
});

// ---------------------------------------------------------------------------
// Prompt and parsing
// ---------------------------------------------------------------------------
{
  const input = ms.meetingSummaryInputSchema.parse({
    title: 'Acme pilot', durationSeconds: 1800, participants: ['Camelia', 'Ada'],
    notes: 'Budget approved.', transcript: [{ speakerName: 'Ada', text: 'Let us start Monday.' }, { speakerName: 'Ada', text: '   ' }],
    tasks: [{ title: 'Send agreement', contactName: 'Ada' }],
  });
  const { prompt, hasContent } = ms.buildMeetingSummaryPrompt(input);
  assert.ok(hasContent);
  assert.match(prompt, /Meeting: Acme pilot/); assert.match(prompt, /Duration: 30 min/); assert.match(prompt, /Attendees: Camelia, Ada/);
  assert.match(prompt, /Ada: Let us start Monday\./); assert.match(prompt, /- Send agreement \(Ada\)/);
  assert.ok(!/Ada:\s*\n/.test(prompt)); ok('prompt includes title, duration, attendees, notes, tasks and non-empty transcript lines');

  const long = ms.meetingSummaryInputSchema.parse({
    transcript: Array.from({ length: 2000 }, (_, i) => ({ speakerName: 'S', text: `line ${i} ${'x'.repeat(50)}` })),
  });
  const clipped = ms.buildMeetingSummaryPrompt(long).prompt;
  assert.ok(clipped.length < ms.MAX_TRANSCRIPT_CHARS + 500); assert.match(clipped, /earlier part omitted/); assert.match(clipped, /line 1999 /); assert.ok(!/line 0 /.test(clipped));
  ok('long transcripts keep the most recent part (where decisions are) and say so');

  assert.equal(ms.buildMeetingSummaryPrompt(ms.meetingSummaryInputSchema.parse({ title: 'Empty' })).hasContent, false); ok('a meeting with no notes, tasks or transcript has nothing to summarize');

  const p = ms.parseMeetingSummary('Here you go:\n```json\n' + GOOD + '\n```');
  assert.equal(p.summary, 'Acme agreed to a 3-month pilot of the CRM.');
  assert.equal(p.actionItems.length, 2); ok('parser accepts fenced JSON with surrounding prose; drops empty action items');
  assert.deepEqual(p.actionItems[1], { title: 'Schedule onboarding', owner: 'Unassigned', dueInDays: null, priority: 'medium' });
  ok('parser normalizes owner, invalid due dates and unknown priorities');
  assert.throws(() => ms.parseMeetingSummary('no json here'), /did not contain/);
  assert.throws(() => ms.parseMeetingSummary('{"keyPoints": []}'), /no summary/);
  assert.throws(() => ms.parseMeetingSummary('{"summary": "x",}'), /not valid JSON/); ok('parser rejects replies without a usable summary');
}

// ---------------------------------------------------------------------------
// Service: provider call has no CRM tools
// ---------------------------------------------------------------------------
{
  const c = fakeClaude([GOOD]); svc.setAnthropicClientForTests(c);
  const r = await ms.generateMeetingSummary(ms.meetingSummaryInputSchema.parse({ title: 'T', notes: 'Budget approved.' }));
  assert.equal(r.provider, 'claude'); assert.equal(r.decisions[0], 'Start the pilot on Monday');
  assert.equal(c.calls[0].tools, undefined); assert.equal(c.calls[0].system, ms.MEETING_SUMMARY_SYSTEM_PROMPT);
  ok('summaries are generated with the meeting prompt and without CRM tools (nothing can be created or changed)');
}

// ---------------------------------------------------------------------------
// Endpoint
// ---------------------------------------------------------------------------
{
  const { guard, PUBLIC } = await import('../../server/routeGuards');
  const meetings = (await import('../../routes/meetings')).default;
  const app = express(); app.use(express.json()); app.use('/api/meetings', guard(PUBLIC.none), meetings);
  const body = { title: 'Acme pilot', notes: 'Budget approved.', participants: ['Camelia'], transcript: [{ speakerName: 'Ada', text: 'Start Monday.' }] };

  assert.equal((await request(app).post('/api/meetings/ai-summary').send(body)).status, 401); ok('sign-in required');

  svc.setAnthropicClientForTests(fakeClaude([GOOD]));
  const r = await request(app).post('/api/meetings/ai-summary').set('X-Dev-User-Id', 'alice').send(body);
  assert.equal(r.status, 200); assert.equal(r.body.success, true); assert.equal(r.body.actionItems.length, 2);
  assert.equal(r.body.followUpEmail.subject, 'Next steps for your pilot'); ok('signed-in member gets a structured recap');

  const empty = await request(app).post('/api/meetings/ai-summary').set('X-Dev-User-Id', 'alice').send({ title: 'Nothing' });
  assert.equal(empty.status, 400); assert.equal(empty.body.code, 'empty_meeting'); ok('empty meeting: clear 400, no AI call');

  const bad = await request(app).post('/api/meetings/ai-summary').set('X-Dev-User-Id', 'alice').send({ ...body, durationSeconds: 'long' });
  assert.equal(bad.status, 400); assert.equal(bad.body.code, 'invalid_input'); assert.equal(bad.body.field, 'durationSeconds'); ok('invalid input names the field');

  svc.setAnthropicClientForTests(fakeClaude(['Sorry, I cannot help with that.']));
  const garbled = await request(app).post('/api/meetings/ai-summary').set('X-Dev-User-Id', 'alice').send(body);
  assert.equal(garbled.status, 502); assert.equal(garbled.body.success, false); ok('unusable AI reply: 502 with a message (no invented recap)');

  const orgId = (await store.get('crm_user_memberships/alice')).defaultOrgId;
  await store.set(`organizations/${orgId}/members/rory`, { userId: 'rory', role: 'READ_ONLY', email: '', name: 'Rory', joinedAt: new Date().toISOString() });
  await store.set('crm_user_memberships/rory', { userId: 'rory', orgs: { [orgId]: 'READ_ONLY' }, defaultOrgId: orgId });
  assert.equal((await request(app).post('/api/meetings/ai-summary').set('X-Dev-User-Id', 'rory').send(body)).status, 403); ok('read-only members cannot spend AI credits on recaps');

  delete process.env.ANTHROPIC_API_KEY;
  const none = await request(app).post('/api/meetings/ai-summary').set('X-Dev-User-Id', 'alice').send(body);
  assert.equal(none.status, 503); assert.equal(none.body.code, 'ai_not_configured'); assert.match(none.body.error, /GEMINI_API_KEY or ANTHROPIC_API_KEY/);
  ok('no AI provider configured: 503 explains which key to set');
  process.env.ANTHROPIC_API_KEY = 'test-key';

  svc.setAnthropicClientForTests(fakeClaude(Array(20).fill(GOOD)));
  const codes: number[] = [];
  for (let i = 0; i < 12; i++) codes.push((await request(app).post('/api/meetings/ai-summary').set('X-Dev-User-Id', 'alice').send(body)).status);
  assert.ok(codes.includes(429)); ok('rate limited per user (10 a minute)');
}

console.log(`\n${passed} passed (meeting summary)`);
process.exit(0);
