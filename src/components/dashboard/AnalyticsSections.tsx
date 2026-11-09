/**
 * Dashboard analytics: KPI cards, performance over time, pipeline by stage and lead sources.
 * All figures come from lib/dashboardMetrics (computed from the organization's records).
 */
import React, { useMemo, useState } from 'react';
import {
  Area, AreaChart, CartesianGrid, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { BarChart3, CircleDollarSign, Filter, LineChart, PieChart, Target, Ticket, TrendingUp, UserPlus, Users } from 'lucide-react';
import {
  type DashboardData, type Kpi, type ResolvedRange, formatValue, leadSources, performanceSeries, pipelineByStage,
} from '../../lib/dashboardMetrics';
import { Badge, Card, CardHeader, EmptyState, InfoTip, Segmented, Skeleton, Sparkline, TrendBadge, cx, focusRing } from './ui';

const KPI_ICONS: Record<Kpi['id'], React.ComponentType<{ className?: string }>> = {
  new_leads: UserPlus, pipeline_added: CircleDollarSign, won_revenue: TrendingUp,
  win_rate: Target, lead_conversion: Users, open_tickets: Ticket,
};

export function KpiGrid({ kpis, range, loading, onOpen }: { kpis: Kpi[]; range: ResolvedRange; loading: boolean; onOpen: (view: string) => void }) {
  if (loading && !kpis.length) {
    return (
      <div className="@container">
      <div className="grid grid-cols-2 @[600px]:grid-cols-3 @[930px]:grid-cols-6 gap-2.5 sm:gap-3" aria-busy="true" aria-label="Loading key figures">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i} as="div" className="p-4 space-y-3"><Skeleton className="h-3 w-24" /><Skeleton className="h-7 w-20" /><Skeleton className="h-8 w-full" /></Card>
        ))}
      </div>
      </div>
    );
  }
  return (
    <div className="@container">
    <ul className="grid grid-cols-2 @[600px]:grid-cols-3 @[930px]:grid-cols-6 gap-2.5 sm:gap-3" aria-label="Key figures">
      {kpis.map((k) => {
        const Icon = KPI_ICONS[k.id];
        const points = k.id === 'win_rate' || k.id === 'lead_conversion';
        const trendTone = k.changePct === null || Math.abs(k.changePct) < 0.5 ? 'muted' : (k.changePct > 0) === k.higherIsBetter ? 'success' : 'danger';
        return (
          <li key={k.id}>
            <Card as="div" className="@container/kpi group relative h-full p-3.5 sm:p-4 flex flex-col gap-2 hover:shadow-md hover:border-[var(--border-strong)]">
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2 text-[12px] font-medium text-[var(--text-muted)]">
                  <span className="hidden @[170px]/kpi:flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--accent-soft)] text-[var(--accent-text)]" aria-hidden="true"><Icon className="h-3.5 w-3.5" /></span>
                  <span className="truncate">{k.label}</span>
                </span>
                <InfoTip text={k.hint} label={`How "${k.label}" is calculated`} />
              </div>
              <button
                type="button"
                onClick={() => onOpen(k.view)}
                className={cx('text-left rounded-md -mx-1 px-1', focusRing)}
                aria-label={`${k.label}: ${formatValue(k.value, k.format)}. Open details`}
              >
                <span className="block text-[24px] leading-tight font-semibold tracking-[-0.02em] text-[var(--text)] tabular-nums">{formatValue(k.value, k.format)}</span>
              </button>
              <TrendBadge change={k.changePct} higherIsBetter={k.id === 'open_tickets' ? false : k.higherIsBetter} points={points} compareLabel="" />
              <div className="mt-auto pt-1"><Sparkline values={k.series} tone={trendTone as any} /></div>
              {k.secondary && <p className="text-[11px] text-[var(--text-subtle)] truncate" title={k.secondary}>{k.secondary}</p>}
            </Card>
          </li>
        );
      })}
    </ul>
    </div>
  );
}

type Metric = 'leads' | 'deals' | 'won';
const METRICS: { value: Metric; label: string }[] = [
  { value: 'leads', label: 'New leads' }, { value: 'deals', label: 'Deals created' }, { value: 'won', label: 'Won revenue' },
];

