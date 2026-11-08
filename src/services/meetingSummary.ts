/**
 * AI meeting summary: summary, key points, decisions, action items and a follow-up email draft,
 * generated from what the meeting actually captured (transcript, notes, tasks, attendees).
 *
 * Uses the shared AI service (Gemini or Claude, with fallback) with CRM tools OFF: summarizing a
 * meeting must never create or change CRM records. The browser receives structured JSON.
 */
import { z } from 'zod';
import { AIProviderError, generateAIResponse, providerStatus, type AIProvider } from './ai/aiService';

/** Generous but bounded: keeps requests fast and inside every model's context window. */
export const MAX_TRANSCRIPT_CHARS = 60_000;
export const MAX_NOTES_CHARS = 20_000;

export const meetingSummaryInputSchema = z.object({
  title: z.string().trim().max(300).default('Meeting'),
  durationSeconds: z.number().int().min(0).max(24 * 3600).default(0),
  participants: z.array(z.string().trim().max(200)).max(500).default([]),
  notes: z.string().max(200_000).default(''),
  transcript: z.array(z.object({ speakerName: z.string().max(200), text: z.string().max(10_000) })).max(5000).default([]),
  tasks: z.array(z.object({ title: z.string().max(500), contactName: z.string().max(200).optional() })).max(200).default([]),
  provider: z.enum(['gemini', 'claude']).optional(),
});
export type MeetingSummaryInput = z.infer<typeof meetingSummaryInputSchema>;

export interface MeetingActionItem { title: string; owner: string; dueInDays: number | null; priority: 'high' | 'medium' | 'low' }
export interface MeetingSummary {
  summary: string;
  keyPoints: string[];
  decisions: string[];
  actionItems: MeetingActionItem[];
  followUpEmail: { subject: string; body: string };
}

export const MEETING_SUMMARY_SYSTEM_PROMPT = [
  'You are a meeting assistant inside a CRM. You write accurate, concise meeting recaps for business users.',
  'Use ONLY the information provided. Never invent attendees, numbers, dates, decisions or commitments.',
  'If the material is thin, say so briefly in the summary and keep the lists short or empty.',
  'Reply with ONE JSON object and nothing else (no Markdown fences), exactly in this shape:',
  '{"summary": string (2-5 sentences), "keyPoints": string[], "decisions": string[],',
  ' "actionItems": [{"title": string, "owner": string ("Unassigned" if unclear), "dueInDays": number|null, "priority": "high"|"medium"|"low"}],',
  ' "followUpEmail": {"subject": string, "body": string (plain text, friendly and professional, no placeholders like [Name])}}',
].join('\n');

const fmtDuration = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : `${Math.max(1, Math.round(s / 60))} min`);

/** Most recent content wins when the transcript is too long: the end of a meeting carries the decisions. */
function clipTranscript(lines: string[], max: number): { text: string; clipped: boolean } {
  let total = 0; const kept: string[] = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    total += lines[i].length + 1;
    if (total > max) return { text: kept.reverse().join('\n'), clipped: true };
    kept.push(lines[i]);
  }
  return { text: kept.reverse().join('\n'), clipped: false };
}

export function buildMeetingSummaryPrompt(input: MeetingSummaryInput): { prompt: string; hasContent: boolean } {
  const lines = input.transcript.filter((t) => t.text.trim()).map((t) => `${t.speakerName.trim() || 'Speaker'}: ${t.text.trim()}`);
  const { text: transcript, clipped } = clipTranscript(lines, MAX_TRANSCRIPT_CHARS);
  const notes = input.notes.trim().slice(0, MAX_NOTES_CHARS);
  const tasks = input.tasks.map((t) => `- ${t.title}${t.contactName ? ` (${t.contactName})` : ''}`).join('\n');
  const parts = [
    `Meeting: ${input.title || 'Meeting'}`,
    input.durationSeconds ? `Duration: ${fmtDuration(input.durationSeconds)}` : '',
    input.participants.length ? `Attendees: ${input.participants.join(', ')}` : '',
    notes ? `\nHost notes:\n${notes}` : '',
    tasks ? `\nFollow-up tasks already captured:\n${tasks}` : '',
    transcript ? `\nTranscript${clipped ? ' (earlier part omitted for length)' : ''}:\n${transcript}` : '',
  ].filter(Boolean);
  return { prompt: parts.join('\n'), hasContent: !!(notes || tasks || transcript) };
}

