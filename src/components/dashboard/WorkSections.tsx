/**
 * Dashboard: recent activity, insights drawn from the records, quick actions and the first-run checklist.
 */
import React, { useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, ArrowRight, Briefcase, Calendar, CheckCircle2, Circle, FileText, Inbox, Lightbulb,
  MoveRight, Plus, Share2, Sparkles, Ticket, TrendingUp, UserPlus, Users, Video, X,
} from 'lucide-react';
import type { Insight } from '../../lib/dashboardMetrics';
import { relativeTime } from '../../lib/dashboardMetrics';
import type { DashboardBundle } from '../../lib/dashboardData';
import { Badge, Button, Card, CardHeader, EmptyState, IconButton, Segmented, Skeleton, cx, focusRing } from './ui';

type ActivityRow = DashboardBundle['activities'][number];
type Kind = 'all' | 'deal' | 'lead' | 'ticket';

const KIND_META: Record<Exclude<Kind, 'all'>, { icon: React.ComponentType<{ className?: string }>; tone: string; view: string; label: string }> = {
  deal: { icon: Briefcase, tone: 'bg-[var(--accent-soft)] text-[var(--accent-text)]', view: 'deals', label: 'Deal' },
  lead: { icon: UserPlus, tone: 'bg-[var(--info-soft)] text-[var(--info)]', view: 'leads', label: 'Lead' },
  ticket: { icon: Ticket, tone: 'bg-[var(--warning-soft)] text-[var(--warning)]', view: 'dashboard#work-queues', label: 'Ticket' },
};

function kindOf(a: ActivityRow): Exclude<Kind, 'all'> | null {
  if (a.targetType === 'deal' || /deal|stage/.test(a.type)) return 'deal';
  if (a.targetType === 'ticket' || /ticket/.test(a.type)) return 'ticket';
  if (a.targetType === 'lead' || /lead|contacted|converted|assigned|status|task/.test(a.type)) return 'lead';
  return null;
}

export function ActivityCard({ activities, loading, onOpen }: { activities: ActivityRow[]; loading: boolean; onOpen: (view: string) => void }) {
  const [kind, setKind] = useState<Kind>('all');
  const [expanded, setExpanded] = useState(false);
  const limit = expanded ? 20 : 5;
  const rows = useMemo(() => activities.filter((a) => kind === 'all' || kindOf(a) === kind), [activities, kind]);
  return (
    <Card aria-labelledby="act-title" className="flex flex-col">
      <CardHeader
        id="act-title" title="Recent activity" icon={<Activity className="h-4 w-4" />} subtitle="Latest changes made by your team"
        actions={<Segmented label="Show" size="sm" value={kind} onChange={setKind} options={[{ value: 'all', label: 'All' }, { value: 'deal', label: 'Deals' }, { value: 'lead', label: 'Leads' }, { value: 'ticket', label: 'Tickets' }]} />}
      />
      <div className="px-3 pb-3 flex-1">
        {loading && !activities.length ? (
          <div className="space-y-3 px-2">{[0, 1, 2, 3].map((i) => <div key={i} className="flex gap-3"><Skeleton className="h-8 w-8 rounded-full" /><div className="flex-1 space-y-1.5"><Skeleton className="h-3 w-2/3" /><Skeleton className="h-3 w-1/3" /></div></div>)}</div>
        ) : !rows.length ? (
          <EmptyState icon={<Activity className="h-4 w-4" />} title={kind === 'all' ? 'No activity yet' : 'Nothing of this type yet'} body="New leads, deal changes and resolved tickets will show up here." />
        ) : (
          <ol className="relative">
            {rows.slice(0, limit).map((a, i) => {
              const k = kindOf(a);
              const meta = k ? KIND_META[k] : null;
              const Icon = meta?.icon || Activity;
              return (
                <li key={a.id || i} className="relative">
                  {i < Math.min(rows.length, limit) - 1 && <span className="absolute left-[22px] top-10 bottom-0 w-px bg-[var(--border)]" aria-hidden="true" />}
                  <button
                    type="button"
                    onClick={() => meta && onOpen(meta.view)}
                    disabled={!meta}
                    className={cx('w-full flex items-start gap-3 rounded-lg px-2 py-2 text-left hover:bg-[var(--surface-sunken)] transition-colors disabled:cursor-default disabled:hover:bg-transparent', focusRing)}
                  >
                    <span className={cx('relative z-[1] flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-4 ring-[var(--surface)]', meta?.tone || 'bg-[var(--surface-sunken)] text-[var(--text-muted)]')} aria-hidden="true">
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-medium text-[var(--text)] truncate">{a.title}</span>
                      {a.description && <span className="block text-[12px] text-[var(--text-muted)] line-clamp-2">{a.description}</span>}
                      <span className="mt-0.5 block text-[11px] text-[var(--text-subtle)]">{[a.actor, relativeTime(a.timestamp)].filter(Boolean).join(' · ')}</span>
                    </span>
                    {meta && <MoveRight className="h-3.5 w-3.5 mt-1 text-[var(--text-subtle)] shrink-0" aria-hidden="true" />}
                  </button>
                </li>
              );
            })}
          </ol>
        )}
        {rows.length > 5 && (
          <button type="button" onClick={() => setExpanded((e) => !e)} aria-expanded={expanded} className={cx('mt-1 ml-2 text-[12px] font-medium text-[var(--accent-text)] hover:underline', focusRing)}>
            {expanded ? 'Show less' : `Show ${Math.min(rows.length, 20) - 5} more`}
          </button>
        )}
      </div>
    </Card>
  );
}

