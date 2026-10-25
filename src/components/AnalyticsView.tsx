import React, { useState } from 'react';
import { 
  BarChart3, TrendingUp, Compass, 
  Layers, ArrowUpRight, ArrowDownRight, 
  Activity, Star, Clock, AlertTriangle, ShieldCheck
} from 'lucide-react';
import ConcurrentSessionsManager from './ConcurrentSessionsManager';
import ActiveSpeakerGalleryGrid from './ActiveSpeakerGalleryGrid';
import FreeTimeFinderDashboard from './FreeTimeFinderDashboard';
import LocationInsightsCacheDashboard from './LocationInsightsCacheDashboard';

export default function AnalyticsView() {
  const [selectedTimeframe, setSelectedTimeframe] = useState<'daily' | 'weekly' | 'monthly'>('weekly');

  // TO COMPLETE: compute per-channel volume, share, conversion and reply speed from your messaging
  // analytics (e.g. aggregate conversations from /api/messaging/conversations). Nothing is invented here.
  const channelStats: { name: string; volume: string; share: string; conversion: string; speed: string; color: string }[] = [];

  // SVG Chart Mock Data coordinates for path elements
  // TO COMPLETE: weekly inbound vs resolved conversation counts from your messaging data (7 points each).
  const weeklyInflowScores: number[] = [];
  const weeklyResolutionScores: number[] = [];

  // Map to SVG coordinates (width 800, height 250)
  const mapPoints = (data: number[]) => {
    const max = 100;
    const paddingX = 40;
    const paddingY = 30;
    const width = 720;
    const height = 190;
    
    return data.map((val, idx) => {
      const x = paddingX + (idx / (data.length - 1)) * width;
      const y = paddingY + height - (val / max) * height;
      return `${x},${y}`;
    }).join(' ');
  };

  const inflowPoints = mapPoints(weeklyInflowScores);
  const resolutionPoints = mapPoints(weeklyResolutionScores);

  return (
    <div className="space-y-6" id="analytics-workspace-root">
      
      {/* Header filter */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-white/5 pb-4">
        <div>
          <h2 className="font-sans font-bold text-lg text-white tracking-tight">Performance Matrix</h2>
          <p className="text-xs text-neutral-400 mt-0.5">Real-time omnichannel speed-to-lead and conversion pipeline trackers</p>
        </div>

        <div className="flex items-center gap-1.5 rounded-lg border border-white/5 bg-black/40 p-1">
          {(['daily', 'weekly', 'monthly'] as const).map((timeframe) => (
            <button
              id={`btn-timeframe-${timeframe}`}
              key={timeframe}
              onClick={() => setSelectedTimeframe(timeframe)}
              className={`rounded-md px-3 py-1.5 text-xs font-bold transition-all capitalize ${
                selectedTimeframe === timeframe 
                  ? 'bg-blue-600 text-white' 
                  : 'text-neutral-400 hover:text-white hover:bg-neutral-800/40'
              }`}
            >
              {timeframe}
            </button>
          ))}
        </div>
      </div>

      {/* Primary SVG Chart Grid */}
      <div className="rounded-xl border border-white/5 bg-neutral-900/20 p-5 backdrop-blur-md" id="main-sales-chart-panel">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest block">Conversational throughput</span>
            <div className="flex items-center gap-6 mt-1">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-blue-500"></span>
                <span className="text-sm font-bold text-white">Incoming Leads (Inflow)</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-indigo-500"></span>
                <span className="text-sm font-bold text-neutral-300">Resolved Conversations</span>
              </div>
            </div>
          </div>

          <div className="text-right">
            <span className="text-xs font-semibold text-neutral-400 block">SLA Average Response</span>
            <span className="font-sans text-xl font-semibold text-neutral-400">—</span>
          </div>
        </div>

        {/* Responsive SVG Sparkline */}
        <div className="mt-6 overflow-x-auto scrollbar-none">
          <div className="min-w-[700px] h-[250px] relative">
            {weeklyInflowScores.length > 1 ? (
            <svg className="w-full h-full overflow-visible" xmlns="http://www.w3.org/2000/svg">
              {/* Grid Lines */}
              <line x1="40" y1="30" x2="760" y2="30" stroke="rgba(255,255,255,0.02)" strokeWidth="1" />
              <line x1="40" y1="93" x2="760" y2="93" stroke="rgba(255,255,255,0.02)" strokeWidth="1" />
              <line x1="40" y1="156" x2="760" y2="156" stroke="rgba(255,255,255,0.02)" strokeWidth="1" />
              <line x1="40" y1="220" x2="760" y2="220" stroke="rgba(255,255,255,0.05)" strokeWidth="1" />

              {/* Chart Gradients */}
              <defs>
                <linearGradient id="inflowGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.2" />
                  <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
                </linearGradient>
                <linearGradient id="resolutionGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#6366f1" stopOpacity="0.2" />
                  <stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
                </linearGradient>
              </defs>

              {/* Fill paths for gorgeous aesthetic glow */}
              <path d={`M40,220 L${inflowPoints} L760,220 Z`} fill="url(#inflowGrad)" />
              <path d={`M40,220 L${resolutionPoints} L760,220 Z`} fill="url(#resolutionGrad)" />

              {/* Line Paths */}
              <polyline fill="none" stroke="#3b82f6" strokeWidth="2.5" points={inflowPoints} strokeLinecap="round" strokeLinejoin="round" />
              <polyline fill="none" stroke="#6366f1" strokeWidth="2.5" points={resolutionPoints} strokeLinecap="round" strokeLinejoin="round" strokeDasharray="3 3" />

              {/* Floating Node dots */}
              {weeklyInflowScores.map((val, idx) => {
                const paddingX = 40;
                const paddingY = 30;
                const width = 720;
                const height = 190;
                const x = paddingX + (idx / (weeklyInflowScores.length - 1)) * width;
                const y = paddingY + height - (val / 100) * height;

                return (
                  <g key={`node-${idx}`}>
                    <circle cx={x} cy={y} r="5" fill="#0B0C0E" stroke="#3b82f6" strokeWidth="2" className="cursor-pointer" />
                    <text x={x} y={y - 10} fill="rgba(255,255,255,0.6)" fontSize="9" fontWeight="bold" fontFamily="monospace" textAnchor="middle">
                      {val}%
                    </text>
                  </g>
                );
              })}

              {/* Labels */}
              <text x="40" y="240" fill="#71717a" fontSize="10" fontWeight="bold" textAnchor="middle">Mon</text>
              <text x="160" y="240" fill="#71717a" fontSize="10" fontWeight="bold" textAnchor="middle">Tue</text>
              <text x="280" y="240" fill="#71717a" fontSize="10" fontWeight="bold" textAnchor="middle">Wed</text>
              <text x="400" y="240" fill="#71717a" fontSize="10" fontWeight="bold" textAnchor="middle">Thu</text>
              <text x="520" y="240" fill="#71717a" fontSize="10" fontWeight="bold" textAnchor="middle">Fri</text>
              <text x="640" y="240" fill="#71717a" fontSize="10" fontWeight="bold" textAnchor="middle">Sat</text>
              <text x="760" y="240" fill="#71717a" fontSize="10" fontWeight="bold" textAnchor="middle">Sun</text>
            </svg>
            ) : (
              <div className="h-full flex items-center justify-center text-center text-xs text-neutral-400 px-6">
                No conversation data yet. Connect a messaging channel to see weekly trends.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Grid: Channels Table & Performance indicators */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="rounded-xl border border-white/5 bg-neutral-900/20 p-5 backdrop-blur-md lg:col-span-8" id="channel-performance-panel">
          <div>
            <h3 className="font-sans font-bold text-base text-white tracking-tight">Channel Performance Distribution</h3>
            <p className="text-xs text-neutral-400 mt-0.5">SLA response times and conversion metrics segregated by source channel</p>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-white/5 text-neutral-500 font-bold uppercase tracking-wider">
                  <th className="py-3 px-2">Gateway Source</th>
                  <th className="py-3 px-2">Total Volume</th>
                  <th className="py-3 px-2">Traffic Share</th>
                  <th className="py-3 px-2">Avg. Response</th>
                  <th className="py-3 px-2 text-right">Conversion Success</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {channelStats.map((ch) => (
                  <tr key={ch.name} className="hover:bg-white/5 transition-colors group">
                    <td className="py-3 px-2 font-bold text-neutral-200 flex items-center gap-2">
                      <span className={`h-1.5 w-1.5 rounded-full ${ch.color}`}></span>
                      {ch.name}
                    </td>
                    <td className="py-3 px-2 text-neutral-400 font-mono">{ch.volume}</td>
                    <td className="py-3 px-2 font-medium">
                      <div className="flex items-center gap-2">
                        <span className="text-neutral-400 font-mono">{ch.share}</span>
                        <div className="h-1 w-12 bg-neutral-800 rounded-full overflow-hidden">
                          <div className={`h-full ${ch.color}`} style={{ width: ch.share }}></div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-2 text-blue-400 font-bold font-mono">{ch.speed}</td>
                    <td className="py-3 px-2 text-right text-emerald-400 font-mono font-bold">{ch.conversion}</td>
                  </tr>
                ))}
                {channelStats.length === 0 && (
                  <tr><td colSpan={6} className="py-6 text-center text-xs text-neutral-500">No channel data yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Action Center Widget */}
        <div className="rounded-xl border border-white/5 bg-neutral-900/20 p-5 backdrop-blur-md lg:col-span-4 space-y-4" id="conversion-scorecard-panel">
          <div>
            <h3 className="font-sans font-bold text-base text-white tracking-tight">Diagnostic Health</h3>
            <p className="text-xs text-neutral-400 mt-0.5">Automated omnichannel health diagnostic checks</p>
          </div>

          <div className="space-y-3">
            {/* TO COMPLETE: report real checks here, e.g. TLS certificate expiry for your domain, webhook
                delivery failures in the last 24 h, and the SMS provider balance from the Twilio API. */}
            <p className="text-xs text-neutral-400 p-3.5 rounded-xl border border-white/5">
              Health checks appear here once your channels and providers are connected.
            </p>
          </div>
        </div>
      </div>

      {/* In-Memory Location Insights & Google Reviews LRU Cache (Doubly Linked List + Hash Map) */}
      <LocationInsightsCacheDashboard />

      {/* Multi-User Meeting Room Search & Free Time Finder (Sweepline Algorithm) */}
      <FreeTimeFinderDashboard />

      {/* Real-Time Active Speaker Gallery Engine (Bounded Size-K Min-Heap) */}
      <ActiveSpeakerGalleryGrid />

      {/* Concurrent Sessions & Media Server Load Balancer (Min-Heap Priority Queue) */}
      <ConcurrentSessionsManager />

    </div>
  );
}