export function PerformanceCard({ data, range, loading }: { data: DashboardData; range: ResolvedRange; loading: boolean }) {
  const [metric, setMetric] = useState<Metric>('leads');
  const [compare, setCompare] = useState(true);
  const rows = useMemo(() => {
    const cur = performanceSeries(data, range);
    const prevRange = { ...range, start: range.prevStart, end: range.prevEnd };
    const prev = performanceSeries(data, prevRange as ResolvedRange);
    return cur.map((c, i) => ({ ...c, previous: prev[i]?.[metric] ?? 0, value: c[metric] }));
  }, [data, range, metric]);
  const total = rows.reduce((s, r) => s + r.value, 0);
  const prevTotal = rows.reduce((s, r) => s + r.previous, 0);
  const isMoney = metric === 'won';
  const fmt = (v: number) => (isMoney ? formatValue(v, 'currency') : Math.round(v).toLocaleString());

  return (
    <Card aria-labelledby="perf-title" className="flex flex-col">
      <CardHeader
        id="perf-title"
        title="Performance over time"
        icon={<LineChart className="h-4 w-4" />}
        subtitle={<>{range.label}: <strong className="text-[var(--text)] font-semibold">{fmt(total)}</strong>{compare && <> · previous period {fmt(prevTotal)}</>}</>}
        actions={<Segmented label="Metric" size="sm" value={metric} options={METRICS} onChange={setMetric} />}
      />
      <div className="px-2 sm:px-4 pb-2 h-[260px]">
        {loading && !rows.length ? <Skeleton className="h-full w-full" /> : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="perfFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.22} />
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--text-subtle)' }} tickLine={false} axisLine={false} minTickGap={24} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--text-subtle)' }} tickLine={false} axisLine={false} width={isMoney ? 56 : 32} allowDecimals={false} tickFormatter={(v) => (isMoney ? formatValue(v, 'currency') : String(v))} />
              <Tooltip
                cursor={{ stroke: 'var(--border-strong)' }}
                content={({ active, payload, label }) => active && payload?.length ? (
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-[12px] shadow-lg">
                    <p className="font-medium text-[var(--text)] mb-1">{label}</p>
                    <p className="text-[var(--text-muted)]"><span className="inline-block h-2 w-2 rounded-full bg-[var(--accent)] mr-1.5" />This period: <strong className="text-[var(--text)]">{fmt(Number(payload[0]?.payload?.value) || 0)}</strong></p>
                    {compare && <p className="text-[var(--text-muted)]"><span className="inline-block h-2 w-2 rounded-full bg-[var(--text-subtle)] mr-1.5" />Previous: {fmt(Number(payload[0]?.payload?.previous) || 0)}</p>}
                  </div>
                ) : null}
              />
              <Area type="monotone" dataKey="value" name="This period" stroke="var(--accent)" strokeWidth={2} fill="url(#perfFill)" activeDot={{ r: 4 }} isAnimationActive={false} />
              {compare && <Line type="monotone" dataKey="previous" name="Previous period" stroke="var(--text-subtle)" strokeWidth={1.5} strokeDasharray="4 4" dot={false} isAnimationActive={false} />}
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
      <div className="px-5 pb-4 flex flex-wrap items-center justify-between gap-2 text-[11px] text-[var(--text-muted)]">
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded bg-[var(--accent)]" aria-hidden="true" />This period</span>
          {compare && <span className="flex items-center gap-1.5"><span className="h-0 w-4 border-t border-dashed border-[var(--text-subtle)]" aria-hidden="true" />Previous period</span>}
        </span>
        <label className="flex items-center gap-1.5 cursor-pointer select-none">
          <input type="checkbox" className="h-3.5 w-3.5 accent-[var(--accent)]" checked={compare} onChange={(e) => setCompare(e.target.checked)} />
          Compare with previous period
        </label>
      </div>
    </Card>
  );
}

