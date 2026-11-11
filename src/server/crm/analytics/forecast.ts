/**
 * Sales forecast: win probability per open deal from the organization's own history, an age penalty for deals
 * stuck in a stage, an expected close month, and per-month commit / best case / pipeline / expected value with an
 * ~80% range. Pure: same deals + same `now` give the same forecast. Formulas: docs/analytics/README.md.
 *
 *   Stage win rate   closed deals that reached or passed the stage: won ÷ closed, smoothed toward the stage's
 *                    default probability p0 with a Beta prior of strength k:  p = (wins + k·p0) / (closed + k).
 *                    Below MIN_STAGE_HISTORY closed deals the default p0 is used as is (and labelled so).
 *   Age penalty      in the stage longer than 2× the typical (median) time: p × max(0.5, 1 − 0.15·(ratio − 2)).
 *   Close month      expectedClose when it is a date; otherwise createdAt + the median sales cycle of won deals
 *                    (default 60 days below 5 won deals), labelled "estimated". Past dates count in this month.
 *   Buckets          commit p ≥ 0.7 · best case p ≥ 0.4 · pipeline all · expected Σ p·v ·
 *                    range Σ p·v ± 1.28·√Σ p(1−p)v² (normal approximation of the Poisson-binomial, ≈80%), floored at 0.
 */
import {
  DAY, OPEN_STAGES, STAGE_LABELS, addMonths, closedAt, completedStays, dateLabel, dealValue, defaultProbability, enteredCurrentStageAt,
  feedByTarget, furthestStageReached, isClosed, isOpen, median, money, monthKey, monthLabel, monthStart, normalizeDeals, plural, round, stageHistory, stageIndex,
  ts, type OpenStage, type StageHistory,
} from './common';

export const PRIOR_STRENGTH = 5;          // k: how many "virtual" deals the default stage rate is worth
export const MIN_STAGE_HISTORY = 5;       // closed deals that reached a stage before the org's own rate is used
export const MIN_STAY_SAMPLES = 3;        // completed stays in a stage before the org's median time is used
export const DEFAULT_STAGE_DAYS: Record<OpenStage, number> = { lead: 14, discovery: 14, qualified: 21, proposal: 14, negotiation: 14 };
export const AGE_THRESHOLD = 2;           // penalty starts beyond 2× the typical time in stage
export const AGE_SLOPE = 0.15;            // −15% per extra multiple of the typical time
export const AGE_FLOOR = 0.5;             // never more than halves the probability
export const DEFAULT_CYCLE_DAYS = 60;     // sales cycle used until MIN_WON_FOR_CYCLE deals are won
export const MIN_WON_FOR_CYCLE = 5;
export const COMMIT_MIN = 0.7;
export const BEST_CASE_MIN = 0.4;
export const Z80 = 1.28;                  // two-sided ~80% normal interval
export const MIN_CLOSED_FOR_CONFIDENCE = 5;

export interface StageModel {
  stage: OpenStage; label: string; defaultProbability: number;
  closedReached: number; wonReached: number; historyRate: number | null;
  probability: number; basisKind: 'history' | 'default';
  typicalDays: number; typicalSource: 'history' | 'default'; samples: number;
}
export interface OrgModel {
  histories: Map<string, StageHistory>;
  stages: Record<OpenStage, StageModel>;
  closedDeals: number; wonDeals: number; unknownLost: number;
  salesCycle: { days: number; source: 'history' | 'default'; wonDeals: number };
}

