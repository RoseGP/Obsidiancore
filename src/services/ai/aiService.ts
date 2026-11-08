/**
 * Unified AI service: Google Gemini and Anthropic Claude behind one function.
 *
 *   generateAIResponse(provider, userMessage, history, options)
 *
 * - One system prompt for both providers (built by services/assistantPrompt.ts; never from the browser).
 * - History is normalized once, then formatted per provider:
 *     Gemini  contents: [{ role: 'user' | 'model', parts: [{ text }] }]  + config.systemInstruction
 *     Claude  messages: [{ role: 'user' | 'assistant', content }]       + top-level `system`
 * - Both stream (onChunk), use the same CRM tools scoped to the caller's organization, report why a reply
 *   ended ('stop' | 'length' | 'safety' | 'aborted' | 'other'), and honor an AbortSignal.
 * - Fallback: if the chosen provider fails *before* producing any text with a recoverable error
 *   (rate limit, overload, 5xx, network, not configured, model unavailable), the other provider answers
 *   and `notice` says so. After partial text the error is reported instead, so nothing is duplicated.
 *
 * Environment: GEMINI_API_KEY, GEMINI_MODEL, GEMINI_MAX_OUTPUT_TOKENS (see crmAiAssistant.ts),
 *              ANTHROPIC_API_KEY, ANTHROPIC_MODEL (default claude-sonnet-5-5), ANTHROPIC_MAX_OUTPUT_TOKENS (default 32000).
 */
import Anthropic from '@anthropic-ai/sdk';
import { CRM_TOOL_DECLARATIONS, executeCrmTool, runCrmAssistantTurn, trimHistory, type AssistantFinish } from '../crmAiAssistant';

export type AIProvider = 'gemini' | 'claude';

/** Accepted history shapes: our own {role, content}, OpenAI-style, or Gemini-style {role, parts}. */
export type HistoryMessage =
  | { role: 'user' | 'assistant' | 'model' | 'system'; content: string }
  | { role: 'user' | 'model' | 'assistant'; parts: Array<{ text?: string }> };

export interface ChatTurn { role: 'user' | 'assistant'; content: string }

export interface AIContext { userId: string; orgId: string; role: string; name: string }

export interface GenerateOptions {
  systemPrompt: string;
  /** Needed for CRM tools; without it the reply is generated without tools. */
  context?: AIContext;
  useTools?: boolean;
  /** Try the other provider on a recoverable failure before any text (default true). */
  fallback?: boolean;
  signal?: AbortSignal;
  onChunk?: (delta: string) => void;
  onToolCall?: (name: string, args: unknown) => void;
}

export interface AIResult {
  provider: AIProvider;
  model: string;
  reply: string;
  finish: AssistantFinish;
  toolCalls: string[];
  /** Plain-language note for the user (fallback used, history trimmed, model substituted). */
  notice?: string;
}

export class AIProviderError extends Error {
  constructor(message: string, public provider: AIProvider, public code: string, public status?: number, public partial = false) { super(message); }
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
export function providerStatus() {
  return {
    gemini: { configured: !!process.env.GEMINI_API_KEY, model: (process.env.GEMINI_MODEL || 'gemini-3.8-flash').trim(), label: 'Google Gemini' },
    claude: { configured: !!process.env.ANTHROPIC_API_KEY, model: claudeModel(), label: 'Anthropic Claude' },
  };
}
const claudeModel = () => (process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5').trim();
const claudeMaxTokens = () => Math.max(1024, Number(process.env.ANTHROPIC_MAX_OUTPUT_TOKENS) || 32000);

let anthropicClient: any = null;
/** Tests only: inject a stand-in Anthropic client (null restores the real one). */
export function setAnthropicClientForTests(client: any | null) { anthropicClient = client; }
function getAnthropic(): any {
  if (!anthropicClient && process.env.ANTHROPIC_API_KEY) anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 2 });
  return anthropicClient;
}

export function resolveProvider(input: unknown): AIProvider {
  const v = String(input ?? '').toLowerCase();
  return v === 'claude' || v.startsWith('claude') || v === 'anthropic' ? 'claude' : 'gemini';
}

