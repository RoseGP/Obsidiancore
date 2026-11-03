/** Performance analytics from the Business Profile Performance API, with period comparison and CSV export. */
import React, { useMemo, useState } from 'react';
import { Download, Eye, MousePointerClick, Navigation, Phone } from 'lucide-react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useGrowth, useLoad } from '../GrowthStore';
import { Alert, Badge, Button, Card, PageHeader, Skeleton, Stat, Tabs, fmtNum, pct } from '../ui';

type Daily = { date: string; impressions: number; calls: number; websiteClicks: number; directions: number };
const tip = { contentStyle: { background: 'var(--g-surface)', border: '1px solid var(--g-line)', borderRadius: 10, color: 'var(--g-text)' } };

function group(daily: Daily[], by: 'day' | 'week' | 'month'): Daily[] {
  if (by === 'day') return daily;
  const m = new Map<string, Daily>();
  for (const d of daily) {
    const dt = new Date(`${d.date}T00:00:00Z`);
    const key = by === 'month' ? d.date.slice(0, 7) : new Date(dt.getTime() - ((dt.getUTCDay() + 6) % 7) * 86_400_000).toISOString().slice(0, 10);
    const e = m.get(key) ?? { date: key, impressions: 0, calls: 0, websiteClicks: 0, directions: 0 };
    e.impressions += d.impressions; e.calls += d.calls; e.websiteClicks += d.websiteClicks; e.directions += d.directions; m.set(key, e);
  }
  return [...m.values()];
}

export default function AnalyticsPage() {
  const { api, location } = useGrowth();
  const [days, setDays] = useState<'30' | '90' | '180'>('30');
  const [by, setBy] = useState<'day' | 'week' | 'month'>('day');
  const q = useLoad(() => api<any>(`/growth/analytics?location=${encodeURIComponent(location!.name)}&days=${days}`), [location?.name, days]);
  const cur = q.data?.current; const prev = q.data?.previous?.totals;
  const data = useMemo(() => group(cur?.daily ?? [], by), [cur, by]);

  const csv = () => {
    const rows = [['date', 'profile_views', 'calls', 'website_clicks', 'direction_requests'], ...data.map((d) => [d.date, d.impressions, d.calls, d.websiteClicks, d.directions])];
    const blob = new Blob([rows.map((r) => r.join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `performance-${location!.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${cur.range.from}-${cur.range.to}.csv`; a.click();
  };
  const delta = (k: string) => { const d = pct(cur?.totals?.[k] ?? 0, prev?.[k]); return d === null ? 'no earlier data' : <span style={{ color: d >= 0 ? 'var(--g-ok)' : 'var(--g-danger)' }}>{d >= 0 ? '▲' : '▼'} {Math.abs(d)}% vs previous</span>; };

  return (
    <div className="space-y-5 g-fade">
      <PageHeader title="Performance" description="Views and customer actions reported by Google’s Business Profile Performance API."
        actions={<>
          <Tabs value={days} onChange={setDays} label="Range" options={[{ value: '30', label: '30 days' }, { value: '90', label: '90 days' }, { value: '180', label: '180 days' }]} />
          {cur && <Button icon={<Download size={15} />} onClick={csv}>Download CSV</Button>}
        </>} />
      {q.loading ? <div className="grid gap-3 sm:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} h={110} />)}</div> : q.error ? <Alert tone="warn" title="Performance data isn’t available">{q.error}</Alert> : cur && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Profile views" value={fmtNum(cur.totals.impressions)} sub={delta('impressions')} source="google" icon={<Eye size={14} aria-hidden />} />
            <Stat label="Calls" value={fmtNum(cur.totals.calls)} sub={delta('calls')} source="google" icon={<Phone size={14} aria-hidden />} />
            <Stat label="Website clicks" value={fmtNum(cur.totals.websiteClicks)} sub={delta('websiteClicks')} source="google" icon={<MousePointerClick size={14} aria-hidden />} />
            <Stat label="Direction requests" value={fmtNum(cur.totals.directions)} sub={delta('directions')} source="google" icon={<Navigation size={14} aria-hidden />} />
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-2">
            <Stat label="Views from Search" value={fmtNum(cur.totals.searchImpressions)} source="google" sub={`${Math.round((cur.totals.searchImpressions / Math.max(1, cur.totals.impressions)) * 100)}% of views`} />
            <Stat label="Views from Maps" value={fmtNum(cur.totals.mapsImpressions)} source="google" sub={`${Math.round((cur.totals.mapsImpressions / Math.max(1, cur.totals.impressions)) * 100)}% of views`} />
          </div>
          <Card title="Profile views" description={`${cur.range.from} to ${cur.range.to}. ${cur.freshness}`} actions={<Tabs value={by} onChange={setBy} label="Group by" options={[{ value: 'day', label: 'Daily' }, { value: 'week', label: 'Weekly' }, { value: 'month', label: 'Monthly' }]} />}>
            <div style={{ height: 240 }}><ResponsiveContainer><AreaChart data={data} margin={{ left: -12, right: 8, top: 8 }}>
              <defs><linearGradient id="gpViews" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--g-accent)" stopOpacity={0.3} /><stop offset="100%" stopColor="var(--g-accent)" stopOpacity={0} /></linearGradient></defs>
              <CartesianGrid stroke="var(--g-line)" vertical={false} /><XAxis dataKey="date" tick={{ fill: 'var(--g-faint)', fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={24} /><YAxis tick={{ fill: 'var(--g-faint)', fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip {...tip} /><Area type="monotone" dataKey="impressions" name="Profile views" stroke="var(--g-accent)" strokeWidth={2} fill="url(#gpViews)" />
            </AreaChart></ResponsiveContainer></div>
          </Card>
          <Card title="Customer actions">
            <div style={{ height: 240 }}><ResponsiveContainer><BarChart data={data} margin={{ left: -12, right: 8, top: 8 }}>
              <CartesianGrid stroke="var(--g-line)" vertical={false} /><XAxis dataKey="date" tick={{ fill: 'var(--g-faint)', fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={24} /><YAxis allowDecimals={false} tick={{ fill: 'var(--g-faint)', fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip {...tip} /><Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="calls" name="Calls" stackId="a" fill="var(--g-accent)" /><Bar dataKey="websiteClicks" name="Website clicks" stackId="a" fill="var(--g-teal)" /><Bar dataKey="directions" name="Directions" stackId="a" fill="var(--g-warn)" radius={[4, 4, 0, 0]} />
            </BarChart></ResponsiveContainer></div>
          </Card>
          <Card title="Where these numbers come from">
            <ul className="space-y-1.5 text-[13.5px]">
              <li><Badge tone="ok">From Google</Badge> Profile views (Search and Maps, desktop and mobile), calls, website clicks and direction requests, from the Business Profile Performance API.</li>
              <li><Badge>Calculated here</Badge> Changes versus the previous period, and weekly or monthly totals, which this app adds up from Google’s daily values.</li>
              <li className="g-muted">Google reports with a delay of a few days, so the range ends about three days ago.</li>
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}
