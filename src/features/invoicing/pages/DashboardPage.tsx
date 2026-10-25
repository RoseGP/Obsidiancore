import React, { useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, BarChart3, CircleDollarSign, Clock, CreditCard, FilePlus2, FileText, UserPlus, Wallet } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatMoney, formatMoneyCompact, minorToDecimalString } from '../domain/money';
import {
  collectedIn, invoicedIn, monthlySeries, otherCurrencyCount, outstandingAt, pctChange, periodRange,
  PERIOD_LABELS, type MonthPoint, type Period,
} from '../domain/metrics';
import { useBillingData } from '../state/BillingStore';
import { useNav, useQuickActions } from '../state/navigation';
import { InvoiceFiltersBar, InvoiceTable, applyFilters, emptyFilters } from '../components/InvoiceTable';
import { SummaryCard } from '../ui/data';
import { Button, SectionCard, SegmentedControl, Select } from '../ui/primitives';

function ChartTooltip({ active, payload, currency }: any) {
  if (!active || !payload?.length) return null;
  const p: MonthPoint & { full: string } = payload[0].payload;
  const rate = p.invoiced > 0n ? Number((p.collected * 1000n) / p.invoiced) / 10 : null;
  return (
    <div className="inv-pop px-3 py-2.5 text-[12.5px]" style={{ minWidth: 180 }}>
      <p className="mb-1.5 font-semibold">{p.full}</p>
      <p className="flex items-center justify-between gap-4"><span className="flex items-center gap-1.5 inv-muted"><span className="h-2 w-2 rounded-sm" style={{ background: 'var(--inv-chart-a)' }} />Invoiced</span><span className="num font-semibold">{formatMoney(p.invoiced, currency)}</span></p>
      <p className="mt-1 flex items-center justify-between gap-4"><span className="flex items-center gap-1.5 inv-muted"><span className="h-2 w-2 rounded-sm" style={{ background: 'var(--inv-chart-b)' }} />Collected</span><span className="num font-semibold">{formatMoney(p.collected, currency)}</span></p>
      {rate !== null && <p className="inv-faint mt-1.5 num">{rate.toFixed(1)}% of invoiced amount collected</p>}
    </div>
  );
}

function RevenueChart() {
  const { views, data, today } = useBillingData();
  const [range, setRange] = useState<'6' | '12' | 'ytd'>('12');
  const currency = data.settings.defaultCurrency;
  const months = range === 'ytd' ? Number(today.slice(5, 7)) : Number(range);
  const fullFmt = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' });
  const series = useMemo(() => monthlySeries(views, data.payments, months, today, currency).map((p) => ({
    ...p,
    full: fullFmt.format(new Date(Number(p.key.slice(0, 4)), Number(p.key.slice(5)) - 1, 1)),
    invoicedNum: Number(minorToDecimalString(p.invoiced, currency)),
    collectedNum: Number(minorToDecimalString(p.collected, currency)),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  })), [views, data.payments, months, today, currency]);
  const totInv = series.reduce((a, p) => a + p.invoiced, 0n);
  const totCol = series.reduce((a, p) => a + p.collected, 0n);
  const empty = totInv === 0n && totCol === 0n;

  return (
    <SectionCard
      id="inv-revenue"
      title="Invoiced vs collected"
      description={`${formatMoney(totInv, currency)} invoiced · ${formatMoney(totCol, currency)} collected`}
      actions={<SegmentedControl<"6" | "12" | "ytd"> label="Chart range" value={range} onChange={setRange} options={[{ value: '6', label: '6M' }, { value: '12', label: '12M' }, { value: 'ytd', label: 'YTD' }]} />}
      bodyClassName="p-3 pt-4 @xl:p-5"
    >
      <div className="mb-2 flex items-center gap-4 px-2 text-[12px] inv-muted" aria-hidden>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: 'var(--inv-chart-a)' }} />Invoiced</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: 'var(--inv-chart-b)' }} />Collected</span>
      </div>
      {empty ? (
        <div className="inv-muted flex h-[260px] items-center justify-center text-[13px]">No invoices issued in this range yet.</div>
      ) : (
        <div className="h-[260px] w-full" role="img" aria-label={`Bar chart of invoiced and collected amounts per month, ${series[0]?.full} to ${series[series.length - 1]?.full}`}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={series} barGap={3} barCategoryGap="22%" margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--inv-border)" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: 'var(--inv-faint)', fontSize: 11.5 }} interval="preserveStartEnd" minTickGap={8} />
              <YAxis tickLine={false} axisLine={false} width={56} tick={{ fill: 'var(--inv-faint)', fontSize: 11.5 }}
                tickFormatter={(v: number) => formatMoneyCompact(BigInt(Math.round(v * 100)), currency)} />
              <Tooltip cursor={{ fill: 'var(--inv-surface-3)' }} content={<ChartTooltip currency={currency} />} />
              <Bar dataKey="invoicedNum" name="Invoiced" fill="var(--inv-chart-a)" radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} />
              <Bar dataKey="collectedNum" name="Collected" fill="var(--inv-chart-b)" radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      <table className="sr-only-inv">
        <caption>Monthly invoiced and collected amounts</caption>
        <thead><tr><th>Month</th><th>Invoiced</th><th>Collected</th></tr></thead>
        <tbody>{series.map((p) => <tr key={p.key}><td>{p.full}</td><td>{formatMoney(p.invoiced, currency)}</td><td>{formatMoney(p.collected, currency)}</td></tr>)}</tbody>
      </table>
    </SectionCard>
  );
}

