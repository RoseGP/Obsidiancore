import React, { useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, BarChart3, CalendarClock, CheckCircle2, Inbox, Link2, MessageSquare, PencilLine, Plug, RotateCcw, Wrench } from 'lucide-react';
import { addDays, formatDateTime, startOfDay } from '../domain/calendar';
import { ALL_PLATFORMS, PLATFORMS, PRIMARY_PLATFORMS, postTitle, type PlannerPost, type PlatformId } from '../domain/model';
import { usePlanner } from '../state/PlannerStore';
import { usePrefs, type PlannerPrefs } from '../state/prefs';
import { usePreview } from '../components/posts';
import { AgendaList } from './CalendarPage';
import { Banner, Button, EmptyState, ErrorState, PlatformGlyph, PlatformTile, Segmented, Skeleton, StatusBadge, useToast } from '../ui/kit';

function StatCard({ label, value, hint, icon, tone, loading }: { label: string; value: number; hint: string; icon: React.ReactNode; tone?: 'danger'; loading?: boolean }) {
  return (
    <div className="sp-card p-4">
      <div className="flex items-center justify-between">
        <span className="sp-muted text-[13px] font-medium">{label}</span>
        <span className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: tone === 'danger' && value > 0 ? 'rgba(239,68,68,0.14)' : 'var(--sp-surface-2)', color: tone === 'danger' && value > 0 ? 'var(--sp-danger)' : 'var(--sp-accent-text)' }} aria-hidden>{icon}</span>
      </div>
      {loading ? <Skeleton className="mt-3" style={{ height: 30, width: 70 }} /> : <p className="display num mt-2 text-[28px] font-semibold">{value}</p>}
      <p className="sp-faint mt-1 text-[12px]">{hint}</p>
    </div>
  );
}

const useWindow = (back: number, ahead: number) => {
  const { from, to } = useMemo(() => {
    const t = startOfDay(new Date());
    return { from: addDays(t, -back), to: new Date(addDays(t, ahead).getTime() - 1) };
  }, [back, ahead]);
  return { from, to };
};

// ---------- Dashboard ----------

export function DashboardPage({ onOpenCalendar, onCompose }: { onOpenCalendar: () => void; onCompose: () => void }) {
  const { posts, useRange, retry, isBusy } = usePlanner();
  const toast = useToast();
  const { from, to } = useWindow(30, 31);
  const range = useRange(from, to);
  const now = Date.now();
  const inWin = posts.filter((p) => { const t = new Date(p.scheduledAt).getTime(); return t >= from.getTime() && t <= to.getTime(); });
  const next7 = inWin.filter((p) => p.status === 'scheduled' && new Date(p.scheduledAt).getTime() >= now && new Date(p.scheduledAt).getTime() < now + 7 * 864e5);
  const published30 = inWin.filter((p) => p.status === 'published');
  const drafts = inWin.filter((p) => p.status === 'draft');
  const failed = inWin.filter((p) => p.status === 'failed');
  const upNext = inWin.filter((p) => (p.status === 'scheduled' || p.status === 'publishing') && new Date(p.scheduledAt).getTime() >= now - 36e5).slice(0, 6);
  const loading = range.status === 'loading';

  if (range.status === 'error') return <div className="p-6"><div className="sp-card"><ErrorState title="Your dashboard couldn’t load" message={range.error} onRetry={range.reload} /></div></div>;

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Scheduled" value={next7.length} hint="Next 7 days" icon={<CalendarClock size={16} />} loading={loading} />
        <StatCard label="Published" value={published30.length} hint="Last 30 days" icon={<CheckCircle2 size={16} />} loading={loading} />
        <StatCard label="Drafts" value={drafts.length} hint="Within ±30 days" icon={<PencilLine size={16} />} loading={loading} />
        <StatCard label="Failed" value={failed.length} hint="Need attention" icon={<AlertTriangle size={16} />} tone="danger" loading={loading} />
      </div>

      {failed.length > 0 && (
        <section className="sp-card p-4" aria-labelledby="sp-attn">
          <h2 id="sp-attn" className="display mb-3 text-[15px] font-semibold">Needs attention</h2>
          <ul className="space-y-2">
            {failed.slice(0, 5).map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 rounded-xl p-3" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)' }}>
                {p.platforms[0] && <PlatformTile id={p.platforms[0]} size={22} />}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-medium">{postTitle(p, 80)}</p>
                  <p className="text-[12px]" style={{ color: 'var(--danger)' }}>{p.failureReason || 'Publishing failed.'}</p>
                </div>
                <Button size="sm" variant="secondary" icon={<RotateCcw size={14} />} loading={isBusy(p.id)} onClick={async () => {
                  try { await retry(p.id); toast({ tone: 'success', title: 'Queued for another try' }); } catch (e: any) { if (e?.code !== 'busy') toast({ tone: 'error', title: 'Retry failed', body: e?.message }); }
                }}>Retry</Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="sp-card p-4" aria-labelledby="sp-next">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="sp-next" className="display text-[15px] font-semibold">Up next</h2>
          <Button size="sm" variant="ghost" onClick={onOpenCalendar}>Open calendar <ArrowRight size={14} /></Button>
        </div>
        {loading && !upNext.length ? <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} style={{ height: 52 }} />)}</div>
          : upNext.length === 0 ? <EmptyState icon={<CalendarClock size={20} />} title="Nothing scheduled" body="Scheduled posts for the next month appear here." action={<Button variant="primary" onClick={onCompose}>New post</Button>} />
          : <AgendaList posts={upNext} />}
      </section>
    </div>
  );
}