// ---------------------------------------------------------------------------
// History formatting
// ---------------------------------------------------------------------------
/** Normalizes any accepted history shape to alternating-safe {role: user|assistant, content}. System turns are dropped. */
export function normalizeHistory(history: HistoryMessage[] = []): ChatTurn[] {
  const out: ChatTurn[] = [];
  for (const m of Array.isArray(history) ? history : []) {
    if (!m || typeof m !== 'object') continue;
    const role = (m as any).role;
    if (role === 'system') continue;
    const text = typeof (m as any).content === 'string'
      ? (m as any).content
      : Array.isArray((m as any).parts) ? (m as any).parts.map((p: any) => (typeof p?.text === 'string' ? p.text : '')).join('') : '';
    if (!text.trim()) continue;
    out.push({ role: role === 'user' ? 'user' : 'assistant', content: text });
  }
  return out;
}

export function toGeminiContents(history: ChatTurn[], userMessage: string) {
  return [...history, { role: 'user' as const, content: userMessage }].map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
}

/** Claude: roles must alternate and the conversation must start with the user; same-role turns are merged. */
export function toClaudeMessages(history: ChatTurn[], userMessage: string): Array<{ role: 'user' | 'assistant'; content: any }> {
  const merged: Array<{ role: 'user' | 'assistant'; content: any }> = [];
  for (const m of [...history, { role: 'user' as const, content: userMessage }]) {
    const prev = merged[merged.length - 1];
    if (prev && prev.role === m.role) prev.content = `${prev.content}\n\n${m.content}`;
    else merged.push({ role: m.role, content: m.content });
  }
  while (merged.length && merged[0].role !== 'user') merged.shift();
  return merged;
}

/** The CRM tool declarations (Gemini schema types) as Anthropic tools (JSON Schema). */
export function toClaudeTools(decls: any[] = CRM_TOOL_DECLARATIONS as any[]) {
  const schema = (s: any): any => {
    if (!s || typeof s !== 'object') return s;
    const out: any = {};
    if (s.type) out.type = String(s.type).toLowerCase();
    if (s.description) out.description = s.description;
    if (s.enum) out.enum = s.enum;
    if (s.properties) out.properties = Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, schema(v)]));
    if (s.items) out.items = schema(s.items);
    if (s.required) out.required = s.required;
    return out;
  };
  return decls.map((d) => ({ name: d.name, description: d.description, input_schema: d.parameters ? schema(d.parameters) : { type: 'object', properties: {} } }));
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------
async function runGemini(userMessage: string, history: ChatTurn[], o: GenerateOptions): Promise<AIResult> {
  const r = await runCrmAssistantTurn({
    incomingMessage: userMessage, conversationHistory: history, systemInstruction: o.systemPrompt,
    context: o.context ?? { userId: 'anonymous', orgId: '', role: 'READ_ONLY', name: '' },
    useTools: !!o.context && o.useTools !== false, signal: o.signal, onChunk: o.onChunk, onToolCall: o.onToolCall,
  });
  const notes = [r.note, r.historyDropped ? `The ${r.historyDropped} oldest messages were left out to fit the model’s context.` : ''].filter(Boolean);
  return { provider: 'gemini', model: r.model, reply: r.reply, finish: r.finish, toolCalls: r.toolCallsExecuted, notice: notes.join(' ') || undefined };
}

const CLAUDE_FINISH: Record<string, AssistantFinish> = { end_turn: 'stop', stop_sequence: 'stop', max_tokens: 'length', model_context_window_exceeded: 'length', refusal: 'safety' };