/** Learns stage win rates, typical time in stage and the sales cycle from the organization's deals. */
export function buildOrgModel(deals: any[], feed: any[] = []): OrgModel {
  const byDeal = feedByTarget(feed);
  const histories = new Map<string, StageHistory>();
  for (const d of deals) histories.set(d.id, stageHistory(d, byDeal.get(String(d.id)) || []));
  const closed = deals.filter(isClosed);
  const won = closed.filter((d) => d.stage === 'won');
  let unknownLost = 0;
  const reach = new Map<string, number>();
  for (const d of closed) {
    const f = furthestStageReached(d, histories.get(d.id)!);
    if (f === null) unknownLost++; else reach.set(d.id, f);
  }
  const stays = new Map<OpenStage, number[]>(OPEN_STAGES.map((s) => [s, []]));
  for (const d of deals) for (const s of completedStays(histories.get(d.id)!)) stays.get(s.stage)!.push(s.days);

  const stages = Object.fromEntries(OPEN_STAGES.map((s, i) => {
    const rows = closed.filter((d) => (reach.get(d.id) ?? -1) >= i);
    const wins = rows.filter((d) => d.stage === 'won').length;
    const p0 = defaultProbability(s);
    const enough = rows.length >= MIN_STAGE_HISTORY;
    const samples = stays.get(s)!;
    const med = samples.length >= MIN_STAY_SAMPLES ? median(samples) : null;
    const m: StageModel = {
      stage: s, label: STAGE_LABELS[s], defaultProbability: p0,
      closedReached: rows.length, wonReached: wins, historyRate: rows.length ? wins / rows.length : null,
      probability: enough ? (wins + PRIOR_STRENGTH * p0) / (rows.length + PRIOR_STRENGTH) : p0,
      basisKind: enough ? 'history' : 'default',
      typicalDays: med !== null ? Math.max(1, med) : DEFAULT_STAGE_DAYS[s], typicalSource: med !== null ? 'history' : 'default', samples: samples.length,
    };
    return [s, m];
  })) as Record<OpenStage, StageModel>;

  const cycles = won.map((d) => { const c = closedAt(d, histories.get(d.id)!), o = ts(d.createdAt); return c !== null && o !== null ? (c - o) / DAY : null; })
    .filter((x): x is number => x !== null && x >= 0);
  const enoughWon = cycles.length >= MIN_WON_FOR_CYCLE;
  return {
    histories, stages, closedDeals: closed.length, wonDeals: won.length, unknownLost,
    salesCycle: { days: enoughWon ? Math.max(1, Math.round(median(cycles)!)) : DEFAULT_CYCLE_DAYS, source: enoughWon ? 'history' : 'default', wonDeals: won.length },
  };
}

export interface AgeInfo { daysInStage: number | null; typicalDays: number; typicalSource: 'history' | 'default'; ratio: number | null; penalized: boolean; multiplier: number; note: string }
export interface CloseInfo { month: string; date: string; estimated: boolean; overdue: boolean; note: string }
export interface DealForecast {
  id: string; name: string; client: string; owner: string; stage: OpenStage; stageLabel: string;
  value: number | null; valueSet: boolean;
  baseProbability: number; probability: number; basisKind: 'history' | 'default'; basis: string;
  age: AgeInfo; expectedClose: CloseInfo; expectedValue: number;
  contactId: string | null; leadId: string | null;
}

/** The age multiplier for a deal that has been in its stage `ratio` × the typical time. */
export function agePenalty(ratio: number | null): number {
  if (ratio === null || ratio <= AGE_THRESHOLD) return 1;
  return Math.max(AGE_FLOOR, 1 - AGE_SLOPE * (ratio - AGE_THRESHOLD));
}

/** expectedClose as a timestamp when it is a real date (YYYY-MM-DD, YYYY-MM or a full ISO time), else null. */
export function parseCloseDate(v: unknown): number | null {
  const s = String(v ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) { const t = Date.parse(s.length === 10 ? `${s}T00:00:00Z` : s); return Number.isFinite(t) ? t : null; }
  if (/^\d{4}-\d{2}$/.test(s)) { const t = Date.parse(`${s}-01T00:00:00Z`); return Number.isFinite(t) ? t : null; }
  return null;
}

const dayStart = (t: number) => { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); };

