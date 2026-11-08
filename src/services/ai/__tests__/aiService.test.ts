/**
 * Unified AI service tests with stand-in Gemini and Anthropic clients (no network, no real keys).
 * Run: npx tsx src/services/ai/__tests__/aiService.test.ts
 */
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';

let passed = 0; const ok = (n: string) => { passed++; console.log('  ✓', n); };
Object.assign(process.env, { NODE_ENV: 'test', SOCIAL_ACCOUNTS_DEV_AUTH: 'true', CRM_STORE: 'memory', GEMINI_API_KEY: 'g-test', ANTHROPIC_API_KEY: 'a-test' });
delete process.env.OMNIROUTE_GATEWAY_URL; delete process.env.ANTHROPIC_MODEL; delete process.env.GEMINI_MODEL;

const { MemoryDocStore, setDocStore } = await import('../../../server/data/docStore');
const store = new MemoryDocStore(); setDocStore(store);
const svc = await import('../aiService');
const gem = await import('../../crmAiAssistant');

// ---- stand-ins ----
function fakeGemini(rounds: Array<{ text?: string[]; fn?: any; finish?: string } | { error: any }>) {
  const calls: any[] = []; let i = 0;
  return {
    calls,
    models: {
      async get() { return { outputTokenLimit: 65536 }; },
      async generateContentStream(req: any) {
        calls.push(req); const r = rounds[i++];
        if ('error' in r) throw r.error;
        return (async function* () {
          if (r.fn) yield { candidates: [{ content: { parts: [{ functionCall: r.fn }] } }] };
          for (const [k, t] of (r.text ?? []).entries()) yield { candidates: [{ content: { parts: [{ text: t }] }, ...(k === r.text!.length - 1 ? { finishReason: r.finish ?? 'STOP' } : {}) }] };
        })();
      },
    },
  };
}
function fakeClaude(rounds: Array<{ text?: string[]; tool?: { name: string; input: any }; stop?: string } | { error: any }>) {
  const calls: any[] = []; let i = 0;
  return {
    calls,
    messages: {
      stream(body: any) {
        calls.push(JSON.parse(JSON.stringify(body))); const r = rounds[i++];
        const handlers: Record<string, Function[]> = {};
        const s = {
          on(ev: string, fn: Function) { (handlers[ev] ??= []).push(fn); return s; },
          async finalMessage() {
            if ('error' in r) throw r.error;
            for (const t of r.text ?? []) { await new Promise((res) => setTimeout(res, 1)); for (const fn of handlers.text ?? []) fn(t); }
            const content: any[] = (r.text ?? []).length ? [{ type: 'text', text: (r.text ?? []).join('') }] : [];
            if (r.tool) content.push({ type: 'tool_use', id: 'toolu_1', name: r.tool.name, input: r.tool.input });
            return { model: body.model, content, stop_reason: r.stop ?? (r.tool ? 'tool_use' : 'end_turn') };
          },
        };
        return s;
      },
    },
  };
}
const ctx = { userId: 'alice', orgId: 'org_t', role: 'OWNER', name: 'Alice' };
const SYS = 'SYSTEM PROMPT';

// ---------------------------------------------------------------------------
// History formatting
// ---------------------------------------------------------------------------
{
  const mixed: any[] = [
    { role: 'system', content: 'ignore me' },
    { role: 'model', parts: [{ text: 'Hi, how can I help?' }] },   // Gemini shape, assistant first
    { role: 'user', content: 'Draft a proposal' },
    { role: 'user', parts: [{ text: 'for a dental clinic' }] },      // consecutive user turns
    { role: 'assistant', content: '' },                              // empty: dropped
  ];
  const turns = svc.normalizeHistory(mixed);
  assert.deepEqual(turns.map((t) => t.role), ['assistant', 'user', 'user']); ok('history: accepts Gemini {parts} and {content} shapes; drops system/empty turns');
  const g = svc.toGeminiContents(turns, 'Go');
  assert.deepEqual(g.map((m) => m.role), ['model', 'user', 'user', 'user']); assert.deepEqual(g[0].parts, [{ text: 'Hi, how can I help?' }]);
  ok('Gemini schema: { role: user|model, parts: [{ text }] }');
  const c = svc.toClaudeMessages(turns, 'Go');
  assert.deepEqual(c.map((m) => m.role), ['user']); assert.equal(c[0].content, 'Draft a proposal\n\nfor a dental clinic\n\nGo');
  ok('Claude schema: user|assistant, starts with user, same-role turns merged (a "model" role is never sent)');
  const c2 = svc.toClaudeMessages([{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }], 'c');
  assert.deepEqual(c2, [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'c' }]); ok('Claude: alternating history kept as is');
  const tools = svc.toClaudeTools();
  const sl = tools.find((t) => t.name === 'search_leads')!;
  assert.equal(sl.input_schema.type, 'object'); assert.equal(sl.input_schema.properties.query.type, 'string'); ok('CRM tools converted to Anthropic JSON-Schema tools');
  assert.equal(svc.resolveProvider('claude-sonnet-5-5'), 'claude'); assert.equal(svc.resolveProvider('gpt-4o'), 'gemini'); ok('provider resolved from name or model id');
}

