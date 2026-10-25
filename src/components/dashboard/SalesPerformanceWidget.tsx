import React, { useState, useEffect } from 'react';
import { 
  TrendingUp, Award, DollarSign, Target, 
  ArrowUpRight, Users, CheckCircle2, ChevronRight,
  Flame, BarChart3, Activity, RefreshCw
} from 'lucide-react';
import { 
  AreaChart, Area, XAxis, YAxis, Tooltip, 
  ResponsiveContainer, CartesianGrid 
} from 'recharts';

const TIMEFRAME_DATA: Record<string, Array<{ name: string; revenue: number; target: number }>> = {
  '7D': [
    { name: 'Mon', revenue: 14000, target: 12000 },
    { name: 'Tue', revenue: 22000, target: 15000 },
    { name: 'Wed', revenue: 18000, target: 15000 },
    { name: 'Thu', revenue: 31000, target: 20000 },
    { name: 'Fri', revenue: 28000, target: 20000 },
    { name: 'Sat', revenue: 12000, target: 10000 },
    { name: 'Sun', revenue: 17500, target: 10000 }
  ],
  '30D': [
    { name: 'Week 1', revenue: 48000, target: 40000 },
    { name: 'Week 2', revenue: 64000, target: 55000 },
    { name: 'Week 3', revenue: 82000, target: 75000 },
    { name: 'Week 4', revenue: 112500, target: 100000 }
  ],
  'QTD': [
    { name: 'Month 1', revenue: 140000, target: 130000 },
    { name: 'Month 2', revenue: 185000, target: 170000 },
    { name: 'Month 3', revenue: 271500, target: 280000 }
  ]
};