const asStrings = (v: unknown, max = 20) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()).slice(0, max) : []);

/** Tolerant parser: accepts fenced JSON or JSON with surrounding prose; normalizes every field. */
export function parseMeetingSummary(reply: string): MeetingSummary {
  const text = reply.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = text.indexOf('{'), end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('The AI reply did not contain a summary.');
  let raw: any;
  try { raw = JSON.parse(text.slice(start, end + 1)); } catch { throw new Error('The AI reply was not valid JSON.'); }
  const summary = typeof raw.summary === 'string' ? raw.summary.trim() : '';
  if (!summary) throw new Error('The AI reply had no summary.');
  const actionItems: MeetingActionItem[] = (Array.isArray(raw.actionItems) ? raw.actionItems : [])
    .filter((a: any) => a && typeof a.title === 'string' && a.title.trim())
    .slice(0, 25)
    .map((a: any) => ({
      title: a.title.trim(),
      owner: typeof a.owner === 'string' && a.owner.trim() ? a.owner.trim() : 'Unassigned',
      dueInDays: Number.isFinite(a.dueInDays) && a.dueInDays >= 0 ? Math.min(365, Math.round(a.dueInDays)) : null,
      priority: a.priority === 'high' || a.priority === 'low' ? a.priority : 'medium',
    }));
  const email = raw.followUpEmail && typeof raw.followUpEmail === 'object' ? raw.followUpEmail : {};
  return {
    summary,
    keyPoints: asStrings(raw.keyPoints),
    decisions: asStrings(raw.decisions),
    actionItems,
    followUpEmail: {
      subject: typeof email.subject === 'string' && email.subject.trim() ? email.subject.trim() : 'Thanks for meeting today',
      body: typeof email.body === 'string' ? email.body.trim() : '',
    },
  };
}

export class MeetingSummaryError extends Error {
  constructor(message: string, public status: number, public code: string) { super(message); }
}

export function defaultSummaryProvider(): AIProvider | null {
  const s = providerStatus();
  return s.gemini.configured ? 'gemini' : s.claude.configured ? 'claude' : null;
}

export async function generateMeetingSummary(input: MeetingSummaryInput, signal?: AbortSignal): Promise<MeetingSummary & { provider: AIProvider; model: string; notice?: string }> {
  const { prompt, hasContent } = buildMeetingSummaryPrompt(input);
  if (!hasContent) throw new MeetingSummaryError('Nothing to summarize yet: add notes or turn on the transcript first.', 400, 'empty_meeting');
  const provider = input.provider ?? defaultSummaryProvider();
  if (!provider) throw new MeetingSummaryError('AI summaries need GEMINI_API_KEY or ANTHROPIC_API_KEY on the server.', 503, 'ai_not_configured');
  try {
    const r = await generateAIResponse(provider, prompt, [], { systemPrompt: MEETING_SUMMARY_SYSTEM_PROMPT, useTools: false, fallback: true, signal });
    return { ...parseMeetingSummary(r.reply), provider: r.provider, model: r.model, notice: r.notice };
  } catch (e) {
    if (e instanceof MeetingSummaryError) throw e;
    if (e instanceof AIProviderError) throw new MeetingSummaryError(e.message, e.code === 'ai_not_configured' ? 503 : (e.status && e.status < 500 ? e.status : 502), e.code);
    throw new MeetingSummaryError((e as Error).message || 'The summary could not be generated.', 502, 'ai_bad_reply');
  }
}