function QuickActions() {
  const { navigate } = useNav();
  const { openClientDialog, openPaymentDialog } = useQuickActions();
  const { views, data } = useBillingData();
  const overdue = views.filter((v) => v.status === 'overdue');
  const overdueAmt = overdue.reduce((a, v) => a + v.totals.balanceDue, 0n);
  const actions = [
    { label: 'Create invoice', body: 'Bill a client for work or products', icon: FilePlus2, onClick: () => navigate({ name: 'invoice-new' }), primary: true },
    { label: 'Add client', body: 'Save billing details for reuse', icon: UserPlus, onClick: () => openClientDialog() },
    { label: 'Record payment', body: 'Apply money you’ve received', icon: CreditCard, onClick: () => openPaymentDialog() },
    { label: 'View reports', body: 'Aging and revenue by client', icon: BarChart3, onClick: () => navigate({ name: 'reports' }) },
  ];
  return (
    <SectionCard id="inv-quick" title="Quick actions" bodyClassName="p-3">
      <ul className="grid gap-1">
        {actions.map((a) => (
          <li key={a.label}>
            <button type="button" onClick={a.onClick} className="inv-menu-item items-center gap-3 rounded-xl p-2.5">
              <span className="flex h-9 w-9 flex-none items-center justify-center rounded-lg" style={{ background: a.primary ? 'var(--inv-primary)' : 'var(--inv-surface-2)', color: a.primary ? '#fff' : 'var(--inv-muted)', border: a.primary ? 0 : '1px solid var(--inv-border)' }}>
                <a.icon size={17} aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{a.label}</span>
                <span className="inv-muted block text-[12px]">{a.body}</span>
              </span>
              <ArrowRight size={15} className="inv-faint" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
      {overdue.length > 0 && (
        <button type="button" onClick={() => navigate({ name: 'invoices', status: 'overdue' })} className="mt-2 flex w-full items-center gap-3 rounded-xl p-3 text-left text-[13px]" style={{ background: 'var(--inv-danger-tint)', border: 0, font: 'inherit', color: 'inherit', cursor: 'pointer' }}>
          <AlertTriangle size={16} style={{ color: 'var(--inv-danger)' }} aria-hidden />
          <span className="flex-1"><b>{overdue.length} overdue</b> <span className="inv-muted">· {formatMoney(overdueAmt, data.settings.defaultCurrency)} to chase</span></span>
          <ArrowRight size={15} className="inv-faint" aria-hidden />
        </button>
      )}
    </SectionCard>
  );
}

export function DashboardPage() {
  const { views, data, today, status } = useBillingData();
  const { navigate } = useNav();
  const [period, setPeriod] = useState<Period>('month');
  const [filters, setFilters] = useState(emptyFilters);
  const currency = data.settings.defaultCurrency;
  const { current, previous, compareLabel } = periodRange(period, today);

  const metrics = useMemo(() => {
    const inv = invoicedIn(views, current, currency);
    const invPrev = invoicedIn(views, previous, currency);
    const paid = collectedIn(data.payments, views, current, currency);
    const paidPrev = collectedIn(data.payments, views, previous, currency);
    const out = outstandingAt(views, current.end, currency);
    const outPrev = outstandingAt(views, previous.end, currency);
    const od = outstandingAt(views, current.end, currency, true);
    const odPrev = outstandingAt(views, previous.end, currency, true);
    return { inv, invPrev, paid, paidPrev, out, outPrev, od, odPrev };
  }, [views, data.payments, current.start, current.end, previous.start, previous.end, currency]); // eslint-disable-line react-hooks/exhaustive-deps

  const others = otherCurrencyCount(views, currency);
  const filtered = applyFilters(views, filters, today);
  const m = (v: bigint) => formatMoney(v, currency);
  const loading = status === 'loading';

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 p-4 @3xl:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="inv-h2">Here’s where your billing stands</p>
          <p className="inv-muted text-[13px]">
            {PERIOD_LABELS[period]} · amounts in {currency}{others > 0 ? ` (${others} invoice${others === 1 ? '' : 's'} in other currencies not included)` : ''}
          </p>
        </div>
        <Select aria-label="Reporting period" inputSize="sm" value={period} onChange={(v) => setPeriod(v as Period)} containerClassName="w-[170px]"
          options={Object.entries(PERIOD_LABELS).map(([value, label]) => ({ value, label }))} />
      </div>

      <div className="grid grid-cols-1 gap-4 @xl:grid-cols-2 @5xl:grid-cols-4">
        <SummaryCard label="Total invoiced" icon={<FileText size={16} />} value={m(metrics.inv)} loading={loading}
          delta={{ pct: pctChange(metrics.inv, metrics.invPrev), goodWhen: 'up' }} caption={compareLabel} />
        <SummaryCard label="Total paid" icon={<CircleDollarSign size={16} />} value={m(metrics.paid)} loading={loading}
          delta={{ pct: pctChange(metrics.paid, metrics.paidPrev), goodWhen: 'up' }} caption={compareLabel} />
        <SummaryCard label="Outstanding balance" icon={<Wallet size={16} />} value={m(metrics.out)} loading={loading}
          delta={{ pct: pctChange(metrics.out, metrics.outPrev), goodWhen: 'down' }} caption={compareLabel.replace('vs', 'vs balance at')}
          onClick={() => navigate({ name: 'invoices' })} />
        <SummaryCard label="Overdue balance" icon={<Clock size={16} />} value={m(metrics.od)} loading={loading}
          delta={{ pct: pctChange(metrics.od, metrics.odPrev), goodWhen: 'down' }} caption={compareLabel.replace('vs', 'vs balance at')}
          onClick={() => navigate({ name: 'invoices', status: 'overdue' })} />
      </div>

      <div className="grid grid-cols-1 gap-4 @5xl:grid-cols-[minmax(0,1fr)_340px]">
        <RevenueChart />
        <QuickActions />
      </div>

      <SectionCard
        id="inv-recent"
        title="Recent invoices"
        actions={<Button size="sm" variant="ghost" onClick={() => navigate({ name: 'invoices' })}>View all <ArrowRight size={14} /></Button>}
        bodyClassName="p-0"
      >
        <div className="px-4 pt-4 pb-3 @3xl:px-5">
          <InvoiceFiltersBar value={filters} onChange={setFilters} />
        </div>
        <InvoiceTable rows={filtered} pageSize={6} compact filters={filters} onClearFilters={() => setFilters(emptyFilters())} />
      </SectionCard>
    </div>
  );
}