async function runClaude(userMessage: string, historyIn: ChatTurn[], o: GenerateOptions): Promise<AIResult> {
  const client = getAnthropic();
  if (!client) throw new AIProviderError('Claude isn’t configured on the server. Set ANTHROPIC_API_KEY.', 'claude', 'ai_not_configured');
  const model = claudeModel();
  const { kept, dropped } = trimHistory(historyIn);
  const messages: any[] = toClaudeMessages(kept, userMessage);
  const tools = o.context && o.useTools !== false ? toClaudeTools() : undefined;
  const toolCalls: string[] = [];
  let reply = '';
  for (let round = 0; round <= 5; round++) {
    const stream = client.messages.stream(
      { model, max_tokens: claudeMaxTokens(), system: o.systemPrompt, messages, temperature: 0.4, ...(tools && round < 5 ? { tools } : {}) },
      o.signal ? { signal: o.signal } : undefined,
    );
    stream.on('text', (delta: string) => { if (!o.signal?.aborted) { reply += delta; o.onChunk?.(delta); } });
    let final: any;
    try {
      final = await stream.finalMessage();
    } catch (err) {
      if (o.signal?.aborted) return { provider: 'claude', model, reply, finish: 'aborted', toolCalls };
      throw err;
    }
    if (o.signal?.aborted) return { provider: 'claude', model, reply, finish: 'aborted', toolCalls };
    const uses = (final.content || []).filter((b: any) => b.type === 'tool_use');
    if (final.stop_reason === 'tool_use' && uses.length && o.context) {
      messages.push({ role: 'assistant', content: final.content }); // verbatim, as the API requires
      const results: any[] = [];
      for (const u of uses) {
        toolCalls.push(u.name);
        o.onToolCall?.(u.name, u.input);
        const result = await executeCrmTool(u.name, u.input || {}, o.context);
        results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(result).slice(0, 50_000) });
      }
      messages.push({ role: 'user', content: results });
      continue;
    }
    return {
      provider: 'claude', model: final.model || model, reply, toolCalls,
      finish: CLAUDE_FINISH[final.stop_reason] ?? 'other',
      notice: dropped ? `The ${dropped} oldest messages were left out to fit the model’s context.` : undefined,
    };
  }
  return { provider: 'claude', model, reply, finish: 'other', toolCalls };
}

// ---------------------------------------------------------------------------
// Unified entry point
// ---------------------------------------------------------------------------
function classify(err: any, provider: AIProvider): AIProviderError {
  if (err instanceof AIProviderError) return err;
  const status: number | undefined = err?.status ?? err?.statusCode ?? (typeof err?.code === 'number' ? err.code : undefined);
  const code = err?.code === 'ai_not_configured' || err?.code === 'model_unavailable' ? err.code
    : status === 429 ? 'rate_limited'
    : status === 529 || /overloaded/i.test(String(err?.message)) ? 'overloaded'
    : status && status >= 500 ? 'provider_unavailable'
    : status === 401 || status === 403 ? 'auth_failed'
    : status === 400 ? 'bad_request'
    : 'provider_unavailable';
  return new AIProviderError(String(err?.message || 'The AI provider failed.').slice(0, 300), provider, code, status);
}
const RECOVERABLE = new Set(['rate_limited', 'overloaded', 'provider_unavailable', 'ai_not_configured', 'model_unavailable', 'auth_failed']);
const LABEL: Record<AIProvider, string> = { gemini: 'Gemini', claude: 'Claude' };
const REASON: Record<string, string> = {
  rate_limited: 'is rate-limited right now', overloaded: 'is overloaded right now', provider_unavailable: 'didn’t respond',
  ai_not_configured: 'isn’t configured', model_unavailable: 'model isn’t available', auth_failed: 'rejected the API key',
};

export async function generateAIResponse(provider: AIProvider, userMessage: string, history: HistoryMessage[] = [], options: GenerateOptions): Promise<AIResult> {
  const message = String(userMessage ?? '').trim();
  if (!message) throw new AIProviderError('Write a message first.', provider, 'bad_request', 400);
  const turns = normalizeHistory(history);
  let produced = false;
  const opts: GenerateOptions = { ...options, onChunk: (d) => { produced = true; options.onChunk?.(d); } };
  const run = (p: AIProvider) => (p === 'claude' ? runClaude(message, turns, opts) : runGemini(message, turns, opts));

  try {
    return await run(provider);
  } catch (raw) {
    const err = classify(raw, provider);
    console.warn(`[ai] ${provider} failed (${err.code}${err.status ? ` ${err.status}` : ''}): ${err.message}`);
    const other: AIProvider = provider === 'claude' ? 'gemini' : 'claude';
    const canFallBack = options.fallback !== false && !produced && !options.signal?.aborted && RECOVERABLE.has(err.code) && providerStatus()[other].configured;
    if (!canFallBack) { err.partial = produced; throw err; }
    try {
      const r = await run(other);
      return { ...r, notice: [`${LABEL[provider]} ${REASON[err.code] ?? 'failed'}, so ${LABEL[other]} answered.`, r.notice].filter(Boolean).join(' ') };
    } catch (raw2) {
      const err2 = classify(raw2, other);
      console.warn(`[ai] fallback ${other} failed too (${err2.code}): ${err2.message}`);
      err2.partial = produced;
      throw err2;
    }
  }
}