/** Probability, age and close month for one open deal. */
export function forecastDeal(deal: any, model: OrgModel, now: number): DealForecast {
  const stage = (stageIndex(deal.stage) >= 0 ? deal.stage : 'lead') as OpenStage;
  const sm = model.stages[stage];
  const value = dealValue(deal);
  const pct = (p: number) => `${Math.round(p * 100)}%`;
  const basis = sm.basisKind === 'history'
    ? `Your history (n=${sm.closedReached}): ${sm.wonReached} of ${sm.closedReached} closed deals that reached ${sm.label} were won (${pct(sm.historyRate!)}), blended with the ${pct(sm.defaultProbability)} default → ${pct(sm.probability)}.`
    : `Default stage rate, not enough history (n=${sm.closedReached}; needs ${MIN_STAGE_HISTORY} closed deals that reached ${sm.label}): ${pct(sm.defaultProbability)}.`;

  const h = model.histories.get(deal.id) ?? stageHistory(deal);
  const entered = enteredCurrentStageAt(deal, h);
  const daysInStage = entered !== null ? Math.max(0, (now - entered) / DAY) : null;
  const ratio = daysInStage !== null ? daysInStage / sm.typicalDays : null;
  const multiplier = agePenalty(ratio);
  const typical = `${Math.round(sm.typicalDays)} days (${sm.typicalSource === 'history' ? `your median of ${plural(sm.samples, 'stay')}` : 'default, not enough history'})`;
  const age: AgeInfo = {
    daysInStage: daysInStage !== null ? Math.round(daysInStage) : null, typicalDays: Math.round(sm.typicalDays), typicalSource: sm.typicalSource,
    ratio: ratio !== null ? round(ratio, 1) : null, penalized: multiplier < 1, multiplier: round(multiplier, 2),
    note: daysInStage === null ? 'Time in stage unknown (no dates recorded).'
      : multiplier < 1 ? `In ${sm.label} for ${Math.round(daysInStage)} days, ${round(ratio!, 1)}× the typical ${typical}: probability × ${round(multiplier, 2)}.`
      : `In ${sm.label} for ${Math.round(daysInStage)} days (typical ${typical}).`,
  };
  const probability = sm.probability * multiplier;

  // Expected close month
  const explicit = parseCloseDate(deal.expectedClose);
  const thisMonth = monthStart(now);
  let close: CloseInfo;
  if (explicit !== null) {
    const overdue = explicit < dayStart(now);
    const at = Math.max(explicit, thisMonth);
    close = { month: monthKey(at), date: new Date(explicit).toISOString().slice(0, 10), estimated: false, overdue,
      note: overdue ? `Close date ${dateLabel(explicit)} has passed; counted in this month until it’s updated.` : `Close date ${dateLabel(explicit)}.` };
  } else {
    const created = ts(deal.createdAt) ?? now;
    const est = created + model.salesCycle.days * DAY;
    const label = String(deal.expectedClose || '').trim();
    const why = label ? `The close date “${label.slice(0, 40)}” isn’t a date, so it` : 'No close date set; it';
    const cycle = model.salesCycle.source === 'history' ? `your median sales cycle of ${model.salesCycle.days} days` : `a default ${model.salesCycle.days}-day sales cycle (fewer than ${MIN_WON_FOR_CYCLE} won deals)`;
    close = { month: monthKey(Math.max(est, thisMonth)), date: new Date(est).toISOString().slice(0, 10), estimated: true, overdue: false,
      note: `${why} is estimated: created ${dateLabel(created)} + ${cycle}${est < thisMonth ? '; that date has passed, so it counts in this month' : ''}.` };
  }

  return {
    id: deal.id, name: String(deal.name || deal.client || 'Untitled deal'), client: String(deal.client || ''), owner: String(deal.owner || ''),
    stage, stageLabel: sm.label, value, valueSet: value !== null,
    baseProbability: round(sm.probability, 3), probability: round(probability, 3), basisKind: sm.basisKind, basis,
    age, expectedClose: close, expectedValue: round((value ?? 0) * probability, 2),
    contactId: deal.contactId ?? null, leadId: deal.originLeadId ?? deal.leadId ?? null,
  };
}