// ---------------------------------------------------------------------------
// Each provider, with the shared system prompt
// ---------------------------------------------------------------------------
{
  const g = fakeGemini([{ text: ['# Proposal', '\n…'] }]); gem.setGeminiClientForTests(g);
  const chunks: string[] = [];
  const r = await svc.generateAIResponse('gemini', 'Write a proposal', [{ role: 'assistant', content: 'Hello' }], { systemPrompt: SYS, onChunk: (d) => chunks.push(d) });
  assert.equal(r.provider, 'gemini'); assert.equal(r.reply, '# Proposal\n…'); assert.deepEqual(chunks, ['# Proposal', '\n…']);
  assert.equal(g.calls[0].config.systemInstruction, SYS); assert.equal(g.calls[0].contents[0].role, 'model'); ok('Gemini: shared system prompt via systemInstruction, streamed reply');
}
{
  const a = fakeClaude([{ text: ['## Executive', ' Summary'] }]); svc.setAnthropicClientForTests(a);
  const chunks: string[] = [];
  const r = await svc.generateAIResponse('claude', 'Write a proposal', [{ role: 'model', parts: [{ text: 'Hi' }] }, { role: 'user', content: 'Hello' }], { systemPrompt: SYS, onChunk: (d) => chunks.push(d) });
  assert.equal(r.provider, 'claude'); assert.equal(r.reply, '## Executive Summary'); assert.deepEqual(chunks, ['## Executive', ' Summary']);
  const call = a.calls[0];
  assert.equal(call.system, SYS); assert.equal(call.model, 'claude-sonnet-5-5'); assert.equal(call.max_tokens, 32000);
  assert.ok(call.messages.every((m: any) => m.role === 'user' || m.role === 'assistant')); assert.equal(call.messages[0].role, 'user');
  ok('Claude: shared prompt via `system`, valid roles, streamed reply, 32k output (not 4,096)');
}
{
  const a = fakeClaude([{ text: ['Phase 1…'], stop: 'max_tokens' }]); svc.setAnthropicClientForTests(a);
  assert.equal((await svc.generateAIResponse('claude', 'long', [], { systemPrompt: SYS })).finish, 'length'); ok('Claude max_tokens → finish “length” (UI offers Continue)');
}
{
  await store.set('organizations/org_t', { id: 'org_t', name: 'T' });
  const a = fakeClaude([{ tool: { name: 'search_leads', input: { query: 'ada' } } }, { text: ['No leads match “ada”.'] }]); svc.setAnthropicClientForTests(a);
  const tools: string[] = [];
  const r = await svc.generateAIResponse('claude', 'find ada', [], { systemPrompt: SYS, context: ctx, onToolCall: (n) => tools.push(n) });
  assert.deepEqual(tools, ['search_leads']); assert.equal(r.reply, 'No leads match “ada”.');
  const second = a.calls[1].messages;
  assert.equal(second.at(-2).content[0].type, 'tool_use'); assert.equal(second.at(-1).content[0].type, 'tool_result'); assert.equal(second.at(-1).content[0].tool_use_id, 'toolu_1');
  ok('Claude uses the same CRM tools (scoped to the organization); tool_result returned correctly');
  const ro = fakeClaude([{ tool: { name: 'create_lead', input: { name: 'X', email: 'x@y.test' } } }, { text: ['Not allowed.'] }]); svc.setAnthropicClientForTests(ro);
  await svc.generateAIResponse('claude', 'add lead', [], { systemPrompt: SYS, context: { ...ctx, role: 'READ_ONLY' } });
  assert.equal((await store.list('organizations/org_t/leads')).length, 0); ok('Claude tool calls respect roles (read-only can’t create)');
}