export const SalesPerformanceWidget: React.FC<{ onNavigate?: (view: any) => void }> = ({ onNavigate }) => {
  const [timeframe, setTimeframe] = useState<'7D' | '30D' | 'QTD'>('7D');
  const [totalPipeline, setTotalPipeline] = useState<number>(366500);
  const [topClosers, setTopClosers] = useState<Array<{ name: string; deals: number; revenue: string; avatar: string }>>([
    {
      name: 'Alex Rivera',
      deals: 6,
      revenue: '$168,500',
      avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=150'
    },
    {
      name: 'Elena Rostova',
      deals: 4,
      revenue: '$95,000',
      avatar: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?auto=format&fit=crop&q=80&w=150'
    },
    {
      name: 'Liam Vance',
      deals: 3,
      revenue: '$85,000',
      avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=150'
    }
  ]);

  useEffect(() => {
    fetch('/api/dashboard/stats')
      .then(res => res.json())
      .then(data => {
        if (data.success && data.stats) {
          setTotalPipeline(data.stats.totalPipelineValue || 366500);
        }
      })
      .catch(() => {});

    fetch('/api/dashboard/deals')
      .then(res => res.json())
      .then(data => {
        if (data.success && Array.isArray(data.deals) && data.deals.length > 0) {
          // Aggregate revenue per owner
          const ownerMap: Record<string, { deals: number; revenue: number; avatar: string }> = {};
          data.deals.forEach((d: any) => {
            const owner = d.owner || 'Alex Rivera';
            if (!ownerMap[owner]) {
              ownerMap[owner] = { deals: 0, revenue: 0, avatar: d.ownerAvatar };
            }
            ownerMap[owner].deals += 1;
            ownerMap[owner].revenue += (d.value || 0);
          });
          const mapped = Object.entries(ownerMap).map(([name, info]) => ({
            name,
            deals: info.deals,
            revenue: `$${info.revenue.toLocaleString()}`,
            avatar: info.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=150'
          }));
          mapped.sort((a, b) => parseInt(b.revenue.replace(/[^0-9]/g, '')) - parseInt(a.revenue.replace(/[^0-9]/g, '')));
          if (mapped.length > 0) setTopClosers(mapped.slice(0, 3));
        }
      })
      .catch(() => {});
  }, []);

  const chartData = TIMEFRAME_DATA[timeframe];
  const targetGoal = 400000;
  const progressPct = Math.min(Math.round((totalPipeline / targetGoal) * 100), 100);

  return (
    <div className="h-full flex flex-col justify-between">
      <div>
        {/* Header & Quota Milestone */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-white tracking-tight">Sales Performance & Revenue</span>
              <span className="text-[10px] font-mono font-bold text-emerald-400 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                {progressPct}% Quota Reached
              </span>
            </div>
            <p className="text-xs text-neutral-400 mt-0.5">
              Closed revenue, target benchmarks, and sales team velocity.
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

        {/* Quota Progress Bar */}
        <div className="mb-4 p-3.5 rounded-xl bg-black/30 border border-white/5 space-y-2">
          <div className="flex items-center justify-between text-xs font-mono">
            <span className="text-neutral-400">Quarterly Target Progress</span>
            <span className="text-white font-bold tabular-nums">
              ${totalPipeline.toLocaleString()} <span className="text-neutral-500 font-normal">/ ${targetGoal.toLocaleString()}</span>
            </span>
          </div>

          <div className="h-2 w-full bg-white/5 rounded-full overflow-hidden">
            <div 
              className="h-full bg-gradient-to-r from-indigo-500 via-purple-500 to-emerald-400 rounded-full transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-[10px] text-neutral-500 font-mono pt-0.5">
            <span>Avg Deal Size: $38,500</span>
            <span>Sales Cycle: 16 days</span>
            <span className="text-emerald-400 font-bold">+28% YoY</span>
          </div>
        </div>

        {/* Interactive Revenue Chart */}
        <div className="h-44 w-full mb-4">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6366F1" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#6366F1" stopOpacity={0.0} />
                </linearGradient>
                <linearGradient id="targetGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10B981" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#10B981" stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
              <XAxis dataKey="name" stroke="#ffffff40" fontSize={11} tickLine={false} />
              <YAxis stroke="#ffffff40" fontSize={11} tickLine={false} tickFormatter={(val) => `$${val/1000}k`} />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: '#0E1017', 
                  border: '1px solid rgba(255,255,255,0.15)',
                  borderRadius: '12px',
                  boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
                  fontSize: '12px',
                  color: '#ffffff'
                }} 
                formatter={(val: any) => [`$${Number(val).toLocaleString()}`, '']}
              />
              <Area 
                type="monotone" 
                dataKey="revenue" 
                name="Actual Revenue"
                stroke="#6366F1" 
                strokeWidth={2.5}
                fillOpacity={1} 
                fill="url(#revenueGradient)" 
              />
              <Area 
                type="monotone" 
                dataKey="target" 
                name="Quota Target"
                stroke="#10B981" 
                strokeDasharray="4 4"
                strokeWidth={1.5}
                fillOpacity={1} 
                fill="url(#targetGradient)" 
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Top Reps Leaderboard */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-[11px] text-neutral-400 font-mono px-1">
            <span>Top Performing Closer</span>
            <span>Closed Revenue</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {topClosers.map((rep, idx) => (
              <div 
                key={rep.name}
                className="p-2.5 rounded-xl bg-white/[0.02] border border-white/5 flex items-center justify-between gap-2"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[10px] font-mono text-neutral-500 font-bold">#{idx + 1}</span>
                  <img 
                    src={rep.avatar} 
                    alt={rep.name} 
                    referrerPolicy="no-referrer"
                    className="h-6 w-6 rounded-full object-cover border border-white/10 shrink-0" 
                  />
                  <div className="min-w-0">
                    <span className="text-xs font-bold text-white block truncate">{rep.name}</span>
                    <span className="text-[10px] text-neutral-500 font-mono">{rep.deals} deals</span>
                  </div>
                </div>

                <span className="text-xs font-bold text-emerald-400 font-mono shrink-0 tabular-nums">
                  {rep.revenue}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-3 pt-3 border-t border-white/5 flex items-center justify-between text-xs text-neutral-400">
        <span className="font-mono text-[10px]">Average Conversion: 34.8%</span>
        <button
          type="button"
          onClick={() => onNavigate && onNavigate('deals')}
          className="text-indigo-400 hover:text-indigo-300 text-xs font-semibold flex items-center gap-1 cursor-pointer transition-colors"
        >
          <span>View Detailed Pipeline</span>
          <ArrowUpRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
};

export default SalesPerformanceWidget;
