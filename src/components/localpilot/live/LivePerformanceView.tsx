/** Performance from Google's Business Profile Performance API. Nothing is estimated or invented. */
import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { LocationItem } from '../types';
import { useLocalSeo } from './localSeoClient';

export function LivePerformanceView({ location, compact }: { location?: LocationItem; compact?: boolean }) {
  const seo = useLocalSeo();
  const [days, setDays] = useState(30);
  const [state, setState] = useState<{ loading: boolean; error?: string; data?: any }>({ loading: true });
  useEffect(() => {
    if (!location) return;
    let live = true;
    setState({ loading: true });
    seo.performance(location.id, days).then((data) => live && setState({ loading: false, data })).catch((e) => live && setState({ loading: false, error: e?.message }));
    return () => { live = false; };
  }, [location?.id, days]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!location) return null;
  const t = state.data?.totals;
  const kpis = t ? [['Profile views', t.impressions], ['Search views', t.searchImpressions], ['Maps views', t.mapsImpressions], ['Calls', t.calls], ['Website clicks', t.websiteClicks], ['Direction requests', t.directions]] : [];
  const max = Math.max(1, ...(state.data?.daily ?? []).map((d: any) => d.impressions));
  return (
    <section className="bg-white border border-slate-200 rounded-2xl p-5" aria-labelledby="perf-h">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 id="perf-h" className="text-sm font-bold text-slate-900">Performance · {location.name}</h2>
          <p className="text-xs text-slate-500">{state.data ? `${state.data.range.from} to ${state.data.range.to}. ${state.data.freshness}` : 'From Google Business Profile Performance API'}</p>
        </div>
        {!compact && (
          <select aria-label="Period" className="text-xs border border-slate-200 rounded-lg px-2 py-1.5" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {[7, 30, 90, 180].map((d) => <option key={d} value={d}>Last {d} days</option>)}
          </select>
        )}
      </div>
      {state.loading ? <p className="text-sm text-slate-500 py-8 flex items-center"><Loader2 className="w-4 h-4 mr-2 animate-spin" />Loading from Google…</p>
        : state.error ? <p className="text-sm text-[#B91C1C] py-6" role="alert">{state.error}</p>
        : (
          <>
            <div className={`grid gap-3 mt-4 ${compact ? 'grid-cols-3' : 'grid-cols-2 md:grid-cols-3 lg:grid-cols-6'}`}>
              {kpis.slice(0, compact ? 3 : 6).map(([k, v]) => <div key={k as string} className="rounded-xl bg-slate-50 p-3"><p className="text-[11px] text-slate-500">{k}</p><p className="text-lg font-bold text-slate-900 tabular-nums">{Number(v).toLocaleString()}</p></div>)}
            </div>
            {state.data.daily.length ? (
              <div className="flex items-end gap-[2px] h-28 mt-4" role="img" aria-label={`Daily profile views, ${state.data.range.from} to ${state.data.range.to}`}>
                {state.data.daily.map((d: any) => <div key={d.date} title={`${d.date}: ${d.impressions} views`} className="flex-1 bg-[#93C5FD] rounded-t" style={{ height: `${Math.max(2, (d.impressions / max) * 100)}%` }} />)}
              </div>
            ) : <p className="text-sm text-slate-500 mt-4">Google returned no daily data for this period.</p>}
          </>
        )}
    </section>
  );
}