// ---------------------------------------------------------------------------
// Errors and fallback
// ---------------------------------------------------------------------------
{
  gem.setGeminiClientForTests(fakeGemini([{ text: ['Gemini answered.'] }]));
  svc.setAnthropicClientForTests(fakeClaude([{ error: Object.assign(new Error('rate_limit_error'), { status: 429 }) }]));
  const r = await svc.generateAIResponse('claude', 'hi', [], { systemPrompt: SYS });
  assert.equal(r.provider, 'gemini'); assert.match(r.notice!, /Claude is rate-limited right now, so Gemini answered/); ok('Claude 429 → Gemini answers, and the reply says so');

  svc.setAnthropicClientForTests(fakeClaude([{ text: ['Claude answered.'] }]));
  gem.setGeminiClientForTests(fakeGemini([{ error: Object.assign(new Error('UNAVAILABLE'), { status: 503 }) }]));
  const r2 = await svc.generateAIResponse('gemini', 'hi', [], { systemPrompt: SYS });
  assert.equal(r2.provider, 'claude'); assert.match(r2.notice!, /Gemini didn’t respond, so Claude answered/); ok('Gemini 503 → Claude answers');

  gem.setGeminiClientForTests(fakeGemini([{ error: Object.assign(new Error('bad'), { status: 503 }) }]));
  svc.setAnthropicClientForTests(fakeClaude([{ error: Object.assign(new Error('Overloaded'), { status: 529 }) }]));
  await assert.rejects(svc.generateAIResponse('gemini', 'hi', [], { systemPrompt: SYS }), (e: any) => e instanceof svc.AIProviderError && e.provider === 'claude' && e.code === 'overloaded');
  ok('both down → one clear error (no invented reply)');

  gem.setGeminiClientForTests(fakeGemini([{ text: ['x'] }]));
  svc.setAnthropicClientForTests(fakeClaude([{ error: Object.assign(new Error('invalid'), { status: 400 }) }]));
  await assert.rejects(svc.generateAIResponse('claude', 'hi', [], { systemPrompt: SYS }), (e: any) => e.code === 'bad_request'); ok('a bad request isn’t retried on the other provider');

  svc.setAnthropicClientForTests(fakeClaude([{ text: ['x'] }]));
  await assert.rejects(svc.generateAIResponse('claude', 'hi', [], { systemPrompt: SYS, fallback: false, onChunk: () => { throw Object.assign(new Error('boom'), { status: 503 }); } }));
  ok('fallback can be turned off');

  const key = process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_API_KEY; svc.setAnthropicClientForTests(null);
  gem.setGeminiClientForTests(fakeGemini([{ text: ['From Gemini'] }]));
  const r3 = await svc.generateAIResponse('claude', 'hi', [], { systemPrompt: SYS });
  assert.equal(r3.provider, 'gemini'); assert.match(r3.notice!, /Claude isn’t configured/); ok('Claude not configured → Gemini answers with a notice');
  assert.equal(svc.providerStatus().claude.configured, false); process.env.ANTHROPIC_API_KEY = key;
}

// ---------------------------------------------------------------------------
// Routes: POST /api/chat (unified JSON), /api/chat/completions (streaming), /api/chat/models
// ---------------------------------------------------------------------------
{
  const { guard, PUBLIC } = await import('../../../server/routeGuards');
  const chat = (await import('../../../routes/chat')).default;
  const app = express(); app.use(express.json()); app.use('/api/chat', guard(PUBLIC.none), chat);
  const A = { 'X-Dev-User-Id': 'alice' };

  svc.setAnthropicClientForTests(fakeClaude([{ text: ['# SOW', '\nDone'] }]));
  let r = await request(app).post('/api/chat').set(A).send({ message: 'Write an SOW', history: [{ role: 'model', parts: [{ text: 'Hi' }] }], provider: 'claude' });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.provider, 'claude'); assert.equal(r.body.reply, '# SOW\nDone'); assert.equal(r.body.finish, 'stop');
  ok('POST /api/chat { message, history, provider: "claude" } → reply');
  r = await request(app).post('/api/chat').set(A).send({ message: 'hi', provider: 'gpt' });
  assert.equal(r.status, 400); ok('unknown provider → 400');
  r = await request(app).post('/api/chat').set(A).send({ message: '   ', provider: 'gemini' });
  assert.equal(r.status, 400); ok('empty message → 400');
  assert.equal((await request(app).post('/api/chat').send({ message: 'hi', provider: 'gemini' })).status, 401); ok('sign-in required');
  gem.setGeminiClientForTests(fakeGemini([{ error: Object.assign(new Error('quota'), { status: 429 }) }]));
  svc.setAnthropicClientForTests(fakeClaude([{ error: Object.assign(new Error('quota'), { status: 429 }) }]));
  r = await request(app).post('/api/chat').set(A).send({ message: 'hi', provider: 'gemini' });
  assert.equal(r.status, 429); assert.ok(!/quota/.test(r.body.error)); ok('both rate-limited → 429 with a safe message (no provider internals)');

  svc.setAnthropicClientForTests(fakeClaude([{ text: ['Streaming ', 'from Claude'] }]));
  r = await request(app).post('/api/chat/completions').set(A).send({ provider: 'claude', messages: [{ role: 'user', content: 'Hi' }] });
  const deltas = r.text.split('\n').filter((l) => l.startsWith('data: {')).map((l) => JSON.parse(l.slice(6))).map((e) => e.choices?.[0]?.delta?.content).filter(Boolean);
  assert.equal(deltas.join(''), 'Streaming from Claude'); ok('dashboard stream (/api/chat/completions) works with provider "claude"');

  r = await request(app).get('/api/chat/models').set(A);
  assert.deepEqual(r.body.models.map((m: any) => m.id), ['gemini', 'claude']); assert.ok(!JSON.stringify(r.body).includes('gpt-4o'));
  ok('/api/chat/models lists only providers this server can use');
}

gem.setGeminiClientForTests(null); svc.setAnthropicClientForTests(null);
console.log(`\n${passed} passed (ai service)`);
process.exit(0);