export interface Bucket { month: string; label: string; deals: number; noValue: number; commit: number; bestCase: number; pipeline: number; expected: number; low: number; high: number }

/** Sums a set of deals into commit / best case / pipeline / expected and the ~80% range. */
export function bucketOf(rows: DealForecast[], month = '', label = ''): Bucket {
  let commit = 0, best = 0, pipe = 0, exp = 0, variance = 0;
  for (const r of rows) {
    const v = r.value ?? 0, p = r.probability;
    pipe += v; exp += p * v; variance += p * (1 - p) * v * v;
    if (p >= COMMIT_MIN) commit += v;
    if (p >= BEST_CASE_MIN) best += v;
  }
  const sd = Math.sqrt(variance);
  return {
    month, label, deals: rows.length, noValue: rows.filter((r) => !r.valueSet).length,
    commit: Math.round(commit), bestCase: Math.round(best), pipeline: Math.round(pipe), expected: Math.round(exp),
    low: Math.round(Math.max(0, exp - Z80 * sd)), high: Math.round(exp + Z80 * sd),
  };
}

export interface ForecastResult {
  generatedAt: string; months: number; confidence: 'low' | 'medium' | 'high'; notes: string[];
  buckets: Bucket[]; total: Bucket; later: Bucket;
  history: { months: Array<{ month: string; label: string; won: number; deals: number }>; total: number; deals: number };
  model: { priorStrength: number; minStageHistory: number; closedDeals: number; wonDeals: number; unknownLost: number; salesCycle: OrgModel['salesCycle']; stages: StageModel[];
    thresholds: { commit: number; bestCase: number; z: number; ageThreshold: number; ageSlope: number; ageFloor: number } };
  deals: DealForecast[];
  noValue: Array<{ id: string; name: string; stage: string }>;
}

