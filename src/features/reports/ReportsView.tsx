/**
 * Reports & Analytics: sales forecast, pipeline health, deal next-best-actions, customer segments and lead source
 * conversion, all computed on the server from the organization's own records (GET /api/reports/*).
 * Every figure has a "How this is calculated" disclosure; empty data shows an empty state, never a made-up number.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight, BarChart3, Clock, Filter, Gauge, Lightbulb, RefreshCw, Target, TrendingUp, Users } from 'lucide-react';
import { Badge, Button, Card, CardHeader, EmptyState, InfoTip, Segmented, Skeleton, cx, focusRing } from '../../components/dashboard/ui';

// ---------------------------------------------------------------- API shapes (see src/server/crm/analytics)
interface Bucket { month: string; label: string; deals: number; noValue: number; commit: number; bestCase: number; pipeline: number; expected: number; low: number; high: number }
interface StageModel { stage: string; label: string; defaultProbability: number; closedReached: number; wonReached: number; historyRate: number | null; probability: number; basisKind: 'history' | 'default'; typicalDays: number; typicalSource: 'history' | 'default'; samples: number }
interface DealForecast {
  id: string; name: string; client: string; stageLabel: string; value: number | null; valueSet: boolean; probability: number; baseProbability: number; basis: string; basisKind: string;
  age: { daysInStage: number | null; typicalDays: number; penalized: boolean; multiplier: number; note: string };
  expectedClose: { month: string; date: string; estimated: boolean; overdue: boolean; note: string }; expectedValue: number;
}
export interface ForecastData {
  months: number; confidence: 'low' | 'medium' | 'high'; notes: string[]; buckets: Bucket[]; total: Bucket; later: Bucket;
  history: { months: Array<{ month: string; label: string; won: number; deals: number }>; total: number; deals: number };
  model: { priorStrength: number; minStageHistory: number; closedDeals: number; wonDeals: number; unknownLost: number; salesCycle: { days: number; source: string; wonDeals: number }; stages: StageModel[];
    thresholds: { commit: number; bestCase: number; z: number; ageThreshold: number; ageSlope: number; ageFloor: number } };
  deals: DealForecast[]; noValue: Array<{ id: string; name: string; stage: string }>;
}
export interface PipelineData {
  stages: Array<{ stage: string; label: string; open: number; openValue: number; movedOn: number; advanced: number; conversion: number | null; typicalDays: number; typicalSource: string; samples: number }>;
  stale: Array<{ id: string; name: string; client: string; stage: string; daysInStage: number; typicalDays: number; ratio: number; value: number | null }>;
  sources: Array<{ source: string; label: string; leads: number; converted: number; conversion: number | null; wonDeals: number; wonValue: number; smallSample: boolean }>;
  notes: string[];
}
interface Action { type: string; label: string; reason: string; urgency: number }
export interface DealActionsData { deals: Array<{ dealId: string; name: string; client: string; owner: string; stage: string; value: number | null; probability: number; expectedValue: number; urgency: number; priority: number; actions: Action[]; primary: Action }>; typicalValue: number | null; notes: string[] }
interface Member { id: string; type: 'contact' | 'company'; name: string; email: string; company: string; recencyDays: number; frequency: number; monetary: number; r: number; f: number; m: number; segment: string; reason: string }
interface Band { score: number; min: number; max: number; customers: number }
export interface SegmentsData {
  currency: string; customers: number; prospects: number; method: 'quintiles' | 'fixed';
  thresholds: { explanation: string; recency: Band[]; frequency: Band[]; monetary: Band[]; medianMonetary: number | null };
  segments: Array<{ id: string; label: string; rule: string; count: number; members: Member[]; truncated: boolean }>;
  unmatched: { deals: number; invoices: number }; notes: string[];
}

// ---------------------------------------------------------------- helpers
const usd = (n: number, currency = 'USD') => new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);
const pct = (p: number | null) => (p === null ? '—' : `${Math.round(p * 100)}%`);

function useReport<T>(url: string) {
  const [s, setS] = useState<{ data: T | null; loading: boolean; error: string | null }>({ data: null, loading: true, error: null });
  const load = useCallback(async () => {
    setS((p) => ({ ...p, loading: true, error: null }));
    try {
      const r = await fetch(url);
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d.success === false) throw Object.assign(new Error('failed'), { status: r.status });
      setS({ data: d as T, loading: false, error: null });
    } catch (e: any) {
      setS({ data: null, loading: false, error: e?.status === 403 ? 'Your role can’t view reports. Ask an admin for access.' : e?.status === 401 ? 'Sign in to see reports.' : 'This report couldn’t load. Try again.' });
    }
  }, [url]);
  useEffect(() => { void load(); }, [load]);
  return { ...s, reload: load };
}

function How({ children }: { children: React.ReactNode }) {
  return (
    <details className="rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface-sunken)] px-3 py-2 text-[12px] leading-relaxed text-[var(--text-muted)]">
      <summary className={cx('cursor-pointer select-none font-medium text-[var(--text)] rounded', focusRing)}>How this is calculated</summary>
      <div className="mt-2 space-y-1.5">{children}</div>
    </details>
  );
}

function SectionStatus({ loading, error, onRetry, rows = 3 }: { loading: boolean; error: string | null; onRetry: () => void; rows?: number }) {
  if (error) return (
    <div role="alert" className="mx-5 mb-5 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[var(--danger-soft)] px-4 py-3 text-[13px] text-[var(--danger)]">
      <span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4" aria-hidden="true" />{error}</span>
      <Button size="sm" variant="secondary" onClick={onRetry}>Try again</Button>
    </div>
  );
  if (loading) return <div className="px-5 pb-5 space-y-2" aria-busy="true" aria-label="Loading">{Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>;
  return null;
}

function Notes({ notes }: { notes: string[] }) {
  if (!notes.length) return null;
  return <ul className="space-y-1 text-[12px] text-[var(--text-muted)] list-disc pl-5">{notes.map((n) => <li key={n}>{n}</li>)}</ul>;
}

function Tile({ label, value, sub, tip }: { label: string; value: string; sub?: string; tip: string }) {
  return (
    <div className="min-w-0 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-3">
      <span className="flex items-center gap-1 text-[12px] text-[var(--text-muted)]">{label}<InfoTip text={tip} /></span>
      <span className="block text-[20px] font-semibold text-[var(--text)] tabular-nums truncate">{value}</span>
      {sub && <span className="block text-[11px] text-[var(--text-subtle)]">{sub}</span>}
    </div>
  );
}

const CONFIDENCE: Record<ForecastData['confidence'], { tone: 'warning' | 'info' | 'success'; label: string; tip: string }> = {
  low: { tone: 'warning', label: 'Low confidence', tip: 'No open deals, or fewer than 5 closed deals to learn from: treat these numbers as a rough guide.' },
  medium: { tone: 'info', label: 'Medium confidence', tip: 'Some history (5–19 closed deals, or fewer than 5 won): probabilities partly use default stage rates.' },
  high: { tone: 'success', label: 'High confidence', tip: '20+ closed deals and 5+ won: probabilities and the sales cycle come from your own history.' },
};

// ---------------------------------------------------------------- page
export default function ReportsView({ onNavigate }: { onNavigate?: (view: string) => void }) {
  const [months, setMonths] = useState<'3' | '6' | '12'>('3');
  const forecast = useReport<ForecastData>(`/api/reports/forecast?months=${months}`);
  const pipeline = useReport<PipelineData>('/api/reports/pipeline');
  const actions = useReport<DealActionsData>('/api/reports/deal-actions');
  const segments = useReport<SegmentsData>('/api/reports/segments');
  const busy = forecast.loading || pipeline.loading || actions.loading || segments.loading;
  const refresh = () => { void forecast.reload(); void pipeline.reload(); void actions.reload(); void segments.reload(); };
  const openDeal = (id: string) => {
    try { const u = new URL(window.location.href); u.searchParams.set('deal', id); window.history.replaceState(null, '', u.toString()); } catch { /* ignore */ }
    onNavigate?.('deals');
  };

  return (
    <div className="mx-auto w-full max-w-[1440px] px-4 sm:px-6 lg:px-8 py-5 sm:py-7 space-y-5 text-[var(--text)]" id="analytics-workspace-root">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[var(--cc-cyan)]"><BarChart3 className="h-3.5 w-3.5" aria-hidden="true" />Reports</p>
          <h1 className="mt-1 text-[26px] sm:text-[30px] font-semibold tracking-[-0.03em] cc-title">Reports &amp; Analytics</h1>
          <p className="mt-1 text-[14px] text-[var(--text-muted)] max-w-2xl">Forecast, pipeline health, next actions on deals and customer segments, from your own records. Open “How this is calculated” under any section for the formula.</p>
        </div>
        <Button variant="secondary" icon={<RefreshCw className={cx('h-4 w-4', busy && 'animate-spin')} />} onClick={refresh} disabled={busy}>Refresh</Button>
      </header>

      <ForecastSection r={forecast} months={months} setMonths={setMonths} onOpenDeal={openDeal} />
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <DealActionsSection r={actions} onOpenDeal={openDeal} />
        <PipelineSection r={pipeline} onOpenDeal={openDeal} />
      </div>
      <SegmentsSection r={segments} />
      <SourcesSection r={pipeline} />
    </div>
  );
}

