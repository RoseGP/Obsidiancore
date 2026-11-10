/**
 * AI Command Center sections. Every value shown comes from the organization's records or the server's
 * status endpoints; anything not connected says so.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, AlertTriangle, ArrowRight, Award, Bell, Bot, Briefcase, Calendar, CalendarClock, Check, CheckCircle2, ChevronDown,
  CircleDollarSign, Clock, Cpu, FileText, Flame, Gauge, Globe, Headphones, Inbox, Instagram, Lightbulb, Mail, MessageCircle,
  MessageSquare, Phone, PhoneMissed, Plus, Send, Settings, Sparkles, Target, Trophy, TrendingUp, UserPlus, Users, Video, X, Zap,
} from 'lucide-react';
import type { AgendaItem, AttentionItem, CcConversation, CcInsight, HeadlineKpi } from '../../lib/commandCenter';
import { relativeTime } from '../../lib/dashboardMetrics';
import type { InboundMessage, Mission, MissionsState, ServiceStatus, Voicemail } from '../../lib/commandCenterData';
import { Badge, Button, Card, EmptyState, IconButton, InfoTip, Skeleton, Sparkline, cx, focusRing } from './ui';

// ---------------------------------------------------------------------------
// Section shell: title, subtitle, actions, collapse
// ---------------------------------------------------------------------------
export function CcSection({ id, title, subtitle, icon, actions, collapsed, onToggle, children, className, badge }: {
  id: string; title: string; subtitle?: string; icon: React.ReactNode; actions?: React.ReactNode; collapsed?: boolean; onToggle?: () => void;
  children: React.ReactNode; className?: string; badge?: React.ReactNode;
}) {
  const bodyId = `${id}-body`;
  return (
    <Card as="section" id={id} aria-labelledby={`${id}-title`} className={cx('scroll-mt-4 flex flex-col', className)}>
      <div className="flex items-start gap-3 px-4 sm:px-5 pt-4 pb-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent-text)] ring-1 ring-inset ring-[var(--border)]" aria-hidden="true">{icon}</span>
        <div className="min-w-0 flex-1">
          <h2 id={`${id}-title`} className="flex flex-wrap items-center gap-2 text-[15px] font-semibold tracking-[-0.01em] text-[var(--text)]">{title}{badge}</h2>
          {subtitle && <p className="text-[12px] text-[var(--text-muted)] mt-0.5">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {!collapsed && actions}
          {onToggle && (
            <IconButton label={collapsed ? `Expand ${title}` : `Collapse ${title}`} aria-expanded={!collapsed} aria-controls={bodyId} onClick={onToggle}>
              <ChevronDown className={cx('h-4 w-4 transition-transform', !collapsed && 'rotate-180')} />
            </IconButton>
          )}
        </div>
      </div>
      {!collapsed && <div id={bodyId} className="flex-1 flex flex-col">{children}</div>}
    </Card>
  );
}

const initials = (s: string) => s.trim().split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';

// ---------------------------------------------------------------------------
// 1. Welcome header
// ---------------------------------------------------------------------------
export function WelcomeHeader({ name, greeting, ai, actions, crumbs = ['Home', 'AI Command Center', 'Dashboard', 'Overview'] }: {
  name: string; greeting: string; ai: { claude: boolean | null; gemini: boolean | null }; actions?: React.ReactNode; crumbs?: string[];
}) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 15_000); return () => clearInterval(t); }, []);
  const aiKnown = ai.claude !== null;
  const on = [ai.claude && 'Claude', ai.gemini && 'Gemini'].filter(Boolean) as string[];
  const tone = !aiKnown ? 'neutral' : on.length === 2 ? 'success' : on.length === 1 ? 'warning' : 'danger';
  const statusTitle = !aiKnown ? 'Checking your workspace…' : 'Your workspace is ready.';
  const statusText = !aiKnown ? 'Looking up which AI providers are configured.'
    : on.length === 2 ? 'AI Assistant is online with Claude and Gemini.'
    : on.length === 1 ? `AI Assistant is online with ${on[0]}.`
    : 'AI isn’t set up yet: an administrator adds a Claude or Gemini key.';
  const dot = { success: 'bg-[var(--success)] shadow-[0_0_10px_var(--success)]', warning: 'bg-[var(--warning)]', danger: 'bg-[var(--danger)]', neutral: 'bg-[var(--text-subtle)]' }[tone];

  return (
    <header className="space-y-4">
      <nav aria-label="Breadcrumb">
        <ol className="flex flex-wrap items-center gap-1.5 text-[12px] text-[var(--text-muted)]">
          {crumbs.map((c, i) => (
            <li key={c} className="flex items-center gap-1.5">
              {i > 0 && <span aria-hidden="true" className="text-[var(--text-subtle)]">/</span>}
              <span aria-current={i === crumbs.length - 1 ? 'page' : undefined} className={i === crumbs.length - 1 ? 'font-semibold text-[var(--text)]' : ''}>{c}</span>
            </li>
          ))}
        </ol>
      </nav>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-3">
          <div>
            <p className="text-[12px] font-medium text-[var(--text-muted)] tabular-nums">
              {now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })} · <time dateTime={now.toISOString()}>{now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</time>
            </p>
            <h1 className="cc-title mt-1 text-[28px] sm:text-[34px] font-semibold tracking-[-0.03em] leading-tight">Welcome back{name ? `, ${name}` : ''}</h1>
          </div>
          <p className="cc-card inline-flex rounded-[18px] border bg-[var(--surface)] px-3.5 py-2 text-[13px] text-[var(--text)]">Your AI business command center is ready. Let’s make today productive.</p>
          <p className="flex items-start gap-2 text-[13px] text-[var(--text-muted)]" aria-live="polite">
            <Sparkles className="h-4 w-4 mt-0.5 shrink-0 text-[var(--cc-violet)]" aria-hidden="true" />{greeting}
          </p>
          {actions}
        </div>
        <div role="status" className="cc-card flex items-center gap-3 self-start rounded-[28px] border bg-[var(--surface)] pl-3.5 pr-3 py-2.5 max-w-sm">
          <Sparkles className="h-5 w-5 shrink-0 text-[var(--accent)]" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-[var(--text)]">{statusTitle}</p>
            <p className="text-[12px] text-[var(--text-muted)]">{statusText}</p>
          </div>
          <div className="flex items-center gap-1 shrink-0" aria-hidden="true">
            {(['Claude', 'Gemini'] as const).map((p) => {
              const ok = p === 'Claude' ? ai.claude : ai.gemini;
              return (
                <span key={p} title={`${p}: ${ok ? 'configured' : ok === false ? 'not configured' : 'checking'}`}
                  className={cx('flex h-7 w-7 items-center justify-center rounded-lg text-[12px] font-bold', ok ? (p === 'Claude' ? 'bg-[#d97757] text-white' : 'bg-white text-[#4285f4] ring-1 ring-[var(--border)]') : 'bg-[var(--surface-sunken)] text-[var(--text-subtle)] line-through')}>
                  {p === 'Claude' ? 'A' : 'G'}
                </span>
              );
            })}
            <span className={cx('ml-1 h-2.5 w-2.5 rounded-full', dot)} />
          </div>
        </div>
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// 3. Needs your attention
// ---------------------------------------------------------------------------
const PRIORITY_STYLE = {
  high: { stripe: 'bg-[var(--danger)]', chip: 'danger' as const, label: 'High' },
  medium: { stripe: 'bg-[var(--warning)]', chip: 'warning' as const, label: 'Medium' },
  low: { stripe: 'bg-[var(--info)]', chip: 'info' as const, label: 'Low' },
};
const KIND_ICON: Record<AttentionItem['kind'], React.ComponentType<{ className?: string }>> = {
  lead: UserPlus, message: MessageSquare, call: PhoneMissed, meeting: Video, deal: Briefcase, follow_up: Clock, proposal: FileText, ticket: Headphones,
};

export function AttentionGrid({ items, loading, onAction }: { items: AttentionItem[]; loading: boolean; onAction: (item: AttentionItem) => void }) {
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const shown = all ? items : items.slice(0, 6);
  if (loading && !items.length) return <div className="grid gap-3 px-4 sm:px-5 pb-5 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-36 w-full rounded-xl" />)}</div>;
  if (!items.length) return <EmptyState icon={<CheckCircle2 className="h-4 w-4" />} title="You’re all caught up" body="No urgent leads, unanswered messages, meetings soon, stalled deals or waiting proposals." />;
  return (
    <div className="px-4 sm:px-5 pb-5">
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {shown.map((it, idx) => {
          const p = PRIORITY_STYLE[it.priority]; const Icon = KIND_ICON[it.kind];
          return (
            <li key={it.id} className={cx('relative overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-sunken)] p-3.5 pl-4 flex-col gap-2 hover:border-[var(--border-strong)] transition-colors', !all && idx >= 3 ? 'hidden sm:flex' : 'flex')}>
              <span className={cx('absolute inset-y-0 left-0 w-1', p.stripe)} aria-hidden="true" />
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 min-w-0 text-[12px] text-[var(--text-muted)]"><Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /><span className="truncate">{it.title}</span></span>
                <Badge tone={p.chip}>{p.label}<span className="sr-only"> priority</span></Badge>
              </div>
              <p className="text-[14px] font-semibold text-[var(--text)] truncate" title={it.name}>{it.name}</p>
              <p className="text-[12px] text-[var(--text-muted)] line-clamp-2">{it.description}</p>
              <p className="text-[12px] text-[var(--text)]"><span className="text-[var(--accent-text)] font-medium">Next: </span>{it.nextAction}</p>
              <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                <span className="inline-flex items-center gap-1 text-[11px] text-[var(--text-subtle)]"><Clock className="h-3 w-3" aria-hidden="true" />{it.timeLabel}</span>
                <Button size="sm" variant={it.priority === 'high' ? 'primary' : 'secondary'} disabled={busy === it.id} onClick={async () => { setBusy(it.id); try { await onAction(it); } finally { setBusy(null); } }}>
                  {busy === it.id ? 'Opening…' : it.action.label}<ArrowRight className="h-3 w-3" aria-hidden="true" />
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      {items.length > 3 && <button type="button" onClick={() => setAll((a) => !a)} aria-expanded={all} className={cx('mt-3 text-[12px] font-medium text-[var(--accent-text)] hover:underline cursor-pointer', focusRing, !all && items.length <= 6 && 'sm:hidden')}>{all ? 'Show fewer' : `Show all ${items.length}`}</button>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 4. Upcoming meetings
// ---------------------------------------------------------------------------
export function MeetingsList({ items, loading, error, onJoin, onSchedule }: { items: AgendaItem[]; loading: boolean; error: string | null; onJoin: (a: AgendaItem) => void; onSchedule: () => void }) {
  const [all, setAll] = useState(false);
  if (loading && !items.length) return <div className="space-y-2 px-4 sm:px-5 pb-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full rounded-xl" />)}</div>;
  if (error && !items.length) return <EmptyState icon={<AlertTriangle className="h-4 w-4" />} title="Meetings couldn’t load" body={error} />;
  if (!items.length) return <EmptyState icon={<CalendarClock className="h-4 w-4" />} title="No meetings coming up" body="Scheduled video meetings and calendar events for the next two weeks appear here." action={<Button size="sm" variant="secondary" icon={<Plus className="h-3.5 w-3.5" />} onClick={onSchedule}>Schedule a meeting</Button>} />;
  const shown = all ? items : items.slice(0, 5);
  let lastDay = '';
  return (
    <div className="px-4 sm:px-5 pb-4">
      <ol className="space-y-1.5">
        {shown.map((a) => {
          const header = a.dayLabel !== lastDay ? a.dayLabel : null; lastDay = a.dayLabel;
          return (
            <React.Fragment key={a.id}>
              {header && <li aria-hidden="true" className="pt-2 pb-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-subtle)]">{header}</li>}
              <li className={cx('flex items-center gap-3 rounded-xl border px-3 py-2.5', a.live ? 'border-[var(--success)]/50 bg-[var(--success-soft)]' : 'border-[var(--border)] bg-[var(--surface-sunken)]')}>
                <div className="w-[70px] shrink-0 text-[12px] font-semibold text-[var(--text)] tabular-nums">{new Date(a.start).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-[var(--text)]">{a.title}</p>
                  <p className="truncate text-[11px] text-[var(--text-muted)]">{[a.contact, a.typeLabel].filter(Boolean).join(' · ')}{a.live && <span className="ml-1 text-[var(--success)] font-semibold">· Live now</span>}</p>
                </div>
                {a.roomCode ? <Button size="sm" variant={a.live ? 'primary' : 'secondary'} icon={<Video className="h-3.5 w-3.5" />} onClick={() => onJoin(a)} aria-label={`Join ${a.title}`}>Join</Button>
                  : <Badge>{a.source === 'calendar' ? 'Event' : 'Meeting'}</Badge>}
              </li>
            </React.Fragment>
          );
        })}
      </ol>
      {items.length > 5 && <button type="button" onClick={() => setAll((x) => !x)} aria-expanded={all} className={cx('mt-2 text-[12px] font-medium text-[var(--accent-text)] hover:underline cursor-pointer', focusRing)}>{all ? 'Show fewer' : `Show ${items.length - 5} more`}</button>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 5. Business performance (five KPI cards)
// ---------------------------------------------------------------------------
const KPI_ICONS: Record<HeadlineKpi['id'], React.ComponentType<{ className?: string }>> = { contacts: Users, new_today: UserPlus, open_deals: Briefcase, pipeline: CircleDollarSign, forecast: Target };

export function KpiStrip({ kpis, loading, selected, onSelect }: { kpis: HeadlineKpi[]; loading: boolean; selected: string | null; onSelect: (id: HeadlineKpi['id']) => void }) {
  if (loading && !kpis.length) return <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 px-4 sm:px-5 pb-4">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-36 rounded-xl" />)}</div>;
  return (
    <ul className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 px-4 sm:px-5 pb-4" aria-label="Key business figures">
      {kpis.map((k, i) => {
        const Icon = KPI_ICONS[k.id];
        const on = selected === k.id;
        const tone = !k.change || k.change.good === null ? 'muted' : k.change.good ? 'success' : 'danger';
        return (
          <li key={k.id} className={cx(i === 4 && 'col-span-2 md:col-span-1')}>
            <button
              type="button" onClick={() => onSelect(k.id)} aria-pressed={on} aria-label={`${k.label}: ${k.value}. ${k.change ? `${k.change.text} ${k.compareLabel}` : ''}. Show details`}
              className={cx('group w-full h-full text-left rounded-xl border p-3.5 flex flex-col gap-1.5 transition-all cursor-pointer hover:-translate-y-px', focusRing,
                on ? 'border-[var(--accent)] bg-[var(--accent-soft)] shadow-[0_0_24px_-6px_rgb(91_108_255/0.6)]' : 'border-[var(--border)] bg-[var(--surface-sunken)] hover:border-[var(--border-strong)]')}
            >
              <span className="flex items-center justify-between gap-2 text-[12px] text-[var(--text-muted)]">
                <span className="flex items-center gap-1.5 min-w-0"><Icon className="h-3.5 w-3.5 shrink-0 text-[var(--accent-text)]" aria-hidden="true" /><span className="truncate">{k.label}</span></span>
              </span>
              <span className="text-[22px] sm:text-[24px] font-semibold tracking-[-0.02em] text-[var(--text)] tabular-nums">{k.value}</span>
              <span className="flex flex-wrap items-center gap-1 text-[11px]">
                {k.change ? (
                  <span className={cx('rounded-full px-1.5 py-0.5 font-semibold', tone === 'success' ? 'bg-[var(--success-soft)] text-[var(--success)]' : tone === 'danger' ? 'bg-[var(--danger-soft)] text-[var(--danger)]' : 'bg-[var(--surface-sunken)] text-[var(--text-muted)]')}>
                    {k.change.direction === 'up' ? '↑ ' : k.change.direction === 'down' ? '↓ ' : ''}{k.change.text}
                  </span>
                ) : <span className="text-[var(--text-subtle)]">No earlier data</span>}
                <span className="text-[var(--text-subtle)]">{k.compareLabel}</span>
              </span>
              <span className="mt-auto pt-1"><Sparkline values={k.series} tone={tone === 'danger' ? 'danger' : 'accent'} height={28} /></span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// 6. Daily missions
// ---------------------------------------------------------------------------
function Ring({ pct }: { pct: number }) {
  const r = 30, c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 72 72" className="h-[72px] w-[72px] -rotate-90" aria-hidden="true">
      <circle cx="36" cy="36" r={r} fill="none" stroke="var(--surface-sunken)" strokeWidth="7" />
      <circle cx="36" cy="36" r={r} fill="none" stroke="url(#ccRing)" strokeWidth="7" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(100, Math.max(0, pct)) / 100)} style={{ transition: 'stroke-dashoffset .6s ease' }} />
      <defs><linearGradient id="ccRing" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#5b6cff" /><stop offset="100%" stopColor="#22d3ee" /></linearGradient></defs>
    </svg>
  );
}

export function MissionsPanel({ state, loading, error, onAction, onRetry }: { state: MissionsState | null; loading: boolean; error: string | null; onAction: (m: Mission) => void; onRetry: () => void }) {
  const prevDone = useRef<Set<string>>(new Set());
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!state) return;
    const done = new Set(state.missions.filter((m) => m.done).map((m) => m.id));
    const newly = [...done].filter((id) => prevDone.current.size && !prevDone.current.has(id));
    if (newly.length) { setFresh(new Set(newly)); const t = setTimeout(() => setFresh(new Set()), 2500); prevDone.current = done; return () => clearTimeout(t); }
    prevDone.current = done;
  }, [state]);
  if (loading && !state) return <div className="px-4 sm:px-5 pb-5 space-y-2"><Skeleton className="h-20 w-full rounded-xl" />{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full rounded-xl" />)}</div>;
  if (!state) return <EmptyState icon={<AlertTriangle className="h-4 w-4" />} title="Missions couldn’t load" body={error || undefined} action={<Button size="sm" variant="secondary" onClick={onRetry}>Try again</Button>} />;
  return (
    <div className="px-4 sm:px-5 pb-5 space-y-4">
      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-[var(--border)] bg-[var(--surface-sunken)] p-3">
        <div className="relative">
          <Ring pct={state.completionPct} />
          <span className="absolute inset-0 flex flex-col items-center justify-center"><span className="text-[15px] font-semibold text-[var(--text)] tabular-nums">{Math.round(state.completionPct)}%</span><span className="text-[9px] uppercase tracking-wider text-[var(--text-subtle)]">today</span></span>
        </div>
        <dl className="grid grid-cols-3 gap-4 flex-1 min-w-[220px]">
          <div><dt className="text-[11px] text-[var(--text-subtle)]">Completed</dt><dd className="text-[16px] font-semibold text-[var(--text)] tabular-nums">{state.completedCount}/{state.totalCount}</dd></div>
          <div><dt className="text-[11px] text-[var(--text-subtle)]">XP today</dt><dd className="text-[16px] font-semibold text-[var(--accent-text)] tabular-nums">+{state.xpToday}</dd><dd className="text-[10px] text-[var(--text-subtle)]">{state.totalXp.toLocaleString()} total</dd></div>
          <div><dt className="text-[11px] text-[var(--text-subtle)]">Streak</dt><dd className="flex items-center gap-1 text-[16px] font-semibold text-[var(--text)] tabular-nums"><Flame className={cx('h-4 w-4', state.streak.current ? 'text-[var(--warning)]' : 'text-[var(--text-subtle)]')} aria-hidden="true" />{state.streak.current} day{state.streak.current === 1 ? '' : 's'}</dd><dd className="text-[10px] text-[var(--text-subtle)]">best {state.streak.best}</dd></div>
        </dl>
      </div>
      {state.missions.length ? (
        <ul className="space-y-2" aria-label="Today’s missions">
          {state.missions.map((m) => {
            const pct = m.target ? Math.min(100, (m.progress / m.target) * 100) : 0;
            return (
              <li key={m.id} className={cx('flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors', m.done ? 'border-[var(--success)]/40 bg-[var(--success-soft)]' : 'border-[var(--border)] bg-[var(--surface-sunken)]')}>
                <span className={cx('flex h-7 w-7 shrink-0 items-center justify-center rounded-full', m.done ? 'bg-[var(--success)] text-[#03231a]' : 'bg-[var(--accent-soft)] text-[var(--accent-text)]', fresh.has(m.id) && 'cc-pop')} aria-hidden="true">
                  {m.done ? <Check className="h-4 w-4" /> : <Zap className="h-3.5 w-3.5" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-[13px] font-medium text-[var(--text)]">{m.title}<span className="sr-only">{m.done ? ' (done)' : ''}</span></p>
                    <span className="shrink-0 text-[11px] font-semibold text-[var(--accent-text)] tabular-nums">+{m.xp} XP</span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <div className="h-1.5 flex-1 rounded-full bg-[var(--surface-sunken)] overflow-hidden" role="progressbar" aria-valuenow={m.progress} aria-valuemin={0} aria-valuemax={m.target} aria-label={`${m.title}: ${m.progress} of ${m.target}`}>
                      <div className="h-full rounded-full bg-gradient-to-r from-[#5b6cff] to-[#22d3ee] transition-[width] duration-500" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-[11px] text-[var(--text-muted)] tabular-nums">{m.progress}/{m.target}</span>
                  </div>
                </div>
                {!m.done && m.action && <Button size="sm" variant="ghost" onClick={() => onAction(m)} className="text-[var(--accent-text)] shrink-0">{m.action.label}</Button>}
              </li>
            );
          })}
        </ul>
      ) : <p className="text-[12px] text-[var(--text-muted)]">No missions today: there’s no open work they would count. New leads, drafts and voicemails create missions automatically.</p>}
      {!!state.badges.length && (
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-subtle)]">Achievements</p>
          <ul className="flex flex-wrap gap-1.5">
            {state.badges.map((b) => (
              <li key={b.id} title={`${b.label}: ${b.description}${b.earned ? '' : ' (not earned yet)'}`}>
                <span className={cx('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px]', b.earned ? 'border-[var(--warning)]/40 bg-[var(--warning-soft)] text-[var(--warning)]' : 'border-[var(--border)] text-[var(--text-subtle)] opacity-70')}>
                  {b.earned ? <Trophy className="h-3 w-3" aria-hidden="true" /> : <Award className="h-3 w-3" aria-hidden="true" />}{b.label}<span className="sr-only">{b.earned ? ' (earned)' : ' (not earned yet)'}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 7. Live omnichannel activity
// ---------------------------------------------------------------------------
type Channel = 'all' | 'whatsapp' | 'email' | 'sms' | 'telegram' | 'instagram' | 'voice' | 'website';
const CHANNELS: { id: Exclude<Channel, 'all'>; label: string; icon: React.ComponentType<{ className?: string }>; color: string }[] = [
  { id: 'whatsapp', label: 'WhatsApp', icon: MessageCircle, color: '#25d366' },
  { id: 'email', label: 'Email', icon: Mail, color: '#60a5fa' },
  { id: 'sms', label: 'SMS', icon: MessageSquare, color: '#a78bfa' },
  { id: 'telegram', label: 'Telegram', icon: Send, color: '#38bdf8' },
  { id: 'instagram', label: 'Instagram', icon: Instagram, color: '#f472b6' },
  { id: 'voice', label: 'Voice calls', icon: Phone, color: '#fbbf24' },
  { id: 'website', label: 'Website chat', icon: Globe, color: '#22d3ee' },
];
export interface FeedItem {
  id: string; channel: Exclude<Channel, 'all'>; contact: string; preview: string; at: string; unread: boolean; priority: 'urgent' | 'high' | 'medium' | 'low' | 'new' | null;
  reply: { kind: 'conversation'; conversationId: string } | { kind: 'send'; to: string; channel: 'WHATSAPP' | 'SMS' } | { kind: 'call'; to: string } | null;
  outgoing?: boolean;
}

export function buildFeed(conversations: CcConversation[], inbound: InboundMessage[], voicemails: Voicemail[]): FeedItem[] {
  const conv: FeedItem[] = conversations.filter((c) => c.lastMessage).map((c) => {
    const lm = c.lastMessage!;
    const fromCustomer = lm.senderType === 'visitor' || lm.senderType === 'contact';
    const channel: FeedItem['channel'] = c.channel === 'email' ? 'email' : c.channel === 'sms' ? 'sms' : 'website';
    return {
      id: `c:${c.id}`, channel, contact: fromCustomer ? lm.senderName || c.title : c.title, preview: lm.content || '', at: lm.createdAt || c.updatedAt || '',
      unread: (c.unreadCount || 0) > 0, priority: (c.priority as any) || null, outgoing: !fromCustomer,
      reply: { kind: 'conversation', conversationId: c.id },
    };
  });
  const msgs: FeedItem[] = inbound.map((m) => ({
    id: `m:${m.id}`, channel: String(m.channel).toUpperCase() === 'WHATSAPP' ? 'whatsapp' : 'sms', contact: m.contactName || m.from, preview: m.body, at: m.at,
    unread: true, priority: 'new', reply: { kind: 'send', to: m.from, channel: String(m.channel).toUpperCase() === 'WHATSAPP' ? 'WHATSAPP' : 'SMS' },
  }));
  const vms: FeedItem[] = voicemails.map((v) => ({
    id: `v:${v.id}`, channel: 'voice', contact: v.from, preview: `Voicemail${v.durationSeconds ? ` · ${v.durationSeconds}s` : ''}`, at: v.at,
    unread: !v.reviewedAt, priority: v.reviewedAt ? null : 'new', reply: { kind: 'call', to: v.from },
  }));
  return [...conv, ...msgs, ...vms].sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

export function LiveFeed({ items, loading, errors, notConnected, onReply, onOpenInbox, onCall }: {
  items: FeedItem[]; loading: boolean; errors: string[]; notConnected: Set<string>;
  onReply: (item: FeedItem, text: string) => Promise<{ ok: boolean; message: string }>; onOpenInbox: () => void; onCall: () => void;
}) {
  const [filter, setFilter] = useState<Channel>('all');
  const [replying, setReplying] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [status, setStatus] = useState<{ id: string; ok: boolean; message: string } | null>(null);
  const [sending, setSending] = useState(false);
  const counts = useMemo(() => Object.fromEntries(CHANNELS.map((c) => [c.id, items.filter((i) => i.channel === c.id).length])), [items]);
  const shown = items.filter((i) => filter === 'all' || i.channel === filter).slice(0, 8);
  const meta = (id: string) => CHANNELS.find((c) => c.id === id)!;

  return (
    <div className="px-4 sm:px-5 pb-4 flex flex-col gap-3">
      <div role="radiogroup" aria-label="Filter by channel" className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
        {[{ id: 'all' as Channel, label: 'All', n: items.length }, ...CHANNELS.map((c) => ({ id: c.id as Channel, label: c.label, n: counts[c.id] }))].map((c) => {
          const off = c.id !== 'all' && notConnected.has(c.id) && !c.n;
          return (
            <button key={c.id} type="button" role="radio" aria-checked={filter === c.id} onClick={() => setFilter(c.id)}
              title={off ? `${c.label} isn’t connected` : undefined}
              className={cx('shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer', focusRing,
                filter === c.id ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-text)]' : 'border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)]', off && 'opacity-50')}>
              {c.label}<span className="ml-1 tabular-nums text-[var(--text-subtle)]">{off ? '·' : c.n}</span>
            </button>
          );
        })}
      </div>
      {errors.length > 0 && <p className="text-[11px] text-[var(--warning)]">{errors.join(' ')}</p>}
      {loading && !items.length ? <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-14 w-full rounded-xl" />)}</div>
        : !shown.length ? (
          filter !== 'all' && notConnected.has(filter)
            ? <EmptyState icon={<Activity className="h-4 w-4" />} title={`${meta(filter).label} isn’t connected`} body="Connect it to see its messages here. Telegram and Instagram aren’t supported yet." />
            : <EmptyState icon={<Activity className="h-4 w-4" />} title="No activity yet" body="Website chats, WhatsApp, SMS, email and voicemails appear here as they arrive." />
        ) : (
          <ul className="space-y-1.5" aria-live="polite">
            {shown.map((i) => {
              const m = meta(i.channel); const Icon = m.icon;
              return (
                <li key={i.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface-sunken)] px-3 py-2.5">
                  <div className="flex items-start gap-3">
                    <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold text-white" style={{ background: `linear-gradient(135deg, ${m.color}, #3b3f8f)` }} aria-hidden="true">
                      {initials(i.contact)}
                      <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--surface-raised)] ring-1 ring-[var(--border)]"><Icon className="h-2.5 w-2.5" /></span>
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className={cx('truncate text-[13px] text-[var(--text)]', i.unread ? 'font-semibold' : 'font-medium')}>{i.contact}</p>
                        {i.unread && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--cc-cyan)]" aria-label="Unread" />}
                        <span className="ml-auto shrink-0 text-[11px] text-[var(--text-subtle)]">{relativeTime(i.at)}</span>
                      </div>
                      <p className="truncate text-[12px] text-[var(--text-muted)]">{i.outgoing && <span className="text-[var(--text-subtle)]">You: </span>}{i.preview}</p>
                      <div className="mt-1 flex items-center gap-1.5">
                        <span className="text-[10px] text-[var(--text-subtle)]">{m.label}</span>
                        {(i.priority === 'urgent' || i.priority === 'high') && <Badge tone="danger">{i.priority === 'urgent' ? 'Urgent' : 'High priority'}</Badge>}
                        {i.priority === 'new' && <Badge tone="info">New</Badge>}
                        <span className="ml-auto" />
                        {i.reply?.kind === 'call'
                          ? <Button size="sm" variant="ghost" icon={<Phone className="h-3.5 w-3.5" />} onClick={onCall}>Call back</Button>
                          : i.reply && <Button size="sm" variant="ghost" onClick={() => { setReplying(replying === i.id ? null : i.id); setText(''); setStatus(null); }} aria-expanded={replying === i.id}>Quick reply</Button>}
                      </div>
                    </div>
                  </div>
                  {replying === i.id && (
                    <form className="mt-2 flex gap-2" onSubmit={async (e) => {
                      e.preventDefault(); if (!text.trim()) return; setSending(true);
                      const r = await onReply(i, text.trim()); setSending(false); setStatus({ id: i.id, ...r }); if (r.ok) { setText(''); setReplying(null); }
                    }}>
                      <label className="sr-only" htmlFor={`qr-${i.id}`}>Reply to {i.contact}</label>
                      <input id={`qr-${i.id}`} autoFocus value={text} onChange={(e) => setText(e.target.value)} maxLength={1600} placeholder={`Reply to ${i.contact}…`} className={cx('flex-1 min-w-0 h-9 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-[13px] text-[var(--text)] placeholder:text-[var(--text-subtle)]', focusRing)} />
                      <Button type="submit" size="sm" variant="primary" disabled={sending || !text.trim()} icon={<Send className="h-3.5 w-3.5" />}>{sending ? 'Sending…' : 'Send'}</Button>
                      <IconButton label="Cancel reply" onClick={() => setReplying(null)}><X className="h-4 w-4" /></IconButton>
                    </form>
                  )}
                  {status?.id === i.id && <p role={status.ok ? 'status' : 'alert'} className={cx('mt-1.5 text-[11px]', status.ok ? 'text-[var(--success)]' : 'text-[var(--danger)]')}>{status.message}</p>}
                </li>
              );
            })}
          </ul>
        )}
      <div className="flex justify-end"><button type="button" onClick={onOpenInbox} className={cx('text-[12px] font-medium text-[var(--accent-text)] hover:underline cursor-pointer', focusRing)}>Open unified inbox →</button></div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 8. Business tools
// ---------------------------------------------------------------------------
export interface Tool { id: string; label: string; description: string; icon: React.ComponentType<{ className?: string }>; cta: string; onClick: () => void; color: string }
export function ToolsGrid({ tools }: { tools: Tool[] }) {
  return (
    <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-2 2xl:grid-cols-3 gap-2.5 px-4 sm:px-5 pb-5">
      {tools.map((t) => (
        <li key={t.id}>
          <button type="button" onClick={t.onClick} className={cx('group w-full h-full text-left rounded-xl border border-[var(--border)] bg-[var(--surface-sunken)] p-3 flex flex-col gap-2 transition-all cursor-pointer hover:-translate-y-px hover:border-[var(--border-strong)]', focusRing)}>
            <span className="flex h-8 w-8 items-center justify-center rounded-lg transition-shadow group-hover:shadow-[0_0_16px_-2px_currentColor]" style={{ color: t.color, background: `color-mix(in srgb, ${t.color} 16%, transparent)` }} aria-hidden="true"><t.icon className="h-4 w-4" /></span>
            <span>
              <span className="block text-[13px] font-medium text-[var(--text)]">{t.label}</span>
              <span className="block text-[11px] text-[var(--text-muted)] line-clamp-2">{t.description}</span>
            </span>
            <span className="mt-auto inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--accent-text)]">{t.cta}<ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" aria-hidden="true" /></span>
          </button>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// 9. SLA and service monitoring
// ---------------------------------------------------------------------------
type Light = 'green' | 'yellow' | 'red' | 'grey';
const LIGHT: Record<Light, string> = { green: 'bg-[var(--success)] shadow-[0_0_8px_var(--success)]', yellow: 'bg-[var(--warning)]', red: 'bg-[var(--danger)] shadow-[0_0_8px_var(--danger)]', grey: 'bg-[var(--text-subtle)]' };
const LIGHT_LABEL: Record<Light, string> = { green: 'On target', yellow: 'Watch', red: 'Needs action', grey: 'No data' };

export function ServicePanel({ s, loading, error, onRetry }: { s: ServiceStatus | null; loading: boolean; error: string | null; onRetry: () => void }) {
  if (loading && !s) return <div className="px-4 sm:px-5 pb-5 space-y-2">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-8 w-full" />)}</div>;
  if (!s) return <EmptyState icon={<AlertTriangle className="h-4 w-4" />} title="Service status couldn’t load" body={error || undefined} action={<Button size="sm" variant="secondary" onClick={onRetry}>Try again</Button>} />;
  const sla: Light = s.slaMetRate === null ? 'grey' : s.slaMetRate >= 99 ? 'green' : s.slaMetRate >= 90 ? 'yellow' : 'red';
  const frt: Light = s.avgFirstResponseMinutes === null ? 'grey' : s.avgFirstResponseMinutes <= s.slaTargetMinutes ? 'green' : s.avgFirstResponseMinutes <= s.slaTargetMinutes * 2 ? 'yellow' : 'red';
  const missed: Light = s.missedCalls.count === null ? 'grey' : s.missedCalls.count === 0 ? 'green' : s.missedCalls.count <= 2 ? 'yellow' : 'red';
  const unanswered: Light = s.unansweredCount === 0 ? 'green' : s.unansweredCount <= 5 ? 'yellow' : 'red';
  const aiOn = [s.ai.claude.configured, s.ai.gemini.configured].filter(Boolean).length;
  const ai: Light = aiOn === 2 ? 'green' : aiOn === 1 ? 'yellow' : 'red';
  const rows: { label: string; value: string; light: Light; hint: string }[] = [
    { label: 'SLA met', value: s.slaMetRate === null ? 'Not enough data' : `${s.slaMetRate.toFixed(s.slaMetRate >= 99.95 ? 0 : 1)}%`, light: sla, hint: `Share of conversations in the last ${s.windowDays} days answered within ${s.slaTargetMinutes} minutes. Target 99%+. Measured on ${s.measuredConversations} conversation(s).` },
    { label: 'Avg first response', value: s.avgFirstResponseMinutes === null ? 'Not enough data' : s.avgFirstResponseMinutes < 1 ? '< 1 min' : `${Math.round(s.avgFirstResponseMinutes)} min`, light: frt, hint: `Average time from a customer’s first message to your team’s first reply (target ${s.slaTargetMinutes} min).` },
    { label: 'Missed calls', value: s.missedCalls.count === null ? 'Phone not connected' : `${s.missedCalls.count} in ${s.missedCalls.windowHours} h`, light: missed, hint: 'Calls that went to voicemail.' },
    { label: 'Unanswered messages', value: String(s.unansweredCount), light: unanswered, hint: 'Open conversations and WhatsApp/SMS messages still waiting for your reply.' },
    { label: 'AI agents', value: aiOn === 2 ? 'Claude + Gemini' : aiOn === 1 ? (s.ai.claude.configured ? 'Claude only' : 'Gemini only') : 'Not configured', light: ai, hint: 'AI providers configured on this server. With both, each backs up the other.' },
  ];
  const overall = s.overall;
  return (
    <div className="px-4 sm:px-5 pb-5 space-y-3">
      <div className={cx('flex items-center gap-2 rounded-xl px-3 py-2 text-[12px] font-medium', overall === 'green' ? 'bg-[var(--success-soft)] text-[var(--success)]' : overall === 'yellow' ? 'bg-[var(--warning-soft)] text-[var(--warning)]' : 'bg-[var(--danger-soft)] text-[var(--danger)]')} role="status">
        <span className={cx('h-2.5 w-2.5 rounded-full', LIGHT[overall])} aria-hidden="true" />
        {overall === 'green' ? 'All services on target' : overall === 'yellow' ? 'Some services need watching' : 'Service needs attention'}
      </div>
      <dl className="divide-y divide-[var(--border)]">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center gap-2 py-2">
            <span className={cx('h-2 w-2 shrink-0 rounded-full', LIGHT[r.light])} aria-hidden="true" />
            <dt className="flex-1 text-[12px] text-[var(--text-muted)] flex items-center gap-1">{r.label}<InfoTip text={r.hint} label={`About ${r.label}`} /></dt>
            <dd className="text-[12px] font-medium text-[var(--text)] tabular-nums text-right">{r.value}<span className="sr-only"> ({LIGHT_LABEL[r.light]})</span></dd>
          </div>
        ))}
      </dl>
      <div>
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-subtle)]">Channel delivery</p>
        <ul className="flex flex-wrap gap-1.5">
          {s.channels.map((c) => (
            <li key={c.id} title={c.detail || undefined}>
              <span className={cx('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px]', c.status === 'connected' ? 'border-[var(--success)]/40 text-[var(--success)]' : c.status === 'not_configured' ? 'border-[var(--warning)]/40 text-[var(--warning)]' : 'border-[var(--border)] text-[var(--text-subtle)]')}>
                <span className={cx('h-1.5 w-1.5 rounded-full', c.status === 'connected' ? 'bg-[var(--success)]' : c.status === 'not_configured' ? 'bg-[var(--warning)]' : 'bg-[var(--text-subtle)]')} aria-hidden="true" />
                {c.label}<span className="sr-only">: {c.status === 'connected' ? 'connected' : c.status === 'not_configured' ? 'not configured' : 'not available'}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 10. AI business insights
// ---------------------------------------------------------------------------
export function InsightsList({ insights, loading, onOpen, onAsk }: { insights: CcInsight[]; loading: boolean; onOpen: (view: string) => void; onAsk: (q: string) => void }) {
  const [all, setAll] = useState(false);
  if (loading && !insights.length) return <div className="px-4 sm:px-5 pb-5 space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}</div>;
  if (!insights.length) return <EmptyState icon={<Lightbulb className="h-4 w-4" />} title="No insights yet" body="As leads, deals and conversations build up, patterns worth acting on show up here." action={<Button size="sm" variant="secondary" icon={<Bot className="h-3.5 w-3.5" />} onClick={() => onAsk('What should I focus on today to grow my business?')}>Ask your copilot</Button>} />;
  const shown = all ? insights : insights.slice(0, 3);
  const TONE = { positive: { icon: TrendingUp, cls: 'bg-[var(--success-soft)] text-[var(--success)]' }, warning: { icon: AlertTriangle, cls: 'bg-[var(--warning-soft)] text-[var(--warning)]' }, info: { icon: Lightbulb, cls: 'bg-[var(--info-soft)] text-[var(--info)]' } };
  return (
    <div className="px-4 sm:px-5 pb-5">
      <ul className="space-y-2">
        {shown.map((i) => {
          const t = TONE[i.tone];
          return (
            <li key={i.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface-sunken)] p-3">
              <div className="flex items-start gap-3">
                <span className={cx('flex h-8 w-8 shrink-0 items-center justify-center rounded-full', t.cls)} aria-hidden="true"><t.icon className="h-4 w-4" /></span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-[var(--text)]">{i.title}</p>
                  <p className="text-[12px] text-[var(--text-muted)]">{i.detail}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {i.action && <Button size="sm" variant="secondary" onClick={() => onOpen(i.action!.view)}>{i.action.label}</Button>}
                    {i.ask && <Button size="sm" variant="ghost" icon={<Sparkles className="h-3.5 w-3.5 text-[var(--cc-cyan)]" />} onClick={() => onAsk(i.ask!)}>Ask copilot</Button>}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {insights.length > 3 && <button type="button" onClick={() => setAll((a) => !a)} aria-expanded={all} className={cx('mt-3 text-[12px] font-medium text-[var(--accent-text)] hover:underline cursor-pointer', focusRing)}>{all ? 'Show top 3 only' : `Show ${insights.length - 3} more insight${insights.length - 3 === 1 ? '' : 's'}`}</button>}
    </div>
  );
}

export const CC_ICONS = { Activity, Bot, Briefcase, Calendar, CalendarClock, FileText, Gauge, Headphones, Inbox, Lightbulb, Phone, Plus, Sparkles, Target, Trophy, Users, Video, Zap };
