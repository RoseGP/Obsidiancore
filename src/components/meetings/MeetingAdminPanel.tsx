/**
 * Platform administration of meeting plans (Settings → Plan administration).
 * Visible only to platform administrators (PLATFORM_ADMIN_USER_IDS); every action is enforced by
 * /api/admin/meetings on the server.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Activity, BarChart3, Check, Inbox, RefreshCw, Settings2, Square, Users } from 'lucide-react';
import { FEATURE_KEYS, FEATURE_LABELS, LIMIT_BOUNDS, MEETING_PLAN_TIERS, formatMinutes, type MeetingPlanConfig, type MeetingPlanConfigs, type MeetingPlanTier } from '../../lib/meetingPlans';
import { useMeetingSession } from '../../context/MeetingSessionContext';

const card = 'rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 space-y-4';
const btn = 'inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer';
const field = 'w-full rounded-lg bg-[var(--surface-sunken)] border border-[var(--border)] px-3 py-2 text-sm text-[var(--text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500';

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`/api/admin/meetings${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) throw new Error(data.error || `Request failed (${res.status}).`);
  return data;
}

/** Whether the signed-in user is a platform administrator (hides the tab for everyone else). */
export function usePlatformAdmin() {
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => { api('/me').then((d) => setIsAdmin(!!d.isPlatformAdmin)).catch(() => setIsAdmin(false)); }, []);
  return isAdmin;
}

const fmt = (ms: number | string) => new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export default function MeetingAdminPanel() {
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const say = (ok: boolean, text: string) => setNotice({ ok, text });
  return (
    <div className="space-y-5" id="meeting-admin-panel">
      <div>
        <h2 className="text-lg font-semibold text-[var(--text)]">Plan administration</h2>
        <p className="text-sm text-[var(--text-muted)]">Meeting plans for every organization on this platform. Changes apply without a code change; running meetings keep their limits unless a change raises them.</p>
      </div>
      {notice && <p role={notice.ok ? 'status' : 'alert'} className={`rounded-lg px-4 py-3 text-sm border ${notice.ok ? 'border-emerald-500/20 bg-emerald-500/10 text-[var(--success)]' : 'border-rose-500/30 bg-rose-500/10 text-[var(--danger)]'}`}>{notice.text}</p>}
      <StatsSection />
      <RequestsSection say={say} />
      <PlansSection say={say} />
      <SubscriptionsSection say={say} />
      <ActiveSection say={say} />
    </div>
  );
}

function Tile({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-sunken)] p-3"><p className="text-[11px] uppercase tracking-wide text-[var(--text-subtle)]">{label}</p><p className="text-lg font-semibold text-[var(--text)] tabular-nums">{value}</p></div>;
}

