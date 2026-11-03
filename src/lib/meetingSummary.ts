/**
 * On-device meeting summary: key points and action items pulled from the
 * transcript, chat and notes. Used when the AI summary endpoint is
 * unavailable, and by the server as its no-API-key fallback.
 */

export interface SummaryInputLine {
  speaker: string;
  text: string;
  /** Seconds since the meeting started (optional). */
  at?: number;
}

export interface MeetingActionItem {
  text: string;
  owner?: string;
  due?: string;
}

export interface MeetingSummary {
  overview: string;
  keyPoints: string[];
  actionItems: MeetingActionItem[];
  decisions: string[];
  speakers: { name: string; lines: number }[];
  source: 'ai' | 'on-device';
}

const ACTION_PATTERNS = [
  /\b(?:i|we)(?:'ll| will| need to| should| must| have to| are going to|'re going to)\s+(.+)/i,
  /\b(?:action item|todo|to-do|follow[- ]up|next step)s?\s*[:\-]\s*(.+)/i,
  /\b(?:can you|could you|please)\s+(.+)/i,
  /\b(?:let's|let us)\s+(.+)/i,
];
const DECISION_PATTERNS = [/\b(?:we (?:decided|agreed)|decision|agreed to|approved|go with)\b/i];
const DUE_PATTERN = /\b(?:by|before|on|due)\s+((?:next\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today|eod|end of (?:day|week|month)|q[1-4]|\d{1,2}(?:st|nd|rd|th)?(?:\s+\w+)?))\b/i;
const OWNER_PATTERN = /^@?([A-Z][a-z]+)[,:]\s+/;

const STOP = new Set('a an and are as at be but by for from has have i if in into is it its of on or our so that the their them then there these they this to was we were what when which who will with you your yeah okay ok um uh like just really very can could would should also about all any been do does did get got going know me my not now one out over some than too up us well'.split(' '));

const clean = (s: string) => s.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/\s+/g, ' ').trim();
const sentenceCase = (s: string) => {
  const t = clean(s).replace(/[.!?]+$/, '');
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
};

export function splitSentences(text: string): string[] {
  return clean(text).split(/(?<=[.!?])\s+(?=[A-Z0-9"'])/).map(clean).filter((s) => s.length > 0);
}

function words(s: string): string[] {
  return s.toLowerCase().match(/[a-z0-9']+/g)?.filter((w) => w.length > 2 && !STOP.has(w)) ?? [];
}

export function extractActionItems(lines: SummaryInputLine[]): MeetingActionItem[] {
  const out: MeetingActionItem[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    for (const sentence of splitSentences(line.text)) {
      // Markdown checkboxes from meeting notes.
      const box = sentence.match(/^-?\s*\[\s?\]\s*(.+)/);
      const match = box ? [sentence, box[1]] : ACTION_PATTERNS.map((re) => sentence.match(re)).find(Boolean);
      if (!match) continue;
      const body = sentenceCase(match[1]);
      if (body.split(' ').length < 2) continue;
      const key = body.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const owner = sentence.match(OWNER_PATTERN)?.[1] ?? (/\b(i|i'll)\b/i.test(sentence) ? line.speaker : undefined);
      const due = sentence.match(DUE_PATTERN)?.[1];
      out.push({ text: body, ...(owner ? { owner } : {}), ...(due ? { due: sentenceCase(due) } : {}) });
    }
  }
  return out.slice(0, 12);
}

/** Frequency-scored extractive summary. Deterministic for the same input. */
export function summarizeMeeting(lines: SummaryInputLine[], opts: { maxPoints?: number; title?: string } = {}): MeetingSummary {
  const maxPoints = opts.maxPoints ?? 5;
  const usable = lines.map((l) => ({ ...l, text: clean(l.text) })).filter((l) => l.text.length > 0);
  const speakerCounts = new Map<string, number>();
  for (const l of usable) speakerCounts.set(l.speaker, (speakerCounts.get(l.speaker) ?? 0) + 1);
  const speakers = [...speakerCounts.entries()].map(([name, n]) => ({ name, lines: n })).sort((a, b) => b.lines - a.lines);

  const sentences: { text: string; speaker: string; order: number }[] = [];
  usable.forEach((l) => splitSentences(l.text).forEach((s) => sentences.push({ text: s, speaker: l.speaker, order: sentences.length })));

  const freq = new Map<string, number>();
  for (const s of sentences) for (const w of words(s.text)) freq.set(w, (freq.get(w) ?? 0) + 1);

  const scored = sentences
    .filter((s) => words(s.text).length >= 3)
    .map((s) => {
      const ws = words(s.text);
      const score = ws.reduce((t, w) => t + (freq.get(w) ?? 0), 0) / Math.sqrt(ws.length);
      return { ...s, score };
    });
  const top = [...scored].sort((a, b) => b.score - a.score || a.order - b.order).slice(0, maxPoints).sort((a, b) => a.order - b.order);
  const keyPoints = top.map((s) => sentenceCase(s.text.replace(/^-?\s*\[\s?[xX]?\]\s*/, '')));

  const decisions = sentences.filter((s) => DECISION_PATTERNS.some((re) => re.test(s.text))).map((s) => sentenceCase(s.text)).slice(0, 5);
  const actionItems = extractActionItems(usable);

  const topics = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([w]) => w);
  const overview = usable.length === 0
    ? 'Nothing was said or written in this meeting yet, so there is nothing to summarize.'
    : `${opts.title ? `${opts.title}: ` : ''}${speakers.length} ${speakers.length === 1 ? 'person' : 'people'} spoke across ${usable.length} ${usable.length === 1 ? 'entry' : 'entries'}${topics.length ? `, mostly about ${topics.join(', ')}` : ''}. ${actionItems.length} action ${actionItems.length === 1 ? 'item' : 'items'} found.`;

  return { overview, keyPoints, actionItems, decisions, speakers, source: 'on-device' };
}
