/**
 * Shared helpers for the analytics reports (forecast, pipeline health, segments, deal actions).
 * Pure functions only: every report takes plain records and a `now` and returns the same result for the
 * same input. See docs/analytics/README.md for the formulas.
 */
import { DEAL_STAGES, DEAL_STAGE_PROBABILITY, isDealStage, type DealStage } from '../../../lib/pipelineStages';

export const DAY = 86_400_000;

/** Open stages in pipeline order (won/lost are outcomes, not places a deal waits in). */
export const OPEN_STAGES = DEAL_STAGES.filter((s) => s !== 'won' && s !== 'lost') as Exclude<DealStage, 'won' | 'lost'>[];
export type OpenStage = typeof OPEN_STAGES[number];
export const STAGE_LABELS: Record<DealStage, string> = { lead: 'Lead', discovery: 'Discovery', qualified: 'Qualified', proposal: 'Proposal', negotiation: 'Negotiation', won: 'Won', lost: 'Lost' };
export const stageIndex = (s: unknown) => OPEN_STAGES.indexOf(s as OpenStage);
export const defaultProbability = (s: OpenStage) => DEAL_STAGE_PROBABILITY[s] / 100;

export const ts = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const t = typeof v === 'number' ? v : Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
};
export const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
export const round = (n: number, dp = 0) => { const f = 10 ** dp; return Math.round(n * f) / f; };
export const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export const wholeDays = (ms: number) => Math.max(0, Math.round(ms / DAY));

/** One stage vocabulary: legacy board ids map to their deal stage; anything unknown counts as the first stage. */
export function normalizeStage(v: unknown): DealStage {
  const s = String(v ?? '').toLowerCase();
  if (isDealStage(s)) return s;
  if (s === 'proposal_sent') return 'proposal';
  if (s === 'closed_won') return 'won';
  if (s === 'closed_lost' || s === 'unqualified') return 'lost';
  return 'lead';
}
/** Live deals with a normalized stage (deleted/archived ones are left out). */
export const normalizeDeals = (deals: any[]) => deals.filter((d) => d && d.id && isLive(d)).map((d) => ({ ...d, stage: normalizeStage(d.stage) }));

/** A deal's value, or null when nobody entered one (never guessed). */
export function dealValue(d: any): number | null {
  const v = Number(d?.value);
  return Number.isFinite(v) && v > 0 ? v : null;
}
export const isLive = (d: any) => !!d && !d.deletedAt && !d.archived && !d.mergedInto;
export const isOpen = (d: any) => isLive(d) && d.stage !== 'won' && d.stage !== 'lost';
export const isClosed = (d: any) => isLive(d) && (d.stage === 'won' || d.stage === 'lost');

/** UTC month key, e.g. "2026-11". */
export const monthKey = (t: number) => { const d = new Date(t); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };
export const monthStart = (t: number) => { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); };
export const addMonths = (t: number, n: number) => { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1); };
export const monthLabel = (key: string) => {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
};
export const dateLabel = (t: number) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

// ---------------------------------------------------------------------------------------------------------
// Stage history
// ---------------------------------------------------------------------------------------------------------
export interface StageEntry { stage: DealStage; at: number }
export interface StageHistory { entries: StageEntry[]; source: 'recorded' | 'activity_log' | 'none' }

/**
 * When the deal entered each stage, oldest first. Sources, in order:
 *   1. deal.stageHistory [{ stage, at, from? }], recorded on every stage change since this feature shipped;
 *   2. the organization activity feed ("stage_advanced" entries for the deal: "Stage moved to PROPOSAL");
 *   3. nothing: only the current stage, entered when the deal was created (or stageEnteredAt if set).
 * The stage the deal was created in is the first recorded entry's `from` when known, otherwise unknown.
 */