const INSIGHT_TONE: Record<Insight['tone'], { icon: React.ComponentType<{ className?: string }>; cls: string; label: string }> = {
  positive: { icon: TrendingUp, cls: 'bg-[var(--success-soft)] text-[var(--success)]', label: 'Good news' },
  warning: { icon: AlertTriangle, cls: 'bg-[var(--warning-soft)] text-[var(--warning)]', label: 'Needs attention' },
  info: { icon: Lightbulb, cls: 'bg-[var(--info-soft)] text-[var(--info)]', label: 'Suggestion' },
};

export function InsightsCard({ insights, loading, onOpen, rangeLabel }: { insights: Insight[]; loading: boolean; onOpen: (view: string) => void; rangeLabel: string }) {
  const attention = insights.filter((i) => i.tone === 'warning').length;
  return (
    <Card aria-labelledby="ins-title" className="flex flex-col">
      <CardHeader
        id="ins-title" title="What needs your attention" icon={<Lightbulb className="h-4 w-4" />}
        subtitle={`From your records · ${rangeLabel.toLowerCase()}`}
        actions={attention ? <Badge tone="warning">{attention} to review</Badge> : undefined}
      />
      <div className="px-3 pb-3 flex-1">
        {loading && !insights.length ? <div className="space-y-2 px-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
          : !insights.length ? <EmptyState icon={<CheckCircle2 className="h-4 w-4" />} title="Nothing needs attention" body="No stalled deals, critical tickets or uncontacted high-scoring leads." />
          : (
            <ul className="space-y-1">
              {insights.map((ins) => {
                const t = INSIGHT_TONE[ins.tone];
                return (
                  <li key={ins.id} className="flex items-start gap-3 rounded-lg px-2 py-2.5 hover:bg-[var(--surface-sunken)] transition-colors">
                    <span className={cx('flex h-7 w-7 shrink-0 items-center justify-center rounded-full', t.cls)}><t.icon className="h-3.5 w-3.5" aria-hidden="true" /><span className="sr-only">{t.label}</span></span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-[var(--text)]">{ins.title}</p>
                      <p className="text-[12px] text-[var(--text-muted)] truncate" title={ins.detail}>{ins.detail}</p>
                    </div>
                    {ins.action && (
                      <Button size="sm" variant="ghost" onClick={() => onOpen(ins.action!.view)} className="shrink-0 text-[var(--accent-text)]">
                        {ins.action.label}<ArrowRight className="h-3 w-3" aria-hidden="true" />
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
      </div>
    </Card>
  );
}

export interface QuickAction { id: string; label: string; description: string; icon: React.ComponentType<{ className?: string }>; onClick: () => void; tone: string }

export function QuickActionsCard({ actions }: { actions: QuickAction[] }) {
  return (
    <Card aria-labelledby="qa-title">
      <CardHeader id="qa-title" title="Quick actions" icon={<Sparkles className="h-4 w-4" />} subtitle="Start common tasks in one click" />
      <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 px-4 pb-4">
        {actions.map((a) => (
          <li key={a.id}>
            <button
              type="button"
              onClick={a.onClick}
              className={cx('group w-full h-full flex flex-col items-start gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-left hover:border-[var(--border-strong)] hover:shadow-sm hover:-translate-y-px transition-all cursor-pointer', focusRing)}
            >
              <span className={cx('flex h-8 w-8 items-center justify-center rounded-lg transition-transform group-hover:scale-105', a.tone)} aria-hidden="true"><a.icon className="h-4 w-4" /></span>
              <span>
                <span className="block text-[13px] font-medium text-[var(--text)]">{a.label}</span>
                <span className="block text-[11px] text-[var(--text-muted)]">{a.description}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export const QUICK_ACTION_ICONS = { UserPlus, Plus, Calendar, Video, FileText, Inbox, Share2 };

export interface ChecklistStep { id: string; label: string; detail: string; done: boolean; action: { label: string; onClick: () => void } }

/** First-run checklist built from what the organization has actually done. */
export function GettingStartedCard({ steps, onDismiss }: { steps: ChecklistStep[]; onDismiss: () => void }) {
  const done = steps.filter((s) => s.done).length;
  return (
    <Card aria-labelledby="gs-title" className="relative overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-1 bg-[var(--surface-sunken)]" aria-hidden="true">
        <div className="h-full bg-[var(--accent)] transition-[width] duration-500" style={{ width: `${(done / steps.length) * 100}%` }} />
      </div>
      <CardHeader
        id="gs-title" title="Get set up" icon={<Users className="h-4 w-4" />} wrap={false}
        subtitle={`${done} of ${steps.length} done. Each step unlocks more of the dashboard.`}
        actions={<IconButton label="Hide the setup checklist" onClick={onDismiss}><X className="h-4 w-4" /></IconButton>}
      />
      <ol className="grid gap-2 px-4 pb-4 grid-cols-2 lg:grid-cols-4">
        {steps.map((s) => (
          <li key={s.id} className={cx('flex flex-col gap-2 rounded-xl border p-3', s.done ? 'border-[var(--border)] bg-[var(--surface-sunken)]/60' : 'border-[var(--border)]')}>
            <span className="flex items-center gap-2 text-[13px] font-medium text-[var(--text)]">
              {s.done ? <CheckCircle2 className="h-4 w-4 text-[var(--success)]" aria-hidden="true" /> : <Circle className="h-4 w-4 text-[var(--text-subtle)]" aria-hidden="true" />}
              <span className={s.done ? 'line-through decoration-[var(--text-subtle)] text-[var(--text-muted)]' : ''}>{s.label}</span>
              <span className="sr-only">{s.done ? '(done)' : '(to do)'}</span>
            </span>
            <span className="text-[12px] text-[var(--text-muted)]">{s.detail}</span>
            {!s.done && <Button size="sm" variant="secondary" className="self-start mt-auto" onClick={s.action.onClick}>{s.action.label}</Button>}
          </li>
        ))}
      </ol>
    </Card>
  );
}
