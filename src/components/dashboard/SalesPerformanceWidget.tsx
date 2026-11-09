import React, { useState, useEffect } from 'react';
import { getDashboardJson, invalidateDashboard } from '../../lib/dashboardData';
import { ArrowUpRight } from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid
} from 'recharts';

type Timeframe = '7D' | '30D' | 'QTD';
interface Deal { id: string; name?: string; value?: number; stage?: string; owner?: string; createdAt?: string; updatedAt?: string }

const DAY = 86_400_000;
const money = (n: number) => `$${Math.round(n).toLocaleString()}`;
/** When a deal was closed: the last stage change (deals record updatedAt when moved to Won). */
const closedAt = (d: Deal) => new Date(d.updatedAt || d.createdAt || 0).getTime();

/** Start of the window and its chart buckets (oldest first). */
function buckets(tf: Timeframe, now = new Date()): { start: number; list: Array<{ name: string; from: number; to: number }> } {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (tf === '7D') {
    const list = Array.from({ length: 7 }, (_, k) => {
      const from = today - (6 - k) * DAY;
      return { name: new Date(from).toLocaleDateString(undefined, { weekday: 'short' }), from, to: from + DAY };
    });
    return { start: list[0].from, list };
  }
  if (tf === '30D') {
    const start = today - 27 * DAY;
    const list = Array.from({ length: 4 }, (_, k) => ({ name: `Week ${k + 1}`, from: start + k * 7 * DAY, to: start + (k + 1) * 7 * DAY }));
    return { start, list };
  }
  const q = Math.floor(now.getMonth() / 3) * 3;
  const list = [0, 1, 2].map((k) => {
    const from = new Date(now.getFullYear(), q + k, 1).getTime();
    return { name: new Date(from).toLocaleDateString(undefined, { month: 'short' }), from, to: new Date(now.getFullYear(), q + k + 1, 1).getTime() };
  });
  return { start: list[0].from, list };
}

const initials = (name: string) => name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || '?';