export function stageHistory(deal: any, feedForDeal: any[] = []): StageHistory {
  const created = ts(deal.createdAt);
  const out: StageEntry[] = [];
  let source: StageHistory['source'] = 'none';
  const recorded = Array.isArray(deal.stageHistory) ? deal.stageHistory : [];
  if (recorded.length) {
    source = 'recorded';
    const first = recorded[0];
    if (first && isDealStage(first.from) && created !== null && (ts(first.at) ?? 0) > created) out.push({ stage: first.from, at: created });
    for (const e of recorded) { const at = ts(e?.at); if (isDealStage(e?.stage) && at !== null) out.push({ stage: e.stage, at }); }
  } else {
    const moves = feedForDeal
      .filter((a) => a?.type === 'stage_advanced')
      .map((a) => ({ m: /stage moved to ([a-z_]+)/i.exec(String(a.description || '')), at: ts(a.timestamp) }))
      .filter((x) => x.m && isDealStage(x.m[1].toLowerCase()) && x.at !== null)
      .map((x) => ({ stage: x.m![1].toLowerCase() as DealStage, at: x.at! }));
    if (moves.length) { source = 'activity_log'; out.push(...moves); }
  }
  out.sort((a, b) => a.at - b.at);
  if (isDealStage(deal.stage) && (!out.length || out[out.length - 1].stage !== deal.stage)) {
    // The current stage is always the last entry. Without a record of when it started: stageEnteredAt, else creation.
    const at = ts(deal.stageEnteredAt) ?? (out.length ? out[out.length - 1].at : created) ?? 0;
    out.push({ stage: deal.stage, at });
  }
  return { entries: out, source };
}

/** When the deal entered its current stage. */
export function enteredCurrentStageAt(deal: any, h: StageHistory): number | null {
  const explicit = ts(deal.stageEnteredAt);
  if (explicit !== null) return explicit;
  let i = h.entries.length - 1;
  if (i < 0 || h.entries[i].stage !== deal.stage) return ts(deal.createdAt);
  while (i > 0 && h.entries[i - 1].stage === deal.stage) i--;
  return h.entries[i].at;
}

/**
 * Index (in OPEN_STAGES) of the furthest open stage a deal reached, or null when unknown.
 * Won deals passed every open stage. Lost deals: the furthest open stage in their history or lostFromStage;
 * a lost deal with no history is unknown (reported, never guessed).
 */
export function furthestStageReached(deal: any, h: StageHistory): number | null {
  if (deal.stage === 'won') return OPEN_STAGES.length - 1;
  const idx = [...h.entries.map((e) => stageIndex(e.stage)), stageIndex(deal.lostFromStage), stageIndex(deal.stage)].filter((i) => i >= 0);
  return idx.length ? Math.max(...idx) : null;
}

/** When a closed deal closed: closedAt, its won/lost history entry, or (older records) its last update. */
export function closedAt(deal: any, h: StageHistory): number | null {
  const explicit = ts(deal.closedAt);
  if (explicit !== null) return explicit;
  if (h.source !== 'none') {
    const e = [...h.entries].reverse().find((x) => x.stage === deal.stage);
    if (e && (e.stage === 'won' || e.stage === 'lost')) return e.at;
  }
  return ts(deal.updatedAt) ?? ts(deal.createdAt);
}

/** Days spent in each open stage by stays that ended (the deal moved on). The current stay is not included. */
export function completedStays(h: StageHistory): Array<{ stage: OpenStage; days: number }> {
  const out: Array<{ stage: OpenStage; days: number }> = [];
  let i = 0;
  while (i < h.entries.length) {
    let j = i; while (j + 1 < h.entries.length && h.entries[j + 1].stage === h.entries[i].stage) j++;
    const next = h.entries[j + 1];
    if (next && stageIndex(h.entries[i].stage) >= 0) out.push({ stage: h.entries[i].stage as OpenStage, days: Math.max(0, (next.at - h.entries[i].at) / DAY) });
    i = j + 1;
  }
  return out;
}

/** Groups organization feed entries by the record they target. */
export function feedByTarget(feed: any[]): Map<string, any[]> {
  const m = new Map<string, any[]>();
  for (const a of feed) if (a?.targetId) { const k = String(a.targetId); const list = m.get(k); if (list) list.push(a); else m.set(k, [a]); }
  return m;
}