// ---------- Analytics ----------

export function AnalyticsPage() {
  const { posts, useRange } = usePlanner();
  const [days, setDays] = useState<'30' | '90'>('30');
  const { from, to } = useWindow(Number(days), 1);
  const range = useRange(from, to);
  const list = posts.filter((p) => { const t = new Date(p.scheduledAt).getTime(); return t >= from.getTime() && t <= Math.min(to.getTime(), Date.now()); });
  const published = list.filter((p) => p.status === 'published');
  const failed = list.filter((p) => p.status === 'failed');
  const attempted = published.length + failed.length;
  const rate = attempted ? Math.round((published.length / attempted) * 1000) / 10 : null;

  const weeks = useMemo(() => {
    const n = Math.ceil(Number(days) / 7);
    const start = startOfDay(addDays(new Date(), -n * 7 + 1));
    return Array.from({ length: n }, (_, i) => {
      const a = addDays(start, i * 7); const b = addDays(a, 7);
      const inW = published.filter((p) => { const t = new Date(p.scheduledAt); return t >= a && t < b; });
      return { label: new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(a), count: inW.length };
    });
  }, [published, days]);
  const maxW = Math.max(1, ...weeks.map((w) => w.count));
  const byPlatform = ALL_PLATFORMS.map((p) => ({ p, n: published.filter((x) => x.platforms.includes(p)).length })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n);
  const maxP = Math.max(1, ...byPlatform.map((x) => x.n));
  const loading = range.status === 'loading';

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="sp-muted text-[13.5px]">Publishing activity from your calendar.</p>
        <Segmented<"30" | "90"> label="Period" value={days} onChange={setDays} options={[{ value: '30', label: '30 days' }, { value: '90', label: '90 days' }]} />
      </div>
      {range.status === 'error' ? <div className="sp-card"><ErrorState title="Analytics couldn’t load" message={range.error} onRetry={range.reload} /></div> : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <StatCard label="Published" value={published.length} hint={`Last ${days} days`} icon={<CheckCircle2 size={16} />} loading={loading} />
            <StatCard label="Failed" value={failed.length} hint={`Last ${days} days`} icon={<AlertTriangle size={16} />} tone="danger" loading={loading} />
            <div className="sp-card col-span-2 p-4 lg:col-span-1">
              <span className="sp-muted text-[13px] font-medium">Publish success rate</span>
              {loading ? <Skeleton className="mt-3" style={{ height: 30, width: 90 }} /> : <p className="display num mt-2 text-[28px] font-semibold">{rate === null ? '—' : `${rate}%`}</p>}
              <p className="sp-faint mt-1 text-[12px]">{rate === null ? 'No publish attempts yet' : `${published.length} of ${attempted} attempts`}</p>
            </div>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <section className="sp-card p-4" aria-labelledby="sp-weekly">
              <h2 id="sp-weekly" className="display mb-4 text-[15px] font-semibold">Posts published per week</h2>
              {loading ? <Skeleton style={{ height: 160 }} /> : published.length === 0 ? <p className="sp-muted py-10 text-center text-[13px]">No published posts in this period.</p> : (
                <div className="flex h-[160px] items-end gap-1.5" role="img" aria-label={weeks.map((w) => `Week of ${w.label}: ${w.count}`).join('; ')}>
                  {weeks.map((w) => (
                    <div key={w.label} className="flex flex-1 flex-col items-center justify-end gap-1.5" title={`Week of ${w.label}: ${w.count}`}>
                      <span className="sp-faint text-[10.5px] num">{w.count || ''}</span>
                      <div className="w-full rounded-t-md" style={{ height: `${(w.count / maxW) * 120}px`, minHeight: 2, background: 'linear-gradient(180deg,#8b7dff,#5468f2)' }} />
                    </div>
                  ))}
                </div>
              )}
            </section>
            <section className="sp-card p-4" aria-labelledby="sp-byplat">
              <h2 id="sp-byplat" className="display mb-4 text-[15px] font-semibold">Published by platform</h2>
              {loading ? <Skeleton style={{ height: 160 }} /> : byPlatform.length === 0 ? <p className="sp-muted py-10 text-center text-[13px]">No published posts in this period.</p> : (
                <ul className="space-y-3">
                  {byPlatform.map(({ p, n }) => (
                    <li key={p}>
                      <div className="flex items-center justify-between text-[13px]"><span className="flex items-center gap-2"><PlatformGlyph id={p} size={14} color={PLATFORMS[p].dot} />{PLATFORMS[p].label}</span><span className="num font-semibold">{n}</span></div>
                      <div className="mt-1.5 h-2 rounded-full" style={{ background: 'var(--sp-surface-3)' }}><div className="h-full rounded-full" style={{ width: `${(n / maxP) * 100}%`, background: PLATFORMS[p].dot }} /></div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
          <div className="sp-card">
            <EmptyState icon={<BarChart3 size={20} />} title="Engagement metrics aren’t available yet"
              body="Likes, reach and clicks need each platform’s analytics API. Once connected accounts report them, they’ll show here." />
          </div>
        </>
      )}
    </div>
  );
}

// ---------- Accounts ----------

export function AccountsPage({ onManage }: { onManage: () => void }) {
  const { accounts, accountsState, reloadAccounts } = usePlanner();
  if (accountsState.status === 'error') return <div className="p-6"><div className="sp-card"><ErrorState title="Accounts couldn’t load" message={accountsState.error} onRetry={reloadAccounts} /></div></div>;
  const shown: PlatformId[] = [...PRIMARY_PLATFORMS, ...ALL_PLATFORMS.filter((p) => !PRIMARY_PLATFORMS.includes(p) && accounts?.some((a) => a.platform === p))];
  return (
    <div className="space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="sp-muted text-[13.5px]">Accounts Pulse can publish to. Tokens are stored encrypted on the server.</p>
        <Button variant="primary" icon={<Plug size={15} />} onClick={onManage}>Connect accounts</Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {shown.map((p) => {
          const acc = accounts?.filter((a) => a.platform === p) ?? [];
          return (
            <div key={p} className="sp-card flex items-start gap-3 p-4">
              <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl" style={{ background: PLATFORMS[p].chip }}><PlatformGlyph id={p} size={18} color="#fff" /></span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{PLATFORMS[p].label}</p>
                {accountsState.status === 'loading' ? <Skeleton className="mt-1.5" style={{ height: 14, width: 120 }} />
                  : acc.length ? acc.map((a) => <p key={a.id} className="truncate text-[13px]" style={{ color: '#6ee7b7' }}>{a.handle || 'Connected'}</p>)
                  : <p className="sp-faint text-[13px]">Not connected</p>}
                <p className="sp-faint mt-1.5 text-[12px]">{PLATFORMS[p].autoPublish ? 'Auto-publishing supported' : 'Scheduling only, auto-publishing not available yet'}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------- Inbox ----------

export function InboxPage({ onOpenMessaging }: { onOpenMessaging?: () => void }) {
  return (
    <div className="p-4 sm:p-6">
      <div className="sp-card">
        <EmptyState icon={<Inbox size={20} />} title="Social inbox isn’t connected to Pulse yet"
          body="Comments and DMs from your channels aren’t synced into the planner. Customer conversations live in Messaging."
          action={onOpenMessaging && <Button variant="primary" icon={<MessageSquare size={15} />} onClick={onOpenMessaging}>Open Messaging</Button>} />
      </div>
    </div>
  );
}

// ---------- Settings ----------

export function SettingsPage({ onOpenClassic }: { onOpenClassic?: () => void }) {
  const { prefs, setPrefs } = usePrefs();
  const toast = useToast();
  const [form, setForm] = useState<PlannerPrefs>(prefs);
  const dirty = JSON.stringify(form) !== JSON.stringify(prefs);
  const hourOpts = Array.from({ length: 24 }, (_, h) => ({ value: String(h), label: new Intl.DateTimeFormat(undefined, { hour: 'numeric', hour12: form.hour12 }).format(new Date(2024, 0, 1, h)) }));
  return (
    <div className="space-y-5 p-4 sm:p-6">
      <section className="sp-card max-w-[760px] p-5" aria-labelledby="sp-prefs">
        <h2 id="sp-prefs" className="display text-[15px] font-semibold">Calendar preferences</h2>
        <p className="sp-faint mt-1 text-[12.5px]">Saved for your account on this device.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div><span className="sp-label">Week starts on</span><Segmented<"0" | "1"> label="Week starts on" value={String(form.weekStart) as '0' | '1'} onChange={(v) => setForm({ ...form, weekStart: v === '1' ? 1 : 0 })} options={[{ value: '0', label: 'Sunday' }, { value: '1', label: 'Monday' }]} /></div>
          <div><span className="sp-label">Clock</span><Segmented<"12" | "24"> label="Clock" value={form.hour12 ? '12' : '24'} onChange={(v) => setForm({ ...form, hour12: v === '12' })} options={[{ value: '12', label: '12-hour' }, { value: '24', label: '24-hour' }]} /></div>
          <div>
            <label htmlFor="sp-defhour" className="sp-label">Default posting time</label>
            <select id="sp-defhour" className="sp-input" value={String(form.defaultHour)} onChange={(e) => setForm({ ...form, defaultHour: Number(e.target.value) })}>
              {hourOpts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <fieldset className="sm:col-span-2">
            <legend className="sp-label">Platforms selected on new posts</legend>
            <div className="flex flex-wrap gap-2">
              {ALL_PLATFORMS.map((p) => {
                const on = form.defaultPlatforms.includes(p);
                return <button key={p} type="button" className="sp-pill" aria-pressed={on} onClick={() => setForm({ ...form, defaultPlatforms: on ? form.defaultPlatforms.filter((x) => x !== p) : [...form.defaultPlatforms, p] })}><PlatformGlyph id={p} size={13} color={on ? '#fff' : PLATFORMS[p].dot} />{PLATFORMS[p].label}</button>;
              })}
            </div>
          </fieldset>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" disabled={!dirty} onClick={() => setForm(prefs)}>Discard</Button>
          <Button variant="primary" disabled={!dirty} onClick={() => { setPrefs(form); toast({ tone: 'success', title: 'Preferences saved' }); }}>Save preferences</Button>
        </div>
      </section>
      {onOpenClassic && (
        <section className="sp-card max-w-[760px] p-5" aria-labelledby="sp-classic">
          <h2 id="sp-classic" className="display text-[15px] font-semibold">Integrations and advanced tools</h2>
          <p className="sp-muted mt-1 text-[13.5px]">Postiz channels, OAuth account connections, the publishing worker monitor and the grid planner.</p>
          <Button className="mt-4" icon={<Wrench size={15} />} onClick={onOpenClassic}>Open advanced tools</Button>
        </section>
      )}
    </div>
  );
}

// ---------- Notifications (derived from real posts) ----------

export function useNotifications() {
  const { posts } = usePlanner();
  const now = Date.now();
  const failed = posts.filter((p) => p.status === 'failed');
  const soon = posts.filter((p) => p.status === 'scheduled' && new Date(p.scheduledAt).getTime() >= now && new Date(p.scheduledAt).getTime() < now + 864e5);
  return { failed, soon, count: failed.length };
}

export function NotificationList({ onPick }: { onPick: (p: PlannerPost, el: HTMLElement) => void }) {
  const { failed, soon } = useNotifications();
  const { prefs } = usePrefs();
  if (!failed.length && !soon.length) return <p className="sp-muted px-3 py-6 text-center text-[13px]">You’re all caught up.</p>;
  const item = (p: PlannerPost, tone: 'failed' | 'soon') => (
    <li key={p.id}>
      <button type="button" onClick={(e) => onPick(p, e.currentTarget)} className="flex w-full items-start gap-2.5 rounded-lg p-2.5 text-left hover:bg-[var(--sp-surface-2)]" style={{ background: 'none', border: 0, font: 'inherit', color: 'inherit', cursor: 'pointer' }}>
        <span className="mt-1.5 h-2 w-2 flex-none rounded-full" style={{ background: tone === 'failed' ? 'var(--sp-danger)' : 'var(--sp-accent)' }} aria-hidden />
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-medium">{tone === 'failed' ? 'Failed to publish' : 'Publishing soon'}: {postTitle(p, 40)}</span>
          <span className="sp-faint block text-[12px]">{formatDateTime(p.scheduledAt, prefs.hour12)}</span>
        </span>
      </button>
    </li>
  );
  return <ul className="max-h-[340px] overflow-auto p-1.5">{failed.map((p) => item(p, 'failed'))}{soon.map((p) => item(p, 'soon'))}</ul>;
}