export const SalesPerformanceWidget: React.FC<{ onNavigate?: (view: any) => void }> = ({ onNavigate }) => {
  const [timeframe, setTimeframe] = useState<Timeframe>('30D');
  const [deals, setDeals] = useState<Deal[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    getDashboardJson('/api/dashboard/deals')
      .then((data: any) => {
        if (data.success && Array.isArray(data.deals)) setDeals(data.deals);
        else setLoadError(true);
      })
      .catch(() => setLoadError(true));
  }, []);

  // Everything below is computed from this organization's deals. "Closed" means moved to the Won stage.
  const { list, start } = buckets(timeframe);
  const wonInWindow = (deals || []).filter((d) => d.stage === 'won' && closedAt(d) >= start);
  const lostInWindow = (deals || []).filter((d) => d.stage === 'lost' && closedAt(d) >= start);
  const closedRevenue = wonInWindow.reduce((sum, d) => sum + (Number(d.value) || 0), 0);
  const chartData = list.map((b) => ({
    name: b.name,
    revenue: wonInWindow.filter((d) => closedAt(d) >= b.from && closedAt(d) < b.to).reduce((sum, d) => sum + (Number(d.value) || 0), 0),
  }));
  const avgDeal = wonInWindow.length ? closedRevenue / wonInWindow.length : null;
  const decided = wonInWindow.length + lostInWindow.length;
  const winRate = decided ? Math.round((wonInWindow.length / decided) * 1000) / 10 : null;
  const cycleDays = wonInWindow.filter((d) => d.createdAt).map((d) => Math.max(0, (closedAt(d) - new Date(d.createdAt!).getTime()) / DAY));
  const avgCycle = cycleDays.length ? Math.round(cycleDays.reduce((a, b) => a + b, 0) / cycleDays.length) : null;

  const ownerMap = new Map<string, { deals: number; revenue: number }>();
  for (const d of wonInWindow) {
    const owner = d.owner || 'Unassigned';
    const o = ownerMap.get(owner) || { deals: 0, revenue: 0 };
    o.deals += 1; o.revenue += Number(d.value) || 0;
    ownerMap.set(owner, o);
  }
  const topClosers = [...ownerMap.entries()].map(([name, o]) => ({ name, ...o })).sort((a, b) => b.revenue - a.revenue).slice(0, 3);
  const windowLabel = timeframe === '7D' ? 'last 7 days' : timeframe === '30D' ? 'last 4 weeks' : 'this quarter';

  return (
    <div className="h-full flex flex-col justify-between">
      <div>
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-white tracking-tight">Sales performance</span>
              <span className="text-[10px] font-mono font-bold text-emerald-400 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                {wonInWindow.length} won
              </span>
            </div>
            <p className="text-xs text-neutral-400 mt-0.5">
              Revenue from deals marked Won, {windowLabel}.
            </p>
          </div>

          {/* Timeframe Selector Pills */}
          <div className="flex items-center gap-1 p-1 bg-black/40 border border-white/5 rounded-xl">
            {(['7D', '30D', 'QTD'] as const).map(tf => (
              <button
                key={tf}
                type="button"
                onClick={() => setTimeframe(tf)}
                className={`px-2.5 py-1 rounded-lg text-xs font-mono font-semibold transition-colors cursor-pointer ${
                  timeframe === tf
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'text-neutral-400 hover:text-white'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>
        </div>

        {/* Closed revenue summary */}
        <div className="mb-4 p-3.5 rounded-xl bg-black/30 border border-white/5 space-y-2">
          <div className="flex items-center justify-between text-xs font-mono">
            <span className="text-neutral-400">Closed revenue</span>
            <span className="text-white font-bold tabular-nums">
              {deals === null ? (loadError ? '—' : '…') : money(closedRevenue)}
            </span>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-x-3 text-[10px] text-neutral-500 font-mono pt-0.5">
            <span>Avg deal: {avgDeal == null ? '—' : money(avgDeal)}</span>
            <span>Sales cycle: {avgCycle == null ? '—' : `${avgCycle} day${avgCycle === 1 ? '' : 's'}`}</span>
            <span>Win rate: {winRate == null ? '—' : `${winRate}%`}</span>
          </div>
        </div>

        {/* Revenue Chart */}
        <div className="h-44 w-full mb-4 relative">
          {loadError ? (
            <div className="h-full flex items-center justify-center text-xs text-neutral-500">Couldn’t load deals. Try again later.</div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366F1" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#6366F1" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
                  <XAxis dataKey="name" stroke="#ffffff40" fontSize={11} tickLine={false} />
                  <YAxis stroke="#ffffff40" fontSize={11} tickLine={false} allowDecimals={false} tickFormatter={(val) => (val >= 1000 ? `$${Math.round(val / 1000)}k` : `$${val}`)} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#0E1017',
                      border: '1px solid rgba(255,255,255,0.15)',
                      borderRadius: '12px',
                      boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
                      fontSize: '12px',
                      color: '#ffffff'
                    }}
                    formatter={(val: any) => [`$${Number(val).toLocaleString()}`, 'Closed']}
                  />
                  <Area
                    type="monotone"
                    dataKey="revenue"
                    name="Closed revenue"
                    stroke="#6366F1"
                    strokeWidth={2.5}
                    fillOpacity={1}
                    fill="url(#revenueGradient)"
                  />
                </AreaChart>
              </ResponsiveContainer>
              {deals !== null && wonInWindow.length === 0 && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <span className="text-xs text-neutral-400 bg-black/60 px-3 py-1.5 rounded-lg">No deals won in the {windowLabel}</span>
                </div>
              )}
            </>
          )}
        </div>

        {/* Top closers (from Won deals in this window) */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-[11px] text-neutral-400 font-mono px-1">
            <span>Top closers</span>
            <span>Closed revenue</span>
          </div>

          {topClosers.length === 0 ? (
            <p className="px-1 text-[11px] text-neutral-500">Nobody has closed a deal in the {windowLabel} yet.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {topClosers.map((rep, idx) => (
                <div
                  key={rep.name}
                  className="p-2.5 rounded-xl bg-white/[0.02] border border-white/5 flex items-center justify-between gap-2"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[10px] font-mono text-neutral-500 font-bold">#{idx + 1}</span>
                    <span className="h-6 w-6 rounded-full border border-white/10 shrink-0 bg-slate-700 text-[9px] font-bold text-slate-200 flex items-center justify-center">
                      {initials(rep.name)}
                    </span>
                    <div className="min-w-0">
                      <span className="text-xs font-bold text-white block truncate">{rep.name}</span>
                      <span className="text-[10px] text-neutral-500 font-mono">{rep.deals} deal{rep.deals === 1 ? '' : 's'}</span>
                    </div>
                  </div>

                  <span className="text-xs font-bold text-emerald-400 font-mono shrink-0 tabular-nums">
                    {money(rep.revenue)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="mt-3 pt-3 border-t border-white/5 flex items-center justify-between text-xs text-neutral-400">
        <span className="font-mono text-[10px]">{decided ? `${wonInWindow.length} won · ${lostInWindow.length} lost` : 'No deals closed in this period'}</span>
        <button
          type="button"
          onClick={() => onNavigate && onNavigate('deals')}
          className="text-indigo-400 hover:text-indigo-300 text-xs font-semibold flex items-center gap-1 cursor-pointer transition-colors"
        >
          <span>View pipeline</span>
          <ArrowUpRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
};

export default SalesPerformanceWidget;