type R<T> = { data: T | null; loading: boolean; error: string | null; reload: () => Promise<void> };

// ---------------------------------------------------------------- forecast
function ForecastSection({ r, months, setMonths, onOpenDeal }: { r: R<ForecastData>; months: '3' | '6' | '12'; setMonths: (m: '3' | '6' | '12') => void; onOpenDeal: (id: string) => void }) {
  const f = r.data;
  const conf = f ? CONFIDENCE[f.confidence] : null;
  const max = f ? Math.max(1, ...f.buckets.map((b) => Math.max(b.pipeline, b.high))) : 1;
  const t = f?.model.thresholds;
  return (
    <Card aria-labelledby="rep-forecast">
      <CardHeader id="rep-forecast" title="Sales forecast" icon={<TrendingUp className="h-4 w-4" />}
        subtitle={f ? `Next ${f.months} months · probabilities from your own win history` : 'Expected revenue from open deals'}
        actions={<>
          {conf && <span className="inline-flex items-center gap-0.5"><Badge tone={conf.tone}><Gauge className="h-3 w-3" aria-hidden="true" />{conf.label}</Badge><InfoTip text={conf.tip} label="About this confidence level" /></span>}
          <Segmented size="sm" label="Forecast months" value={months} onChange={setMonths} options={[{ value: '3', label: '3 mo' }, { value: '6', label: '6 mo' }, { value: '12', label: '12 mo' }]} />
        </>} />
      <SectionStatus loading={r.loading && !f} error={r.error} onRetry={() => void r.reload()} rows={4} />
      {f && (
        <div className="px-5 pb-5 space-y-4">
          {!f.deals.length ? (
            <EmptyState icon={<TrendingUp className="h-4 w-4" />} title="No open deals to forecast" body="Add deals to your pipeline: the forecast appears as soon as there is something open." />
          ) : (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Tile label="Expected" value={usd(f.total.expected)} sub={`80% range ${usd(f.total.low)}–${usd(f.total.high)}`} tip="Sum of probability × value for deals expected to close in this window. The range is ± 1.28 standard deviations (about 80% likely)." />
                <Tile label="Commit" value={usd(f.total.commit)} sub={`Deals at ${pct(t!.commit)}+`} tip={`Total value of deals with a probability of ${pct(t!.commit)} or more.`} />
                <Tile label="Best case" value={usd(f.total.bestCase)} sub={`Deals at ${pct(t!.bestCase)}+`} tip={`Commit plus deals with a probability of ${pct(t!.bestCase)} or more.`} />
                <Tile label="Pipeline" value={usd(f.total.pipeline)} sub={`${f.total.deals} deal${f.total.deals === 1 ? '' : 's'}${f.total.noValue ? `, ${f.total.noValue} without a value` : ''}`} tip="Total value of every open deal expected to close in this window. Deals without a value count as $0." />
              </div>

              <ul className="space-y-2" aria-label="Forecast by month">
                {[...f.buckets, ...(f.later.deals ? [f.later] : [])].map((b) => (
                  <li key={b.month} className="rounded-[var(--radius-card)] border border-[var(--border)] p-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                      <span className="text-[13px] font-semibold">{b.month === 'later' ? `After ${f.buckets[f.buckets.length - 1]?.label ?? 'this window'}` : b.label}</span>
                      <span className="text-[11px] text-[var(--text-subtle)]">{b.deals ? `${b.deals} deal${b.deals === 1 ? '' : 's'}${b.noValue ? ` · ${b.noValue} without a value` : ''}` : 'No deals expected to close'}</span>
                    </div>
                    {b.deals > 0 && (
                      <>
                        <div className="relative mt-2 h-2.5 rounded-full bg-[var(--surface-sunken)] overflow-hidden" aria-hidden="true">
                          <span className="absolute inset-y-0 left-0 bg-[var(--border-strong)] opacity-60" style={{ width: `${(b.pipeline / max) * 100}%` }} />
                          <span className="absolute inset-y-0 left-0 bg-[var(--accent-soft)]" style={{ width: `${(b.bestCase / max) * 100}%` }} />
                          <span className="absolute inset-y-0 left-0 bg-[var(--accent)]" style={{ width: `${(b.commit / max) * 100}%` }} />
                          <span className="absolute inset-y-0 bg-[var(--cc-cyan)] opacity-40" style={{ left: `${(b.low / max) * 100}%`, width: `${Math.max(0.5, ((b.high - b.low) / max) * 100)}%` }} />
                          <span className="absolute inset-y-0 w-0.5 bg-[var(--text)]" style={{ left: `${Math.min(99.5, (b.expected / max) * 100)}%` }} />
                        </div>
                        <dl className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1 text-[12px]">
                          <div><dt className="text-[var(--text-subtle)]">Commit</dt><dd className="font-semibold tabular-nums">{usd(b.commit)}</dd></div>
                          <div><dt className="text-[var(--text-subtle)]">Best case</dt><dd className="font-semibold tabular-nums">{usd(b.bestCase)}</dd></div>
                          <div><dt className="text-[var(--text-subtle)]">Expected</dt><dd className="font-semibold tabular-nums">{usd(b.expected)} <span className="font-normal text-[var(--text-subtle)]">({usd(b.low)}–{usd(b.high)})</span></dd></div>
                          <div><dt className="text-[var(--text-subtle)]">Pipeline</dt><dd className="font-semibold tabular-nums">{usd(b.pipeline)}</dd></div>
                        </dl>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}

          <p className="text-[12px] text-[var(--text-muted)]">
            {f.history.deals
              ? <>For comparison, you won <strong className="text-[var(--text)] tabular-nums">{usd(f.history.total)}</strong> in the last 3 full months ({f.history.months.map((m) => `${m.label.split(' ')[0]} ${usd(m.won)}`).join(' · ')}).</>
              : `No deals were won in the last 3 full months (${f.history.months.map((m) => m.label.split(' ')[0]).join(', ')}), so there is no recent result to compare with. This month's wins count from next month.`}
          </p>
          <Notes notes={f.notes} />

          {f.deals.length > 0 && (
            <details className="rounded-[var(--radius-control)] border border-[var(--border)] px-3 py-2 text-[12px]">
              <summary className={cx('cursor-pointer select-none font-medium rounded', focusRing)}>Deals in this forecast ({f.deals.length})</summary>
              <ul className="mt-2 divide-y divide-[var(--border)]">
                {f.deals.map((d) => (
                  <li key={d.id} className="py-2 space-y-0.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <button type="button" onClick={() => onOpenDeal(d.id)} className={cx('min-w-0 truncate text-left font-medium text-[var(--accent-text)] hover:underline cursor-pointer rounded', focusRing)}>{d.name}</button>
                      <span className="tabular-nums text-[var(--text-muted)]">{d.stageLabel} · {d.valueSet ? usd(d.value!) : 'No value set'} · {pct(d.probability)}</span>
                    </div>
                    <p className="text-[var(--text-muted)]">{d.basis}{d.age.penalized ? ` ${d.age.note}` : ''}</p>
                    <p className="text-[var(--text-subtle)]">{d.expectedClose.estimated && <Badge className="mr-1">Estimated</Badge>}{d.expectedClose.overdue && <Badge tone="warning" className="mr-1">Close date passed</Badge>}{d.expectedClose.note}</p>
                  </li>
                ))}
              </ul>
            </details>
          )}

          <How>
            <p><strong>Win probability per deal.</strong> For each stage: of your closed deals that reached or passed it, the share that was won, blended with the stage’s default rate: p = (wins + {f.model.priorStrength}·default) ÷ (closed + {f.model.priorStrength}). Until {f.model.minStageHistory} closed deals have reached a stage, its default rate is used as is.</p>
            <ul className="space-y-0.5">
              {f.model.stages.map((s) => (
                <li key={s.stage}>{s.label}: {pct(s.probability)} {s.basisKind === 'history' ? `(your history: ${s.wonReached} won of ${s.closedReached})` : `(default ${pct(s.defaultProbability)}; ${s.closedReached} closed so far)`}; typical time {s.typicalDays} days {s.typicalSource === 'history' ? `(median of ${s.samples})` : '(default)'}</li>
              ))}
            </ul>
            <p><strong>Age penalty.</strong> A deal in its stage longer than {t?.ageThreshold}× the typical time gets probability × max({t?.ageFloor}, 1 − {t?.ageSlope}·(ratio − {t?.ageThreshold})).</p>
            <p><strong>Close month.</strong> The deal’s close date when it is a date. Otherwise created date + {f.model.salesCycle.source === 'history' ? `your median sales cycle (${f.model.salesCycle.days} days)` : `a default ${f.model.salesCycle.days}-day cycle (fewer than 5 won deals)`}, marked “Estimated”. Past dates count in the current month.</p>
            <p><strong>Buckets.</strong> Commit: deals at {pct(t?.commit ?? 0.7)}+. Best case: commit plus deals at {pct(t?.bestCase ?? 0.4)}+. Pipeline: all deals. Expected: Σ probability × value. Range: expected ± {t?.z}·√Σ p(1−p)·value², floored at $0 (about 80%).</p>
            <p><strong>Confidence.</strong> Low with no open deals or under 5 closed deals; high with 20+ closed and 5+ won; medium in between. Based on {f.model.closedDeals} closed and {f.model.wonDeals} won deals.</p>
          </How>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- deal actions
function DealActionsSection({ r, onOpenDeal }: { r: R<DealActionsData>; onOpenDeal: (id: string) => void }) {
  const [all, setAll] = useState(false);
  const d = r.data;
  const rows = d ? (all ? d.deals : d.deals.slice(0, 8)) : [];
  return (
    <Card aria-labelledby="rep-actions">
      <CardHeader id="rep-actions" title="Deal actions" icon={<Lightbulb className="h-4 w-4" />} subtitle="What to do next on open deals, most valuable first" />
      <SectionStatus loading={r.loading && !d} error={r.error} onRetry={() => void r.reload()} />
      {d && (
        <div className="px-5 pb-5 space-y-3">
          {!d.deals.length ? (
            <EmptyState icon={<Lightbulb className="h-4 w-4" />} title="Nothing to act on" body={d.notes[0] || 'Every open deal has a follow-up, a current close date and a normal time in stage.'} />
          ) : (
            <ul className="space-y-2" aria-label="Deal actions">
              {rows.map((a) => (
                <li key={a.dealId}>
                  <button type="button" onClick={() => onOpenDeal(a.dealId)} className={cx('w-full text-left rounded-[var(--radius-card)] border border-[var(--border)] p-3 hover:border-[var(--border-strong)] hover:bg-[var(--surface-sunken)] cursor-pointer', focusRing)} aria-label={`${a.primary.label}: ${a.name}. Open in the pipeline`}>
                    <span className="flex flex-wrap items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-[13px] font-semibold">{a.name}</span>
                      <span className="text-[11px] text-[var(--text-subtle)] tabular-nums">{a.stage} · {a.value !== null ? usd(a.value) : 'No value set'} · {pct(a.probability)}</span>
                    </span>
                    <span className="mt-1 flex items-center gap-1.5 text-[12px] font-medium text-[var(--accent-text)]"><ArrowRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{a.primary.label}</span>
                    <span className="block text-[12px] text-[var(--text-muted)]">{a.primary.reason}</span>
                    {a.actions.length > 1 && <span className="mt-1.5 flex flex-wrap gap-1">{a.actions.slice(1).map((x) => <Badge key={x.type} tone={x.urgency >= 2.5 ? 'warning' : 'neutral'}>{x.label}</Badge>)}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {d.deals.length > 8 && <Button size="sm" variant="ghost" onClick={() => setAll((x) => !x)}>{all ? 'Show fewer' : `Show all ${d.deals.length}`}</Button>}
          <Notes notes={d.deals.length ? d.notes : d.notes.slice(1)} />
          <How>
            <p>Each open deal is checked against five rules. Each rule that applies is listed with its reason; the most urgent one is shown first.</p>
            <ul className="space-y-0.5 list-disc pl-5">
              <li>Close date passed → update it or mark the deal lost (urgency 3).</li>
              <li>In Proposal with no proposal sent → send one (2.5).</li>
              <li>In its stage more than 2× the typical time → check in or re-qualify (2).</li>
              <li>Worth 2× your typical open deal{d.typicalValue ? ` (${usd(d.typicalValue)})` : ''} with no activity for 14+ days → re-engage (2).</li>
              <li>No open task on the deal, its lead or contact → schedule a follow-up (1.5).</li>
            </ul>
            <p>Order: priority = expected value (probability × value, from the forecast) × the highest urgency. Deals without a value have an expected value of $0, so they come last.</p>
          </How>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- pipeline health
function PipelineSection({ r, onOpenDeal }: { r: R<PipelineData>; onOpenDeal: (id: string) => void }) {
  const p = r.data;
  const hasDeals = !!p && p.stages.some((s) => s.open || s.movedOn);
  return (
    <Card aria-labelledby="rep-pipeline">
      <CardHeader id="rep-pipeline" title="Pipeline health" icon={<Filter className="h-4 w-4" />} subtitle="How deals move through each stage, and which are stuck" />
      <SectionStatus loading={r.loading && !p} error={r.error} onRetry={() => void r.reload()} />
      {p && (
        <div className="px-5 pb-5 space-y-3">
          {!hasDeals ? (
            <EmptyState icon={<Filter className="h-4 w-4" />} title="No deals yet" body="Stage conversion and time in stage appear once deals move through the pipeline." />
          ) : (
            <ul className="divide-y divide-[var(--border)] rounded-[var(--radius-card)] border border-[var(--border)]" aria-label="Stages">
              {p.stages.map((s) => (
                <li key={s.stage} className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-0.5 px-3 py-2 text-[12px]">
                  <span className="font-semibold text-[13px]">{s.label}</span>
                  <span className="text-right sm:text-left tabular-nums text-[var(--text-muted)]">{s.open} open · {usd(s.openValue)}</span>
                  <span className="tabular-nums">{s.conversion === null ? <span className="text-[var(--text-subtle)]">No moves yet</span> : <>{pct(s.conversion)} moved on <span className="text-[var(--text-subtle)]">({s.advanced} of {s.movedOn})</span></>}</span>
                  <span className="text-right sm:text-left tabular-nums text-[var(--text-muted)]"><Clock className="inline h-3 w-3 mr-0.5" aria-hidden="true" />{s.typicalDays} days {s.typicalSource === 'history' ? 'median' : '(default)'}</span>
                </li>
              ))}
            </ul>
          )}
          {p.stale.length > 0 && (
            <div>
              <h3 className="text-[12px] font-semibold mb-1">Stuck deals ({p.stale.length})</h3>
              <ul className="space-y-1">
                {p.stale.slice(0, 6).map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 text-[12px]">
                    <button type="button" onClick={() => onOpenDeal(s.id)} className={cx('min-w-0 truncate font-medium text-[var(--accent-text)] hover:underline cursor-pointer rounded', focusRing)}>{s.name}</button>
                    <span className="tabular-nums text-[var(--text-muted)]">{s.stage}: {s.daysInStage} days, {s.ratio}× the usual {s.typicalDays}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <Notes notes={p.notes} />
          <How>
            <p><strong>Moved on.</strong> Of the deals that reached a stage and have since left it (moved to a later stage, won or lost), the share that went further. Deals still in the stage aren’t counted yet. Stage history is recorded on every stage change; older deals use the activity log.</p>
            <p><strong>Typical days.</strong> The median time deals spent in the stage before moving, once 3 deals have left it; otherwise a default (14 days, 21 for Qualified).</p>
            <p><strong>Stuck.</strong> Open deals in their stage more than 2× the typical time. Their forecast probability is reduced by the age penalty.</p>
            <p><strong>Open.</strong> Number and total value of open deals in the stage right now (deals without a value count as $0).</p>
          </How>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- segments
const SEG_TONE: Record<string, 'success' | 'accent' | 'info' | 'warning' | 'danger' | 'neutral'> = { champions: 'success', loyal: 'accent', promising: 'info', needs_attention: 'warning', at_risk: 'danger', hibernating: 'neutral' };

function SegmentsSection({ r }: { r: R<SegmentsData> }) {
  const s = r.data;
  const [sel, setSel] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const firstNonEmpty = s?.segments.find((x) => x.count)?.id ?? null;
  const active = s?.segments.find((x) => x.id === (sel ?? firstNonEmpty)) || null;
  const members = active ? (more ? active.members : active.members.slice(0, 12)) : [];
  const cur = s?.currency || 'USD';
  const range = (b: Band, f: (n: number) => string) => (b.customers ? (b.min === b.max ? f(b.min) : `${f(b.min)}–${f(b.max)}`) : '—');
  return (
    <Card aria-labelledby="rep-segments">
      <CardHeader id="rep-segments" title="Customer segments" icon={<Users className="h-4 w-4" />} subtitle="Recency, frequency and value of purchases (won deals and paid invoices)"
        actions={s && s.customers > 0 ? <Badge tone="neutral">{s.method === 'quintiles' ? 'Quintile scores' : 'Fixed thresholds'}</Badge> : undefined} />
      <SectionStatus loading={r.loading && !s} error={r.error} onRetry={() => void r.reload()} />
      {s && (
        <div className="px-5 pb-5 space-y-4">
          {!s.customers ? (
            <EmptyState icon={<Users className="h-4 w-4" />} title="No customers to segment yet" body={`Customers appear once deals are won or invoices are paid.${s.prospects ? ` ${s.prospects} contact${s.prospects === 1 ? ' is a prospect' : 's are prospects'} for now.` : ''}`} />
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2" role="group" aria-label="Segments">
                {s.segments.map((g) => {
                  const on = active?.id === g.id;
                  return (
                    <button key={g.id} type="button" aria-pressed={on} onClick={() => { setSel(g.id); setMore(false); }} title={g.rule}
                      className={cx('text-left rounded-[var(--radius-card)] border p-2.5 cursor-pointer transition-colors', focusRing, on ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-[var(--border)] hover:bg-[var(--surface-sunken)]')}>
                      <span className="block text-[11px] text-[var(--text-muted)] truncate">{g.label}</span>
                      <span className="block text-[20px] font-semibold tabular-nums">{g.count}</span>
                    </button>
                  );
                })}
                <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--border)] p-2.5">
                  <span className="flex items-center gap-1 text-[11px] text-[var(--text-muted)]">Prospects<InfoTip text="Contacts with no won deal or paid invoice. They are counted but not scored." /></span>
                  <span className="block text-[20px] font-semibold tabular-nums">{s.prospects}</span>
                </div>
              </div>
              {active && (
                <div>
                  <p className="text-[12px] text-[var(--text-muted)] mb-2"><Badge tone={SEG_TONE[active.id]}>{active.label}</Badge> {active.rule}</p>
                  {!active.count ? <p className="text-[12px] text-[var(--text-subtle)]">No customers in this segment.</p> : (
                    <ul className="divide-y divide-[var(--border)] rounded-[var(--radius-card)] border border-[var(--border)]" aria-label={`${active.label} customers`}>
                      {members.map((m) => (
                        <li key={`${m.type}:${m.id}`} className="px-3 py-2 text-[12px] space-y-0.5">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="min-w-0 truncate font-medium text-[13px]">{m.name}{m.type === 'company' && <Badge className="ml-1.5">Company</Badge>}</span>
                            <span className="tabular-nums text-[var(--text-muted)]">R{m.r} F{m.f} M{m.m}</span>
                          </div>
                          <p className="text-[var(--text-muted)]">{m.reason}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                  {active.members.length > 12 && <Button size="sm" variant="ghost" onClick={() => setMore((x) => !x)}>{more ? 'Show fewer' : `Show all ${active.members.length}${active.truncated ? ` of ${active.count}` : ''}`}</Button>}
                </div>
              )}
            </>
          )}
          <Notes notes={s.notes} />
          <How>
            <p><strong>Customers.</strong> A contact with at least one won deal or fully paid invoice. Purchases are matched to contacts the way the contact profile matches records (contact link, the lead the deal came from, email, invoicing client); purchases with no person are grouped by company.</p>
            <p><strong>R</strong> = days since the last purchase, <strong>F</strong> = number of purchases, <strong>M</strong> = their total value ({cur}; invoices in other currencies are left out).</p>
            <p>{s.thresholds.explanation}</p>
            {s.customers > 0 && (
              <ul className="space-y-0.5">
                {[5, 4, 3, 2, 1].map((score, i) => (
                  <li key={score} className="tabular-nums">Score {score}: recency {range(s.thresholds.recency[i], (n) => `${n} d`)} · frequency {range(s.thresholds.frequency[i], String)} · value {range(s.thresholds.monetary[i], (n) => usd(n, cur))}</li>
                ))}
              </ul>
            )}
            <ul className="space-y-0.5 list-disc pl-5">{s.segments.map((g) => <li key={g.id}><strong>{g.label}:</strong> {g.rule}</li>)}</ul>
            <p>Last activity (timeline, inbox, WhatsApp/SMS) is a second signal: it can move a customer into At risk (quiet for 90+ days) or Needs attention (in touch in the last 30 days).</p>
          </How>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- lead sources
function SourcesSection({ r }: { r: R<PipelineData> }) {
  const p = r.data;
  return (
    <Card aria-labelledby="rep-sources">
      <CardHeader id="rep-sources" title="Lead source conversion" icon={<Target className="h-4 w-4" />} subtitle="Which channels turn leads into deals and revenue" />
      <SectionStatus loading={r.loading && !p} error={r.error} onRetry={() => void r.reload()} rows={2} />
      {p && (
        <div className="px-5 pb-5 space-y-3">
          {!p.sources.length ? (
            <EmptyState icon={<Target className="h-4 w-4" />} title="No leads yet" body="Conversion by source appears once leads arrive from your forms, chat, calls or your team." />
          ) : (
            <ul className="divide-y divide-[var(--border)] rounded-[var(--radius-card)] border border-[var(--border)]" aria-label="Lead sources">
              {p.sources.map((s) => (
                <li key={s.source} className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-0.5 px-3 py-2 text-[12px]">
                  <span className="font-semibold text-[13px]">{s.label}{s.smallSample && <Badge className="ml-1.5">Small sample</Badge>}</span>
                  <span className="text-right sm:text-left tabular-nums text-[var(--text-muted)]">{s.leads} lead{s.leads === 1 ? '' : 's'}</span>
                  <span className="tabular-nums">{pct(s.conversion)} converted <span className="text-[var(--text-subtle)]">({s.converted})</span></span>
                  <span className="text-right sm:text-left tabular-nums text-[var(--text-muted)]">{s.wonDeals} won · {usd(s.wonValue)}</span>
                </li>
              ))}
            </ul>
          )}
          <How>
            <p><strong>Converted</strong> = leads from the source that became a deal ÷ all leads from the source. <strong>Won</strong> = deals created from those leads that are marked won, and their total value. Sources with fewer than 5 leads are marked as a small sample. Lead counts by source over time are on the dashboard.</p>
          </How>
        </div>
      )}
    </Card>
  );
}
