/**
 * Settings → Organization: meeting plan, analytics (Premium+), attendance reports and organization
 * dashboard and branding (Enterprise). Every section asks the server; what the plan doesn't include
 * says so instead of showing empty numbers.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { BarChart3, Clock, Palette, RefreshCw, Users, Video } from 'lucide-react';
import { useMeetingSession } from '../../context/MeetingSessionContext';
import { formatMinutes } from '../../lib/meetingPlans';
import { PlanComparison } from './PlanComparison';

const card = 'rounded-xl border border-white/5 bg-neutral-900/30 p-5 space-y-4';
const btn = 'inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer';
const field = 'rounded-lg bg-neutral-950 border border-white/10 px-3 py-2 text-sm text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500';

async function getJson(path: string, init?: RequestInit) {
  const res = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) throw new Error(data.error || `Request failed (${res.status}).`);
  return data;
}

const fmtDate = (ms: number) => new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export default function SubscriptionSettings({ isAdmin }: { isAdmin: boolean }) {
  const { subscription, refreshSubscription } = useMeetingSession();
  useEffect(() => { refreshSubscription(); }, [refreshSubscription]);
  const f = subscription?.plan.features;

  return (
    <div className="space-y-5">
      <section className={card} aria-labelledby="plan-heading">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 id="plan-heading" className="text-base font-semibold text-white flex items-center gap-2"><Video className="h-4 w-4 text-indigo-400" /> Meeting plan</h3>
            <p className="text-sm text-neutral-400">
              {subscription
                ? `Your organization is on ${subscription.plan.label}: up to ${subscription.plan.limits.maxParticipants} people per meeting, meetings up to ${formatMinutes(subscription.plan.limits.maxDurationMinutes)}. The host's organization plan applies to every meeting, including scheduled and recurring ones.`
                : 'Loading your plan…'}
            </p>
          </div>
          <button type="button" onClick={() => refreshSubscription()} className={`${btn} bg-neutral-800 text-neutral-200 hover:bg-neutral-700`}><RefreshCw className="h-3.5 w-3.5" /> Refresh</button>
        </div>
        <PlanComparison />
      </section>

      {f?.analytics ? <AnalyticsSection attendance={!!f.attendanceReports} /> : subscription && (
        <section className={card}><h3 className="text-base font-semibold text-white flex items-center gap-2"><BarChart3 className="h-4 w-4 text-indigo-400" /> Meeting analytics</h3><p className="text-sm text-neutral-400">Meeting analytics are included in Premium and Enterprise.</p></section>
      )}
      {f?.adminDashboard && isAdmin && <DashboardSection />}
      {f?.customBranding && isAdmin && <BrandingSection />}
    </div>
  );
}

function Tile({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-white/5 bg-neutral-950/40 p-3">
      <p className="text-[11px] uppercase tracking-wide text-neutral-500">{label}</p>
      <p className="text-lg font-semibold text-white tabular-nums">{value}</p>
    </div>
  );
}

function AnalyticsSection({ attendance }: { attendance: boolean }) {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<{ title: string; rows: any[] } | null>(null);
  const load = useCallback(() => { setError(null); getJson('/api/meetings/analytics?days=30').then((d) => setData(d.analytics)).catch((e) => setError(e.message)); }, []);
  useEffect(() => { load(); }, [load]);
  const openReport = (id: string, title: string) => getJson(`/api/meetings/sessions/${encodeURIComponent(id)}/attendance`).then((d) => setReport({ title, rows: d.rows })).catch((e) => setError(e.message));
  return (
    <section className={card} aria-labelledby="analytics-heading">
      <h3 id="analytics-heading" className="text-base font-semibold text-white flex items-center gap-2"><BarChart3 className="h-4 w-4 text-indigo-400" /> Meeting analytics (last 30 days)</h3>
      {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
      {!data ? <p className="text-sm text-neutral-400">Loading…</p> : data.meetings === 0 ? <p className="text-sm text-neutral-400">No meetings in the last 30 days yet.</p> : (
        <>
          <div className="grid gap-2 grid-cols-2 sm:grid-cols-4">
            <Tile label="Meetings" value={data.meetings} />
            <Tile label="Total time" value={formatMinutes(data.totalMinutes)} />
            <Tile label="Avg. participants" value={data.averageParticipants} />
            <Tile label="Ended at time limit" value={data.endedAtTimeLimit} />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead><tr className="text-left text-[11px] uppercase tracking-wide text-neutral-500"><th className="py-2 pr-3">Meeting</th><th className="py-2 pr-3">Host</th><th className="py-2 pr-3">Ended</th><th className="py-2 pr-3 text-right">Minutes</th><th className="py-2 pr-3 text-right">Peak</th>{attendance && <th className="py-2" />}</tr></thead>
              <tbody className="divide-y divide-white/5">
                {data.recent.map((m: any) => (
                  <tr key={m.id} className="text-neutral-200">
                    <td className="py-2 pr-3">{m.title}</td><td className="py-2 pr-3">{m.hostName}</td>
                    <td className="py-2 pr-3 text-neutral-400">{fmtDate(m.endedAt)}{m.endedReason === 'time_limit' ? ' · time limit' : ''}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{m.minutes}</td><td className="py-2 pr-3 text-right tabular-nums">{m.peakParticipants}</td>
                    {attendance && <td className="py-2 text-right"><button type="button" onClick={() => openReport(m.id, m.title)} className="text-indigo-300 hover:text-white underline underline-offset-2 cursor-pointer text-xs">Attendance</button></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {!attendance && <p className="text-xs text-neutral-500">Per-meeting attendance reports are included in Enterprise.</p>}
      {report && (
        <div className="rounded-lg border border-white/10 bg-neutral-950/50 p-3 space-y-2">
          <div className="flex items-center justify-between"><p className="text-sm font-semibold text-white">Attendance: {report.title}</p><button type="button" onClick={() => setReport(null)} className="text-xs text-neutral-400 hover:text-white cursor-pointer">Close</button></div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead><tr className="text-left text-[11px] uppercase tracking-wide text-neutral-500"><th className="py-1.5 pr-3">Name</th><th className="py-1.5 pr-3">Email</th><th className="py-1.5 pr-3">Role</th><th className="py-1.5 pr-3">Joined</th><th className="py-1.5 pr-3 text-right">Minutes</th><th className="py-1.5">Outcome</th></tr></thead>
              <tbody className="divide-y divide-white/5">{report.rows.map((r, i) => (
                <tr key={i} className="text-neutral-200"><td className="py-1.5 pr-3">{r.name}</td><td className="py-1.5 pr-3 text-neutral-400">{r.email}</td><td className="py-1.5 pr-3">{r.role}</td><td className="py-1.5 pr-3 text-neutral-400">{r.joinedAt ? fmtDate(r.joinedAt) : '—'}</td><td className="py-1.5 pr-3 text-right tabular-nums">{r.minutes}</td><td className="py-1.5">{r.outcome}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

function DashboardSection() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => { setError(null); getJson('/api/meetings/dashboard').then(setData).catch((e) => setError(e.message)); }, []);
  useEffect(() => { load(); const t = setInterval(load, 30_000); return () => clearInterval(t); }, [load]);
  return (
    <section className={card} aria-labelledby="dash-heading">
      <div className="flex items-center justify-between gap-2">
        <h3 id="dash-heading" className="text-base font-semibold text-white flex items-center gap-2"><Users className="h-4 w-4 text-indigo-400" /> Organization meeting dashboard</h3>
        <button type="button" onClick={load} className={`${btn} bg-neutral-800 text-neutral-200 hover:bg-neutral-700`}><RefreshCw className="h-3.5 w-3.5" /> Refresh</button>
      </div>
      {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
      {data && (
        <>
          <p className="text-sm text-neutral-300">{data.active.length ? `${data.active.length} meeting${data.active.length === 1 ? '' : 's'} running now.` : 'No meetings running right now.'}</p>
          {data.active.length > 0 && (
            <ul className="divide-y divide-white/5 text-sm">
              {data.active.map((m: any) => (
                <li key={m.id} className="py-2 flex flex-wrap items-center justify-between gap-2 text-neutral-200">
                  <span>{m.title} <span className="text-neutral-500">· {m.hostName}</span></span>
                  <span className="tabular-nums text-neutral-400 flex items-center gap-3"><span><Users className="inline h-3 w-3" /> {m.participantCount}/{m.maxParticipants}</span><span><Clock className="inline h-3 w-3" /> {Math.ceil(m.remainingSeconds / 60)} min left</span></span>
                </li>
              ))}
            </ul>
          )}
          {data.analytics.byHost.length > 0 && (
            <div>
              <p className="text-[11px] uppercase tracking-wide text-neutral-500 mb-1">Usage by host (30 days)</p>
              <ul className="text-sm divide-y divide-white/5">{data.analytics.byHost.map((h: any) => (
                <li key={h.userId} className="py-1.5 flex justify-between text-neutral-200"><span>{h.hostName}</span><span className="tabular-nums text-neutral-400">{h.meetings} meetings · {h.minutes} min</span></li>
              ))}</ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function BrandingSection() {
  const [displayName, setDisplayName] = useState('');
  const [accentColor, setAccentColor] = useState('#4f46e5');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    getJson('/api/meetings/branding').then((d) => { if (d.branding) { setDisplayName(d.branding.displayName || ''); setAccentColor(d.branding.accentColor || '#4f46e5'); } }).catch(() => {});
  }, []);
  const save = (e: React.FormEvent) => {
    e.preventDefault(); setMsg(null);
    getJson('/api/meetings/branding', { method: 'PUT', body: JSON.stringify({ displayName: displayName.trim(), accentColor }) })
      .then(() => setMsg({ ok: true, text: 'Branding saved. New meetings show it.' }))
      .catch((err) => setMsg({ ok: false, text: err.message }));
  };
  return (
    <section className={card} aria-labelledby="brand-heading">
      <h3 id="brand-heading" className="text-base font-semibold text-white flex items-center gap-2"><Palette className="h-4 w-4 text-indigo-400" /> Meeting branding</h3>
      <form onSubmit={save} className="flex flex-wrap items-end gap-3">
        <label className="text-sm text-neutral-300 flex flex-col gap-1">Name shown in meetings
          <input id="brand-name" className={field} value={displayName} maxLength={60} onChange={(e) => setDisplayName(e.target.value)} placeholder="Acme Live" />
        </label>
        <label className="text-sm text-neutral-300 flex flex-col gap-1">Accent color
          <input id="brand-color" type="color" className="h-10 w-16 rounded-lg bg-neutral-950 border border-white/10" value={accentColor} onChange={(e) => setAccentColor(e.target.value)} />
        </label>
        <button type="submit" className={`${btn} bg-indigo-600 text-white hover:bg-indigo-500`}>Save branding</button>
      </form>
      {msg && <p role={msg.ok ? 'status' : 'alert'} className={`text-sm ${msg.ok ? 'text-emerald-300' : 'text-rose-300'}`}>{msg.text}</p>}
    </section>
  );
}
