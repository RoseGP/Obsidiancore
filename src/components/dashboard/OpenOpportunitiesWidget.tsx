import React, { useState, useEffect } from 'react';
import { getDashboardJson, invalidateDashboard } from '../../lib/dashboardData';
import { 
  DollarSign, ArrowUpRight, Flame, 
  ChevronRight, RefreshCw, AlertCircle
} from 'lucide-react';

export interface OpportunityItem {
  id: string;
  name: string;
  client: string;
  value: number;
  stage: 'lead' | 'discovery' | 'qualified' | 'proposal' | 'negotiation' | 'won' | 'lost';
  probability: number;
  expectedClose: string;
  momentum: 'hot' | 'steady' | 'stagnant';
  channelOrigin?: string;
  owner: string;
}

// The server's pipeline stages (see PROBABILITY in src/routes/dashboardApi.ts), in order.
const STAGE_CONFIG = [
  { id: 'lead', label: 'Lead', color: 'bg-slate-500' },
  { id: 'discovery', label: 'Discovery', color: 'bg-neutral-500' },
  { id: 'qualified', label: 'Qualified', color: 'bg-indigo-500' },
  { id: 'proposal', label: 'Proposal', color: 'bg-purple-500' },
  { id: 'negotiation', label: 'Negotiation', color: 'bg-amber-500' }
];
const NEXT_STAGE: Record<string, string> = { lead: 'discovery', discovery: 'qualified', qualified: 'proposal', proposal: 'negotiation', negotiation: 'won' };
const PROBABILITY: Record<string, number> = { lead: 20, discovery: 30, qualified: 50, proposal: 70, negotiation: 85, won: 100, lost: 0 };
const initials = (name: string) => (name || '?').split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || '?';