export function PipelineCard({ data, loading, onOpen }: { data: DashboardData; loading: boolean; onOpen: () => void }) {
  const [by, setBy] = useState<'value' | 'count'>('value');
  const stages = useMemo(() => pipelineByStage(data.deals), [data.deals]);
  const max = Math.max(1, ...stages.map((s) => (by === 'value' ? s.value : s.count)));
  const totalValue = stages.reduce((s, x) => s + x.value, 0);
  const totalCount = stages.reduce((s, x) => s + x.count, 0);
  return (
    <Card aria-labelledby="pipe-title" className="flex flex-col">
      <CardHeader
        id="pipe-title" title="Open pipeline by stage" icon={<BarChart3 className="h-4 w-4" />}
        subtitle={totalCount ? `${formatValue(totalValue, 'currency')} across ${totalCount} open deal${totalCount === 1 ? '' : 's'}` : 'Right now, all open deals'}
        actions={<Segmented label="Measure" size="sm" value={by} onChange={setBy} options={[{ value: 'value', label: 'Value' }, { value: 'count', label: 'Count' }]} />}
      />
      <div className="px-5 pb-5 flex-1">
        {loading && !data.deals.length ? <div className="space-y-3">{stages.map((s) => <Skeleton key={s.stage} className="h-6 w-full" />)}</div>
          : !totalCount ? <EmptyState icon={<BarChart3 className="h-4 w-4" />} title="No open deals" body="Create a deal to see your pipeline here." />
          : (
            <ol className="space-y-3">
              {stages.map((s, i) => {
                const v = by === 'value' ? s.value : s.count;
                return (
                  <li key={s.stage}>
                    <div className="flex items-center justify-between text-[12px] mb-1">
                      <span className="font-medium text-[var(--text)]">{s.label}</span>
                      <span className="text-[var(--text-muted)] tabular-nums">{s.count} · {formatValue(s.value, 'currency')}</span>
                    </div>
                    <div className="h-2 rounded-full bg-[var(--surface-sunken)] overflow-hidden" role="img" aria-label={`${s.label}: ${s.count} deals, ${formatValue(s.value, 'currency')}`}>
                      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${(v / max) * 100}%`, background: 'var(--accent)', opacity: 0.45 + (i / stages.length) * 0.55 }} />
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
      </div>
      <div className="px-5 pb-4"><button type="button" onClick={onOpen} className={cx('text-[12px] font-medium text-[var(--accent-text)] hover:underline', focusRing)}>Open pipeline →</button></div>
    </Card>
  );
}

export function LeadSourcesCard({ data, range, loading, onOpen }: { data: DashboardData; range: ResolvedRange; loading: boolean; onOpen: () => void }) {
  const sources = useMemo(() => leadSources(data.leads, range), [data.leads, range]);
  const total = sources.reduce((s, x) => s + x.count, 0);
  return (
    <Card aria-labelledby="src-title" className="flex flex-col">
      <CardHeader id="src-title" title="Lead sources" icon={<PieChart className="h-4 w-4" />} subtitle={total ? `${total} lead${total === 1 ? '' : 's'} · ${range.label.toLowerCase()}` : range.label} />
      <div className="px-5 pb-5 flex-1">
        {loading && !data.leads.length ? <div className="space-y-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-5 w-full" />)}</div>
          : !total ? <EmptyState icon={<Filter className="h-4 w-4" />} title="No new leads in this period" body="Try a longer date range, or add a lead." />
          : (
            <ul className="space-y-2.5">
              {sources.slice(0, 6).map((s) => (
                <li key={s.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
                  <span className="text-[12px] text-[var(--text)] truncate">{s.label}</span>
                  <span className="text-[12px] text-[var(--text-muted)] tabular-nums">{s.count} <span className="text-[var(--text-subtle)]">({Math.round(s.pct)}%)</span></span>
                  <div className="col-span-2 h-1.5 rounded-full bg-[var(--surface-sunken)] overflow-hidden" aria-hidden="true">
                    <div className="h-full rounded-full bg-[var(--info)] transition-[width] duration-500" style={{ width: `${s.pct}%` }} />
                  </div>
                </li>
              ))}
              {sources.length > 6 && <li><Badge>+{sources.length - 6} more sources</Badge></li>}
            </ul>
          )}
      </div>
      <div className="px-5 pb-4"><button type="button" onClick={onOpen} className={cx('text-[12px] font-medium text-[var(--accent-text)] hover:underline', focusRing)}>View leads →</button></div>
    </Card>
  );
}