export function buildForecast(allDeals: any[], feed: any[], now: number, opts: { months?: number } = {}): ForecastResult {
  const months = Math.min(12, Math.max(1, Math.round(Number(opts.months) || 3)));
  const deals = normalizeDeals(allDeals);
  const model = buildOrgModel(deals, feed);
  const open = deals.filter(isOpen).map((d) => forecastDeal(d, model, now))
    .sort((a, b) => a.expectedClose.month.localeCompare(b.expectedClose.month) || b.expectedValue - a.expectedValue);

  const start = monthStart(now);
  const keys = Array.from({ length: months }, (_, i) => monthKey(addMonths(start, i)));
  const buckets = keys.map((k) => bucketOf(open.filter((d) => d.expectedClose.month === k), k, monthLabel(k)));
  const inHorizon = open.filter((d) => keys.includes(d.expectedClose.month));
  const total = bucketOf(inHorizon, 'total', `Next ${plural(months, 'month')}`);
  const later = bucketOf(open.filter((d) => !keys.includes(d.expectedClose.month)), 'later', 'Later');

  // Won revenue in the last three full months, for context.
  const histKeys = [3, 2, 1].map((i) => monthKey(addMonths(start, -i)));
  const won = deals.filter((d) => d.stage === 'won' && !d.deletedAt).map((d) => ({ d, at: closedAt(d, model.histories.get(d.id)!) }));
  const hist = histKeys.map((k) => {
    const rows = won.filter((w) => w.at !== null && monthKey(w.at) === k);
    return { month: k, label: monthLabel(k), won: Math.round(rows.reduce((s, w) => s + (dealValue(w.d) ?? 0), 0)), deals: rows.length };
  });

  const notes: string[] = [];
  if (!open.length) notes.push('There are no open deals, so there is nothing to forecast yet.');
  if (model.closedDeals < MIN_CLOSED_FOR_CONFIDENCE) notes.push(`Only ${plural(model.closedDeals, 'closed deal')} so far: every probability is the default rate for its stage until ${MIN_STAGE_HISTORY} closed deals have reached that stage.`);
  else {
    const def = OPEN_STAGES.filter((s) => model.stages[s].basisKind === 'default').map((s) => STAGE_LABELS[s]);
    if (def.length) notes.push(`Not enough closed deals reached ${def.join(', ')} yet: those stages use their default rate.`);
  }
  if (model.salesCycle.source === 'default' && open.some((d) => d.expectedClose.estimated)) notes.push(`Fewer than ${MIN_WON_FOR_CYCLE} won deals: deals without a close date are placed ${model.salesCycle.days} days after they were created (a default cycle).`);
  const est = open.filter((d) => d.expectedClose.estimated).length;
  if (est) notes.push(`${plural(est, 'deal')} ${est === 1 ? 'has' : 'have'} no close date; ${est === 1 ? 'its' : 'their'} month is estimated.`);
  const overdue = open.filter((d) => d.expectedClose.overdue).length;
  if (overdue) notes.push(`${plural(overdue, 'deal')} ${overdue === 1 ? 'is' : 'are'} past ${overdue === 1 ? 'its' : 'their'} close date and counted in this month until updated.`);
  const nv = open.filter((d) => !d.valueSet);
  if (nv.length) notes.push(`${plural(nv.length, 'open deal')} ${nv.length === 1 ? 'has' : 'have'} no value set and count${nv.length === 1 ? 's' : ''} as $0.`);
  const pen = open.filter((d) => d.age.penalized).length;
  if (pen) notes.push(`${plural(pen, 'deal')} ${pen === 1 ? 'has' : 'have'} been in ${pen === 1 ? 'its' : 'their'} stage more than ${AGE_THRESHOLD}× as long as usual; ${pen === 1 ? 'its' : 'their'} probability is reduced.`);
  if (model.unknownLost) notes.push(`${plural(model.unknownLost, 'lost deal')} ${model.unknownLost === 1 ? 'has' : 'have'} no stage history, so ${model.unknownLost === 1 ? 'it isn’t' : 'they aren’t'} used in the stage win rates.`);
  if (later.deals) notes.push(`${plural(later.deals, 'deal')} (${money(later.pipeline)}) ${later.deals === 1 ? 'is' : 'are'} expected after this ${months}-month window.`);

  const confidence: ForecastResult['confidence'] = !open.length || model.closedDeals < MIN_CLOSED_FOR_CONFIDENCE ? 'low'
    : model.closedDeals < 20 || model.wonDeals < MIN_WON_FOR_CYCLE ? 'medium' : 'high';

  return {
    generatedAt: new Date(now).toISOString(), months, confidence, notes, buckets, total, later,
    history: { months: hist, total: hist.reduce((s, m) => s + m.won, 0), deals: hist.reduce((s, m) => s + m.deals, 0) },
    model: {
      priorStrength: PRIOR_STRENGTH, minStageHistory: MIN_STAGE_HISTORY, closedDeals: model.closedDeals, wonDeals: model.wonDeals, unknownLost: model.unknownLost,
      salesCycle: model.salesCycle, stages: OPEN_STAGES.map((s) => ({ ...model.stages[s], probability: round(model.stages[s].probability, 3), historyRate: model.stages[s].historyRate === null ? null : round(model.stages[s].historyRate!, 3), typicalDays: Math.round(model.stages[s].typicalDays) })),
      thresholds: { commit: COMMIT_MIN, bestCase: BEST_CASE_MIN, z: Z80, ageThreshold: AGE_THRESHOLD, ageSlope: AGE_SLOPE, ageFloor: AGE_FLOOR },
    },
    deals: open,
    noValue: nv.map((d) => ({ id: d.id, name: d.name, stage: d.stageLabel })),
  };
}