export const OpenOpportunitiesWidget: React.FC<{ onNavigate?: (view: any) => void }> = ({ onNavigate }) => {
  const [selectedStage, setSelectedStage] = useState<string>('all');
  const [allDeals, setAllDeals] = useState<OpportunityItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [advancingId, setAdvancingId] = useState<string | null>(null);

  const fetchDeals = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data: any = await getDashboardJson('/api/dashboard/deals');
      if (data.success && Array.isArray(data.deals)) {
        const normalized = data.deals.map((d: any, idx: number) => ({
          ...d,
          id: String(d.id || `deal-${idx}-${d.client || 'client'}`)
        }));
        setAllDeals(normalized);
      } else {
        throw new Error(data.error || 'Failed to fetch deals');
      }
    } catch (err: any) {
      console.error('[OpenOpportunitiesWidget] Error:', err);
      setError(err.message || 'Error connecting to opportunities store.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchDeals();
  }, []);

  const opportunities = allDeals.filter((d) => d.stage !== 'won' && d.stage !== 'lost');
  const wonCount = allDeals.filter((d) => d.stage === 'won').length;
  const lostCount = allDeals.filter((d) => d.stage === 'lost').length;
  const winRate = wonCount + lostCount ? Math.round((wonCount / (wonCount + lostCount)) * 100) : null;
  const totalValue = opportunities.reduce((acc, curr) => acc + curr.value, 0);
  const weightedValue = opportunities.reduce((acc, curr) => acc + (curr.value * curr.probability / 100), 0);

  // Compute live stage counts and stage values
  const stageStats = STAGE_CONFIG.map(st => {
    const matching = opportunities.filter(o => o.stage === st.id);
    const count = matching.length;
    const value = matching.reduce((sum, o) => sum + o.value, 0);
    return { ...st, count, value };
  });

  const filtered = selectedStage === 'all' 
    ? opportunities 
    : opportunities.filter(o => o.stage === selectedStage);

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(val);
  };

  const advanceStage = async (opp: OpportunityItem) => {
    const next = NEXT_STAGE[opp.stage];
    if (!next) return;
    setAdvancingId(opp.id);
    setError(null);
    try {
      const res = await fetch(`/api/dashboard/deals/${encodeURIComponent(opp.id)}/stage`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage: next })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'Couldn’t move the deal to the next stage.');
      const now = new Date().toISOString();
      setAllDeals(prev => prev.map(o => o.id === opp.id ? { ...o, stage: next as OpportunityItem['stage'], probability: PROBABILITY[next], updatedAt: now } as OpportunityItem : o));
      invalidateDashboard();
    } catch (err: any) {
      setError(err.message || 'Couldn’t move the deal to the next stage.');
    } finally {
      setAdvancingId(null);
    }
  };

  return (
    <div className="h-full flex flex-col justify-between">
      <div>
        {/* Header & KPI Metrics */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-white tracking-tight">Open Opportunities</span>
              <span className="text-[10px] font-mono font-bold text-indigo-400 px-2 py-0.5 rounded-full bg-indigo-500/10 border border-indigo-500/20">
                {opportunities.length} open deal{opportunities.length === 1 ? '' : 's'}
              </span>
            </div>
            <p className="text-xs text-neutral-400 mt-0.5">
              Pipeline volume, weighted forecast, and closing probability.
            </p>
          </div>

          <div className="flex items-center gap-4 text-xs font-mono">
            <div>
              <span className="text-[10px] text-neutral-500 block">Total Pipeline</span>
              <span className="font-bold text-white tabular-nums">{formatCurrency(totalValue)}</span>
            </div>
            <div className="h-6 w-px bg-white/10" />
            <div>
              <span className="text-[10px] text-neutral-500 block">Weighted Forecast</span>
              <span className="font-bold text-emerald-400 tabular-nums">{formatCurrency(weightedValue)}</span>
            </div>
            <button
              onClick={fetchDeals}
              disabled={isLoading}
              className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-neutral-400 hover:text-white transition"
              title="Refresh Deals"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin text-indigo-400' : ''}`} />
            </button>
          </div>
        </div>

        {/* Funnel Stage Progress Strip */}
        <div className="mb-4 p-3 rounded-xl bg-black/30 border border-white/5 space-y-2">
          <div className="flex items-center justify-between text-[11px] text-neutral-400 font-mono">
            <span>Pipeline by stage</span>
            <span className="text-indigo-400 font-bold" title="Won ÷ (won + lost), all time">{winRate == null ? 'Win rate: —' : `${winRate}% win rate`}</span>
          </div>

          {/* Progress Multi-Bar */}
          <div className="h-2 w-full bg-white/5 rounded-full overflow-hidden flex gap-0.5">
            {stageStats.map(st => (
              <div 
                key={st.id} 
                className={`${st.color} h-full transition-all cursor-pointer`}
                style={{ width: `${totalValue > 0 ? (st.value / totalValue) * 100 : 100 / STAGE_CONFIG.length}%` }}
                title={`${st.label}: ${formatCurrency(st.value)} (${st.count} deals)`}
                onClick={() => setSelectedStage(selectedStage === st.id ? 'all' : st.id)}
              />
            ))}
          </div>

          {/* Stage Labels Buttons */}
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <button
              onClick={() => setSelectedStage('all')}
              className={`px-2 py-0.5 rounded-md text-[10px] font-mono transition-colors cursor-pointer ${
                selectedStage === 'all' ? 'bg-white/20 text-white font-bold' : 'text-neutral-400 hover:text-white'
              }`}
            >
              All Stages
            </button>
            {stageStats.map(st => (
              <button
                key={st.id}
                onClick={() => setSelectedStage(selectedStage === st.id ? 'all' : st.id)}
                className={`px-2 py-0.5 rounded-md text-[10px] font-mono flex items-center gap-1 transition-colors cursor-pointer ${
                  selectedStage === st.id ? 'bg-indigo-600 text-white font-bold' : 'text-neutral-400 hover:text-white'
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${st.color}`} />
                <span>{st.label}</span>
                <span className="opacity-60 font-mono">({st.count})</span>
              </button>
            ))}
          </div>
        </div>

        {/* Opportunities List */}
        {isLoading ? (
          <div className="py-12 flex flex-col items-center justify-center gap-2 text-neutral-400 text-xs">
            <RefreshCw className="h-5 w-5 animate-spin text-indigo-500" />
            <span>Loading deals…</span>
          </div>
        ) : error ? (
          <div className="py-8 text-center text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-xl p-3 flex flex-col items-center gap-2">
            <AlertCircle className="h-4 w-4" />
            <span>{error}</span>
            <button
              onClick={fetchDeals}
              className="text-xs font-bold text-white underline underline-offset-2 hover:text-rose-200"
            >
              Retry
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-8 text-center text-xs text-neutral-500 rounded-xl border border-dashed border-white/10 p-4">
            {opportunities.length === 0 ? 'No open deals yet. Use New Deal to add one.' : `No open deals in the ${STAGE_CONFIG.find((s) => s.id === selectedStage)?.label ?? selectedStage} stage.`}
          </div>
        ) : (
          <div className="space-y-2.5 overflow-y-auto max-h-[260px] pr-1">
            {filtered.map((opp, idx) => (
              <div
                key={opp.id ? `opp-${opp.id}-${idx}` : `opp-${idx}`}
                className="p-3 rounded-xl bg-white/[0.02] border border-white/5 hover:border-white/15 hover:bg-white/[0.04] transition-all"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-white truncate">{opp.name}</span>
                      {opp.momentum === 'hot' && (
                        <span className="text-[10px] text-amber-400 font-mono flex items-center gap-0.5">
                          <Flame className="h-3 w-3" />
                          <span>Hot</span>
                        </span>
                      )}
                    </div>
                    <span className="text-[11px] text-neutral-400 block mt-0.5 truncate">{opp.client}</span>
                  </div>

                  <div className="text-right shrink-0">
                    <span className="text-xs font-bold text-white font-mono block tabular-nums">
                      {formatCurrency(opp.value)}
                    </span>
                    <span className="text-[10px] font-mono text-emerald-400 tabular-nums">
                      {opp.probability}% probability
                    </span>
                  </div>
                </div>

                {/* Probability Bar */}
                <div className="mt-2.5 flex items-center gap-3">
                  <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-gradient-to-r from-indigo-500 to-emerald-400 rounded-full"
                      style={{ width: `${opp.probability}%` }}
                    />
                  </div>
                  <span className="text-[10px] font-mono text-neutral-400 uppercase tracking-wider shrink-0">
                    {opp.stage}
                  </span>
                </div>

                {/* Bottom Meta & Action */}
                <div className="mt-2.5 pt-2 border-t border-white/5 flex items-center justify-between text-[11px]">
                  <div className="flex items-center gap-2">
                    <span
                      title={opp.owner || 'Unassigned'}
                      className="h-5 w-5 rounded-full border border-white/15 bg-slate-700 text-[8px] font-bold text-slate-200 flex items-center justify-center"
                    >
                      {initials(opp.owner)}
                    </span>
                    <span className="text-[10px] text-neutral-400 font-mono">{opp.expectedClose}</span>
                  </div>

                  <button
                    type="button"
                    disabled={advancingId === opp.id || !NEXT_STAGE[opp.stage]}
                    onClick={() => advanceStage(opp)}
                    className={`text-[10px] font-semibold flex items-center gap-1 cursor-pointer transition-colors ${
                      advancingId === opp.id ? 'text-neutral-500' : 'text-indigo-400 hover:text-indigo-300'
                    }`}
                  >
                    <span>{advancingId === opp.id ? 'Moving…' : opp.stage === 'negotiation' ? 'Mark won' : 'Next stage'}</span>
                    <ChevronRight className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer link to Deals */}
      <div className="mt-3 pt-3 border-t border-white/5 flex items-center justify-between text-xs text-neutral-400">
        <span className="font-mono text-[10px]">{wonCount} won · {lostCount} lost</span>
        <button
          type="button"
          onClick={() => onNavigate && onNavigate('deals')}
          className="text-indigo-400 hover:text-indigo-300 text-xs font-semibold flex items-center gap-1 cursor-pointer transition-colors"
        >
          <span>Open Sales Pipeline</span>
          <ArrowUpRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
};

export default OpenOpportunitiesWidget;