function StatsSection() {
  const [s, setS] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => { api('/stats?days=30').then((d) => setS(d.stats)).catch((e) => setErr(e.message)); }, []);
  useEffect(() => { load(); }, [load]);
  return (
    <section className={card} aria-labelledby="adm-stats">
      <div className="flex items-center justify-between"><h3 id="adm-stats" className="text-base font-semibold text-[var(--text)] flex items-center gap-2"><BarChart3 className="h-4 w-4 text-[var(--accent-text)]" /> Usage and subscriptions</h3>
        <button type="button" onClick={load} className={`${btn} bg-[var(--surface-sunken)] text-[var(--text)] hover:bg-[var(--border)]`}><RefreshCw className="h-3.5 w-3.5" /> Refresh</button></div>
      {err && <p role="alert" className="text-sm text-[var(--danger)]">{err}</p>}
      {s && (
        <>
          <div className="grid gap-2 grid-cols-2 md:grid-cols-4">
            <Tile label="Organizations" value={s.organizations} />
            <Tile label="Free · Premium · Enterprise" value={`${s.subscriptionsByTier.free} · ${s.subscriptionsByTier.premium} · ${s.subscriptionsByTier.enterprise}`} />
            <Tile label="Meetings running" value={`${s.activeMeetings} (${s.participantsInMeetings} people)`} />
            <Tile label="Pending requests" value={s.pendingRequests} />
            <Tile label="Meetings, 30 days" value={s.usage.meetings} />
            <Tile label="Meeting time, 30 days" value={formatMinutes(s.usage.totalMinutes)} />
            <Tile label="Avg. participants" value={s.usage.averageParticipants} />
            <Tile label="Ended at time limit" value={s.usage.endedAtTimeLimit} />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm">
              <thead><tr className="text-left text-[11px] uppercase tracking-wide text-[var(--text-subtle)]"><th className="py-1.5 pr-3">Plan</th><th className="py-1.5 pr-3 text-right">Meetings</th><th className="py-1.5 pr-3 text-right">Minutes</th><th className="py-1.5 pr-3 text-right">Peak people</th><th className="py-1.5 text-right">Hit time limit</th></tr></thead>
              <tbody className="divide-y divide-[var(--border)]">{MEETING_PLAN_TIERS.map((t) => (
                <tr key={t} className="text-[var(--text)]"><td className="py-1.5 pr-3 capitalize">{t}</td><td className="py-1.5 pr-3 text-right tabular-nums">{s.usageByTier[t].meetings}</td><td className="py-1.5 pr-3 text-right tabular-nums">{s.usageByTier[t].totalMinutes}</td><td className="py-1.5 pr-3 text-right tabular-nums">{s.usageByTier[t].peakParticipants}</td><td className="py-1.5 text-right tabular-nums">{s.usageByTier[t].endedAtTimeLimit}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function RequestsSection({ say }: { say: (ok: boolean, t: string) => void }) {
  const [rows, setRows] = useState<any[]>([]);
  const load = useCallback(() => { api('/requests?status=pending').then((d) => setRows(d.requests)).catch((e) => say(false, e.message)); }, [say]);
  useEffect(() => { load(); }, [load]);
  const decide = (id: string, decision: 'approve' | 'decline') => api(`/requests/${encodeURIComponent(id)}/${decision}`, { method: 'POST', body: '{}' })
    .then(() => { say(true, decision === 'approve' ? 'Approved: the organization\'s plan changed.' : 'Request declined.'); load(); }).catch((e) => say(false, e.message));
  return (
    <section className={card} aria-labelledby="adm-req">
      <h3 id="adm-req" className="text-base font-semibold text-[var(--text)] flex items-center gap-2"><Inbox className="h-4 w-4 text-[var(--accent-text)]" /> Plan change requests</h3>
      {rows.length === 0 ? <p className="text-sm text-[var(--text-muted)]">No pending requests.</p> : (
        <ul className="divide-y divide-[var(--border)]">{rows.map((r) => (
          <li key={r.id} className="py-2.5 flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-[var(--text)] min-w-0">
              <b>{r.orgName}</b>: {r.currentTier} → <b>{r.requestedTier}</b> ({r.direction}) <span className="text-[var(--text-subtle)]">by {r.requestedByName} · {fmt(r.createdAt)}</span>
              {r.note && <span className="block text-[var(--text-muted)]">“{r.note}”</span>}
            </span>
            <span className="flex gap-2">
              <button type="button" onClick={() => decide(r.id, 'approve')} className={`${btn} bg-emerald-600 text-white hover:bg-emerald-500`}><Check className="h-3.5 w-3.5" /> Approve</button>
              <button type="button" onClick={() => decide(r.id, 'decline')} className={`${btn} bg-[var(--surface-sunken)] text-[var(--text)] hover:bg-[var(--border)]`}>Decline</button>
            </span>
          </li>
        ))}</ul>
      )}
    </section>
  );
}

function PlansSection({ say }: { say: (ok: boolean, t: string) => void }) {
  const { refreshSubscription } = useMeetingSession();
  const [plans, setPlans] = useState<MeetingPlanConfigs | null>(null);
  const [draft, setDraft] = useState<MeetingPlanConfigs | null>(null);
  const [saving, setSaving] = useState<MeetingPlanTier | null>(null);
  const load = useCallback(() => { api('/plans').then((d) => { setPlans(d.plans); setDraft(structuredClone(d.plans)); }).catch((e) => say(false, e.message)); }, [say]);
  useEffect(() => { load(); }, [load]);
  if (!draft || !plans) return <section className={card}><p className="text-sm text-[var(--text-muted)]">Loading plans…</p></section>;

  const set = (t: MeetingPlanTier, fn: (p: MeetingPlanConfig) => void) => setDraft((d) => { const n = structuredClone(d!); fn(n[t]); return n; });
  const save = (t: MeetingPlanTier) => {
    const p = draft[t];
    setSaving(t);
    api(`/plans/${t}`, { method: 'PUT', body: JSON.stringify({ label: p.label, limits: p.limits, features: p.features, warnMinutesBefore: p.warnMinutesBefore, capacityWarnPercent: p.capacityWarnPercent }) })
      .then(() => { say(true, `${p.label} saved. New meetings use it.`); load(); refreshSubscription(); })
      .catch((e) => say(false, e.message)).finally(() => setSaving(null));
  };
  const num = (v: string) => (v === '' ? NaN : Math.round(Number(v)));

  return (
    <section className={card} aria-labelledby="adm-plans">
      <h3 id="adm-plans" className="text-base font-semibold text-[var(--text)] flex items-center gap-2"><Settings2 className="h-4 w-4 text-[var(--accent-text)]" /> Plans</h3>
      <div className="grid gap-4 lg:grid-cols-3">
        {MEETING_PLAN_TIERS.map((t) => {
          const p = draft[t];
          const dirty = JSON.stringify(p) !== JSON.stringify(plans[t]);
          return (
            <form key={t} onSubmit={(e) => { e.preventDefault(); save(t); }} className="rounded-xl border border-[var(--border)] bg-[var(--surface-sunken)] p-4 space-y-3 min-w-0">
              <label className="block text-xs text-[var(--text-muted)]">Name<input id={`plan-${t}-label`} className={field} value={p.label} maxLength={40} onChange={(e) => set(t, (x) => { x.label = e.target.value; })} /></label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-xs text-[var(--text-muted)]">Max participants
                  <input id={`plan-${t}-people`} type="number" className={field} min={LIMIT_BOUNDS.maxParticipants.min} max={LIMIT_BOUNDS.maxParticipants.max} value={Number.isFinite(p.limits.maxParticipants) ? p.limits.maxParticipants : ''} onChange={(e) => set(t, (x) => { x.limits.maxParticipants = num(e.target.value); })} />
                </label>
                <label className="block text-xs text-[var(--text-muted)]">Max minutes
                  <input id={`plan-${t}-minutes`} type="number" className={field} min={LIMIT_BOUNDS.maxDurationMinutes.min} max={LIMIT_BOUNDS.maxDurationMinutes.max} value={Number.isFinite(p.limits.maxDurationMinutes) ? p.limits.maxDurationMinutes : ''} onChange={(e) => set(t, (x) => { x.limits.maxDurationMinutes = num(e.target.value); })} />
                </label>
                <label className="block text-xs text-[var(--text-muted)]">Warn (min before end)
                  <input id={`plan-${t}-warn`} type="number" className={field} min={LIMIT_BOUNDS.warnMinutesBefore.min} max={LIMIT_BOUNDS.warnMinutesBefore.max} value={Number.isFinite(p.warnMinutesBefore) ? p.warnMinutesBefore : ''} onChange={(e) => set(t, (x) => { x.warnMinutesBefore = num(e.target.value); })} />
                </label>
                <label className="block text-xs text-[var(--text-muted)]">Warn at % full
                  <input id={`plan-${t}-cap`} type="number" className={field} min={LIMIT_BOUNDS.capacityWarnPercent.min} max={LIMIT_BOUNDS.capacityWarnPercent.max} value={Number.isFinite(p.capacityWarnPercent) ? p.capacityWarnPercent : ''} onChange={(e) => set(t, (x) => { x.capacityWarnPercent = num(e.target.value); })} />
                </label>
              </div>
              <p className="text-xs text-[var(--text-subtle)]">{Number.isFinite(p.limits.maxDurationMinutes) ? `Meetings end at ${formatMinutes(p.limits.maxDurationMinutes)}.` : ''}</p>
              <fieldset className="space-y-1">
                <legend className="text-xs text-[var(--text-muted)] mb-1">Features</legend>
                {FEATURE_KEYS.map((k) => (
                  <label key={k} className="flex items-center gap-2 text-sm text-[var(--text)] cursor-pointer">
                    <input id={`plan-${t}-${k}`} type="checkbox" checked={p.features[k]} onChange={(e) => set(t, (x) => { x.features[k] = e.target.checked; })} className="accent-indigo-500" />
                    {FEATURE_LABELS[k]}
                  </label>
                ))}
              </fieldset>
              <div className="flex gap-2">
                <button type="submit" disabled={!dirty || saving === t} className={`${btn} flex-1 bg-indigo-600 text-white hover:bg-indigo-500`}>{saving === t ? 'Saving…' : 'Save'}</button>
                <button type="button" disabled={!dirty} onClick={() => setDraft((d) => ({ ...d!, [t]: structuredClone(plans[t]) }))} className={`${btn} bg-[var(--surface-sunken)] text-[var(--text)] hover:bg-[var(--border)]`}>Discard</button>
              </div>
            </form>
          );
        })}
      </div>
    </section>
  );
}

function SubscriptionsSection({ say }: { say: (ok: boolean, t: string) => void }) {
  const [rows, setRows] = useState<any[]>([]);
  const [q, setQ] = useState('');
  const [tier, setTier] = useState('');
  const [edit, setEdit] = useState<{ orgId: string; name: string; tier: MeetingPlanTier; people: string; minutes: string; reason: string } | null>(null);
  const load = useCallback(() => {
    const qs = new URLSearchParams({ ...(q.trim() ? { q: q.trim() } : {}), ...(tier ? { tier } : {}) }).toString();
    api(`/subscriptions${qs ? `?${qs}` : ''}`).then((d) => setRows(d.subscriptions)).catch((e) => say(false, e.message));
  }, [q, tier, say]);
  useEffect(() => { load(); }, [tier]);
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (!edit) return;
    const custom = edit.tier === 'enterprise' && (edit.people || edit.minutes)
      ? { ...(edit.people ? { maxParticipants: Math.round(Number(edit.people)) } : {}), ...(edit.minutes ? { maxDurationMinutes: Math.round(Number(edit.minutes)) } : {}) }
      : null;
    api(`/subscriptions/${encodeURIComponent(edit.orgId)}`, { method: 'PUT', body: JSON.stringify({ tier: edit.tier, customLimits: custom, reason: edit.reason.trim() || undefined }) })
      .then((d) => { say(true, `${edit.name}: ${edit.tier}. ${d.note}`); setEdit(null); load(); }).catch((err) => say(false, err.message));
  };
  return (
    <section className={card} aria-labelledby="adm-subs">
      <h3 id="adm-subs" className="text-base font-semibold text-[var(--text)] flex items-center gap-2"><Users className="h-4 w-4 text-[var(--accent-text)]" /> Subscriptions</h3>
      <form onSubmit={(e) => { e.preventDefault(); load(); }} className="flex flex-wrap gap-2">
        <input id="subs-search" className={`${field} max-w-xs`} placeholder="Search organizations" value={q} onChange={(e) => setQ(e.target.value)} />
        <select id="subs-tier" className={`${field} max-w-[160px]`} value={tier} onChange={(e) => setTier(e.target.value)}>
          <option value="">All plans</option>{MEETING_PLAN_TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <button type="submit" className={`${btn} bg-[var(--surface-sunken)] text-[var(--text)] hover:bg-[var(--border)]`}>Search</button>
      </form>
      <ul className="divide-y divide-[var(--border)] text-sm">
        {rows.map((r) => (
          <li key={r.orgId} className="py-2.5 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[var(--text)]">{r.name} <span className="text-[var(--text-subtle)] font-mono text-xs">{r.orgId}</span></span>
              <span className="flex items-center gap-2">
                <span className="capitalize text-[var(--text-muted)]">{r.tier}{r.customLimits ? ' (custom)' : ''}</span>
                <button type="button" onClick={() => setEdit({ orgId: r.orgId, name: r.name, tier: r.tier, people: r.customLimits?.maxParticipants ? String(r.customLimits.maxParticipants) : '', minutes: r.customLimits?.maxDurationMinutes ? String(r.customLimits.maxDurationMinutes) : '', reason: '' })} className={`${btn} bg-[var(--surface-sunken)] text-[var(--text)] hover:bg-[var(--border)] py-1`}>Change</button>
              </span>
            </div>
            {edit?.orgId === r.orgId && (
              <form onSubmit={save} className="rounded-lg border border-[var(--border)] bg-[var(--surface-sunken)] p-3 grid gap-2 sm:grid-cols-4 items-end">
                <label className="text-xs text-[var(--text-muted)]">Plan
                  <select id="sub-edit-tier" className={field} value={edit.tier} onChange={(e) => setEdit({ ...edit, tier: e.target.value as MeetingPlanTier })}>{MEETING_PLAN_TIERS.map((t) => <option key={t} value={t}>{t}</option>)}</select>
                </label>
                <label className="text-xs text-[var(--text-muted)]">Custom max people {edit.tier !== 'enterprise' && '(Enterprise)'}
                  <input id="sub-edit-people" type="number" className={field} disabled={edit.tier !== 'enterprise'} value={edit.people} onChange={(e) => setEdit({ ...edit, people: e.target.value })} placeholder="Plan default" />
                </label>
                <label className="text-xs text-[var(--text-muted)]">Custom max minutes {edit.tier !== 'enterprise' && '(Enterprise)'}
                  <input id="sub-edit-minutes" type="number" className={field} disabled={edit.tier !== 'enterprise'} value={edit.minutes} onChange={(e) => setEdit({ ...edit, minutes: e.target.value })} placeholder="Plan default" />
                </label>
                <label className="text-xs text-[var(--text-muted)]">Reason
                  <input id="sub-edit-reason" className={field} value={edit.reason} maxLength={500} onChange={(e) => setEdit({ ...edit, reason: e.target.value })} placeholder="e.g. invoice #1042 paid" />
                </label>
                <div className="sm:col-span-4 flex gap-2"><button type="submit" className={`${btn} bg-indigo-600 text-white hover:bg-indigo-500`}>Save</button><button type="button" onClick={() => setEdit(null)} className={`${btn} bg-[var(--surface-sunken)] text-[var(--text)] hover:bg-[var(--border)]`}>Cancel</button></div>
              </form>
            )}
          </li>
        ))}
        {rows.length === 0 && <li className="py-2 text-[var(--text-muted)]">No organizations match.</li>}
      </ul>
    </section>
  );
}

function ActiveSection({ say }: { say: (ok: boolean, t: string) => void }) {
  const [rows, setRows] = useState<any[]>([]);
  const load = useCallback(() => { api('/active').then((d) => setRows(d.meetings)).catch((e) => say(false, e.message)); }, [say]);
  useEffect(() => { load(); const t = setInterval(load, 15_000); return () => clearInterval(t); }, [load]);
  const end = (m: any) => api(`/active/${encodeURIComponent(m.orgId)}/${encodeURIComponent(m.id)}/end`, { method: 'POST', body: '{}' })
    .then(() => { say(true, `Ended “${m.title}”.`); load(); }).catch((e) => say(false, e.message));
  return (
    <section className={card} aria-labelledby="adm-active">
      <div className="flex items-center justify-between"><h3 id="adm-active" className="text-base font-semibold text-[var(--text)] flex items-center gap-2"><Activity className="h-4 w-4 text-[var(--accent-text)]" /> Meetings running now</h3>
        <button type="button" onClick={load} className={`${btn} bg-[var(--surface-sunken)] text-[var(--text)] hover:bg-[var(--border)]`}><RefreshCw className="h-3.5 w-3.5" /> Refresh</button></div>
      {rows.length === 0 ? <p className="text-sm text-[var(--text-muted)]">No meetings are running.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead><tr className="text-left text-[11px] uppercase tracking-wide text-[var(--text-subtle)]"><th className="py-1.5 pr-3">Meeting</th><th className="py-1.5 pr-3">Host</th><th className="py-1.5 pr-3">Plan</th><th className="py-1.5 pr-3 text-right">People</th><th className="py-1.5 pr-3 text-right">Time left</th><th className="py-1.5" /></tr></thead>
            <tbody className="divide-y divide-[var(--border)]">{rows.map((m) => (
              <tr key={m.id} className="text-[var(--text)]">
                <td className="py-1.5 pr-3">{m.title}{m.recording ? ' · recording' : ''}{m.locked ? ' · locked' : ''}</td><td className="py-1.5 pr-3">{m.hostName}</td><td className="py-1.5 pr-3 capitalize">{m.tier}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{m.participantCount}/{m.maxParticipants}{m.waitingCount ? ` (+${m.waitingCount} waiting)` : ''}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{Math.ceil(m.remainingSeconds / 60)} min</td>
                <td className="py-1.5 text-right"><button type="button" onClick={() => end(m)} className={`${btn} bg-rose-600/80 text-white hover:bg-rose-500 py-1`}><Square className="h-3 w-3" /> End</button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}
