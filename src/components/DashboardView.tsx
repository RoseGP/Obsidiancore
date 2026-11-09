/**
 * Dashboard: the organization's day at a glance.
 *
 *   Header        greeting, a one-line summary from real records, primary actions
 *   Toolbar       date range (today / 7 / 30 / 90 days / custom), refresh, export (CSV, print/PDF), customize
 *   Sections      KPIs with trend + sparkline · performance over time · what needs attention ·
 *                 pipeline by stage · lead sources · recent activity · quick actions · AI assistant · work queues
 *
 * Every figure comes from /api/dashboard (deals, leads, tickets, activity), loaded once and shared with
 * the work-queue widgets (lib/dashboardData). Section order, visibility and the date range are saved per
 * person in this browser. Nothing on this page is sample data.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot, Calendar, ChevronDown, Download, FileSpreadsheet, FileText, Inbox, LayoutGrid, Plus, Printer, RefreshCw,
  SlidersHorizontal, UserPlus, Video, AlertCircle, CheckCircle2,
} from 'lucide-react';
import { CRMContact } from '../types';
import UnifiedAssistant from './assistant/UnifiedAssistant';
import CustomizableWidgetGrid from './dashboard/CustomizableWidgetGrid';
import { useOptionalAuth } from '../context/AuthContext';
import { useTeamMembers } from '../hooks/useTeamMembers';
import { useDashboardData } from '../lib/dashboardData';
import {
  RANGE_OPTIONS, type RangeKey, buildInsights, computeKpis, exportRows, formatValue, isOpenDeal, relativeTime, resolveRange, toCsv,
} from '../lib/dashboardMetrics';
import { KpiGrid, LeadSourcesCard, PerformanceCard, PipelineCard } from './dashboard/AnalyticsSections';
import { ActivityCard, GettingStartedCard, InsightsCard, QuickActionsCard, type ChecklistStep, type QuickAction } from './dashboard/WorkSections';
import { CustomizeDialog, NewDealDialog, type SectionPref } from './dashboard/Dialogs';
import { Button, Card, CardHeader, IconButton, Segmented, cx, focusRing } from './dashboard/ui';

interface DashboardViewProps {
  contacts: CRMContact[];
  onSelectContact: (contact: CRMContact) => void;
  onNavigate: (view: any) => void;
  /** Opens the app's quick-create flow (lead / deal / event). */
  onQuickAction?: (type: 'lead' | 'deal' | 'event') => void;
  /** Opens Settings on a given tab. */
  onOpenSettings?: (tab: string) => void;
}

const SECTIONS: SectionPref[] = [
  { id: 'kpis', label: 'Key figures', description: 'Leads, pipeline, revenue, win rate, conversion, tickets' },
  { id: 'performance', label: 'Performance over time', description: 'Trend chart with previous-period comparison' },
  { id: 'insights', label: 'What needs your attention', description: 'Stalled deals, critical tickets, uncontacted leads' },
  { id: 'pipeline', label: 'Pipeline by stage', description: 'Open deals by stage, by value or count' },
  { id: 'sources', label: 'Lead sources', description: 'Where this period’s leads came from' },
  { id: 'activity', label: 'Recent activity', description: 'Latest changes made by your team' },
  { id: 'quick_actions', label: 'Quick actions', description: 'Shortcuts to common tasks' },
  { id: 'assistant', label: 'AI assistant', description: 'Ask about your customers, deals and schedule' },
  { id: 'work_queues', label: 'Work queues', description: 'Leads, opportunities and tickets to act on' },
];
const DEFAULT_ORDER = SECTIONS.map((s) => s.id);
const SPAN: Record<string, string> = {
  kpis: 'lg:col-span-12', quick_actions: 'lg:col-span-12', assistant: 'lg:col-span-12', work_queues: 'lg:col-span-12',
  performance: 'lg:col-span-8', insights: 'lg:col-span-4', pipeline: 'lg:col-span-4', sources: 'lg:col-span-4', activity: 'lg:col-span-4',
};

interface Prefs { order: string[]; hidden: string[]; range: RangeKey; custom: { from: string; to: string }; checklistDismissed: boolean; customized: boolean; assistantOpen: boolean }
const isoDay = (t: number) => new Date(t - new Date(t).getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
const DEFAULT_PREFS: Prefs = {
  order: DEFAULT_ORDER, hidden: [], range: '30d',
  custom: { from: isoDay(Date.now() - 29 * 86_400_000), to: isoDay(Date.now()) },
  checklistDismissed: false, customized: false, assistantOpen: true,
};

function usePrefs(userKey: string) {
  const key = `obsidian_dashboard_v3:${userKey || 'anon'}`;
  const read = (): Prefs => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return DEFAULT_PREFS;
      const p = JSON.parse(raw);
      const order = Array.isArray(p.order) ? p.order.filter((id: string) => DEFAULT_ORDER.includes(id)) : DEFAULT_ORDER;
      for (const id of DEFAULT_ORDER) if (!order.includes(id)) order.push(id); // sections added later appear too
      return { ...DEFAULT_PREFS, ...p, order, hidden: Array.isArray(p.hidden) ? p.hidden : [] };
    } catch { return DEFAULT_PREFS; }
  };
  const [prefs, setPrefs] = useState<Prefs>(read);
  useEffect(() => { setPrefs(read()); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const update = useCallback((patch: Partial<Prefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* storage unavailable: preferences last this visit */ }
      return next;
    });
  }, [key]);
  return [prefs, update] as const;
}

function download(name: string, text: string, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob(['﻿', text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function DashboardView({ contacts, onSelectContact, onNavigate, onQuickAction, onOpenSettings }: DashboardViewProps) {
  const auth = useOptionalAuth();
  const userKey = auth?.user?.uid || auth?.userProfile?.uid || '';
  const firstName = (auth?.userProfile?.displayName || '').trim().split(/\s+/)[0] || '';
  const team = useTeamMembers();
  const [prefs, setPrefs] = usePrefs(userKey);
  const { data, loading, error, updatedAt, refresh } = useDashboardData();
  const [dealOpen, setDealOpen] = useState(false);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [toast, setToast] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [, tick] = useState(0);
  const exportRef = useRef<HTMLDivElement>(null);

  // Keep "Updated x min ago" honest without refetching.
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 60_000); return () => clearInterval(t); }, []);
  useEffect(() => {
    if (!exportOpen) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !exportRef.current?.contains(e.target as Node)) setExportOpen(false);
    };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [exportOpen]);
  // The header's Help menu can bring the setup checklist back.
  useEffect(() => {
    const show = () => setPrefs({ checklistDismissed: false });
    window.addEventListener('obsidian:show-setup', show);
    return () => window.removeEventListener('obsidian:show-setup', show);
  }, [setPrefs]);

  const notify = (kind: 'ok' | 'error', text: string) => { setToast({ kind, text }); setTimeout(() => setToast(null), 4000); };

  const range = useMemo(() => resolveRange(prefs.range, Date.now(), prefs.custom), [prefs.range, prefs.custom]);
  const records = data || { deals: [], leads: [], tickets: [], activities: [] };
  const kpis = useMemo(() => (data ? computeKpis(data, range) : []), [data, range]);
  const insights = useMemo(() => (data ? buildInsights(data, range) : []), [data, range]);

  const open = useCallback((view: string) => {
    if (view.startsWith('dashboard#')) {
      document.getElementById(view.slice('dashboard#'.length))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    onNavigate(view);
  }, [onNavigate]);

  // ---- Header summary: one sentence from real records ----
  const hour = new Date().getHours();
  const greeting = `${hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'}${firstName ? `, ${firstName}` : ''}`;
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  const openDeals = records.deals.filter(isOpenDeal);
  const openValue = openDeals.reduce((s, d) => s + (Number(d.value) || 0), 0);
  const attention = insights.filter((i) => i.tone === 'warning').length;
  const summary = loading && !data ? 'Loading your numbers…'
    : !records.deals.length && !records.leads.length ? 'Your workspace is ready. Add a lead or a deal to see your numbers here.'
    : `${openDeals.length} open deal${openDeals.length === 1 ? '' : 's'} worth ${formatValue(openValue, 'currency')}`
      + (attention ? ` · ${attention} item${attention === 1 ? '' : 's'} need${attention === 1 ? 's' : ''} attention.` : ' · nothing urgent right now.');

  // ---- Quick actions ----
  const quickActions: QuickAction[] = [
    { id: 'lead', label: 'Add lead', description: 'Capture a new contact', icon: UserPlus, tone: 'bg-[var(--info-soft)] text-[var(--info)]', onClick: () => (onQuickAction ? onQuickAction('lead') : open('leads')) },
    { id: 'deal', label: 'New deal', description: 'Add to your pipeline', icon: Plus, tone: 'bg-[var(--accent-soft)] text-[var(--accent-text)]', onClick: () => setDealOpen(true) },
    { id: 'event', label: 'Schedule', description: 'Book a meeting', icon: Calendar, tone: 'bg-[var(--success-soft)] text-[var(--success)]', onClick: () => (onQuickAction ? onQuickAction('event') : open('calendar')) },
    { id: 'meet', label: 'Start a meeting', description: 'Video call now', icon: Video, tone: 'bg-[var(--warning-soft)] text-[var(--warning)]', onClick: () => open('greet') },
    { id: 'proposal', label: 'New proposal', description: 'Quote and e-sign', icon: FileText, tone: 'bg-[var(--surface-sunken)] text-[var(--text)]', onClick: () => open('proposals') },
    { id: 'inbox', label: 'Open inbox', description: 'Chats and messages', icon: Inbox, tone: 'bg-[var(--danger-soft)] text-[var(--danger)]', onClick: () => open('messages') },
  ];

  // ---- First-run checklist: derived from what actually exists ----
  const steps: ChecklistStep[] = [
    { id: 'lead', label: 'Add your first lead', detail: 'Leads feed every figure on this page.', done: records.leads.length > 0, action: { label: 'Add a lead', onClick: quickActions[0].onClick } },
    { id: 'deal', label: 'Create a deal', detail: 'Track value and stage in your pipeline.', done: records.deals.length > 0, action: { label: 'New deal', onClick: () => setDealOpen(true) } },
    { id: 'team', label: 'Invite a teammate', detail: 'Share leads and assign owners.', done: team.members.length > 1, action: { label: 'Invite', onClick: () => (onOpenSettings ? onOpenSettings('workspace') : open('settings')) } },
    { id: 'layout', label: 'Make the dashboard yours', detail: 'Hide or reorder sections you don’t need.', done: prefs.customized, action: { label: 'Customize', onClick: () => setCustomizeOpen(true) } },
  ];
  const showChecklist = !prefs.checklistDismissed && !!data && steps.some((s) => !s.done);

  // ---- Export ----
  const doExport = (kind: 'summary' | 'deals' | 'leads' | 'print') => {
    setExportOpen(false);
    if (kind === 'print') { setTimeout(() => window.print(), 50); return; }
    if (!data) { notify('error', 'Data is still loading. Try again in a moment.'); return; }
    const rows = exportRows(data, range)[kind];
    if (!rows.length) { notify('error', `No ${kind} in ${range.label.toLowerCase()} to export.`); return; }
    const stamp = isoDay(Date.now());
    download(`${kind}-${stamp}.csv`, toCsv(rows as any));
    notify('ok', `Downloaded ${kind}-${stamp}.csv (${rows.length} row${rows.length === 1 ? '' : 's'}).`);
  };

  const visible = prefs.order.filter((id) => !prefs.hidden.includes(id));
  const renderSection = (id: string) => {
    switch (id) {
      case 'kpis': return <KpiGrid kpis={kpis} range={range} loading={loading} onOpen={open} />;
      case 'performance': return <PerformanceCard data={records} range={range} loading={loading} />;
      case 'insights': return <InsightsCard insights={insights} loading={loading} onOpen={open} rangeLabel={range.label} />;
      case 'pipeline': return <PipelineCard data={records} loading={loading} onOpen={() => open('deals')} />;
      case 'sources': return <LeadSourcesCard data={records} range={range} loading={loading} onOpen={() => open('leads')} />;
      case 'activity': return <ActivityCard activities={records.activities} loading={loading} onOpen={open} />;
      case 'quick_actions': return <QuickActionsCard actions={quickActions} />;
      case 'assistant': return (
        <section aria-labelledby="ai-title">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3 px-1">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent-text)]" aria-hidden="true"><Bot className="h-4 w-4" /></span>
              <div>
                <h2 id="ai-title" className="text-[14px] font-semibold text-[var(--text)]">AI assistant</h2>
                <p className="text-[12px] text-[var(--text-muted)]">Ask about your customers, deals or schedule. Answers use your CRM data.</p>
              </div>
            </div>
            <Button size="sm" variant="ghost" aria-expanded={prefs.assistantOpen} aria-controls="ai-body" onClick={() => setPrefs({ assistantOpen: !prefs.assistantOpen })}>
              {prefs.assistantOpen ? 'Hide' : 'Show'}<ChevronDown className={cx('h-3.5 w-3.5 transition-transform', prefs.assistantOpen && 'rotate-180')} aria-hidden="true" />
            </Button>
          </div>
          {prefs.assistantOpen && <div id="ai-body"><UnifiedAssistant contacts={contacts} onNavigate={onNavigate} /></div>}
        </section>
      );
      case 'work_queues': return (
        <div id="work-queues" className="scroll-mt-4">
          <CustomizableWidgetGrid contacts={contacts} onSelectContact={onSelectContact} onNavigate={onNavigate} />
        </div>
      );
      default: return null;
    }
  };

  return (
    <div className="min-h-full w-full bg-[var(--app-bg)] text-[var(--text)]" id="dashboard-root">
      <div className="mx-auto w-full max-w-[1400px] px-4 sm:px-6 lg:px-8 py-5 sm:py-7 space-y-5">
        {/* Header */}
        <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <p className="text-[12px] font-medium text-[var(--text-muted)]">{today}</p>
            <h1 className="text-[24px] sm:text-[28px] font-semibold tracking-[-0.02em] leading-tight">{greeting}</h1>
            <p className="mt-1 text-[13px] text-[var(--text-muted)] max-w-2xl" aria-live="polite">{summary}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <Button variant="secondary" icon={<UserPlus className="h-4 w-4" />} onClick={quickActions[0].onClick}>Add lead</Button>
            <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setDealOpen(true)}>New deal</Button>
          </div>
        </header>

        {/* Toolbar */}
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between rounded-[var(--radius-panel)] border border-[var(--border)] bg-[var(--surface)] p-2 shadow-xs print:hidden">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <Segmented label="Date range" value={prefs.range} options={RANGE_OPTIONS.map((o) => ({ value: o.key, label: o.label }))} onChange={(v) => setPrefs({ range: v })} />
            {prefs.range === 'custom' && (
              <div className="flex items-center gap-1.5 text-[12px] text-[var(--text-muted)]">
                <label className="sr-only" htmlFor="range-from">From</label>
                <input id="range-from" type="date" value={prefs.custom.from} max={prefs.custom.to} onChange={(e) => e.target.value && setPrefs({ custom: { ...prefs.custom, from: e.target.value } })} className={cx('h-8 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-2 text-[12px] text-[var(--text)]', focusRing)} />
                <span aria-hidden="true">–</span>
                <label className="sr-only" htmlFor="range-to">To</label>
                <input id="range-to" type="date" value={prefs.custom.to} min={prefs.custom.from} max={isoDay(Date.now())} onChange={(e) => e.target.value && setPrefs({ custom: { ...prefs.custom, to: e.target.value } })} className={cx('h-8 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-2 text-[12px] text-[var(--text)]', focusRing)} />
              </div>
            )}
            <span className="hidden md:inline text-[12px] text-[var(--text-subtle)]">{range.label} · {range.compareLabel}</span>
          </div>
          <div className="flex items-center gap-1 self-end sm:self-auto">
            <span className="hidden sm:inline text-[11px] text-[var(--text-subtle)] mr-1" aria-live="polite">
              {loading ? 'Updating…' : updatedAt ? `Updated ${relativeTime(new Date(updatedAt).toISOString()).toLowerCase()}` : ''}
            </span>
            <IconButton label="Refresh data" onClick={refresh} disabled={loading}><RefreshCw className={cx('h-4 w-4', loading && 'animate-spin')} /></IconButton>
            <div className="relative" ref={exportRef}>
              <Button size="sm" variant="ghost" icon={<Download className="h-4 w-4" />} aria-haspopup="menu" aria-expanded={exportOpen} onClick={() => setExportOpen((o) => !o)}>Export</Button>
              {exportOpen && (
                <div role="menu" aria-label="Export" className="absolute right-0 z-40 mt-1 w-56 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-1 shadow-lg">
                  {([
                    ['summary', 'Key figures (CSV)', FileSpreadsheet], ['deals', 'Deals in this period (CSV)', FileSpreadsheet],
                    ['leads', 'Leads in this period (CSV)', FileSpreadsheet], ['print', 'Print or save as PDF', Printer],
                  ] as const).map(([k, label, Icon]) => (
                    <button key={k} role="menuitem" type="button" onClick={() => doExport(k)} className={cx('flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-[var(--text)] hover:bg-[var(--surface-sunken)] cursor-pointer', focusRing)}>
                      <Icon className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />{label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <Button size="sm" variant="ghost" icon={<SlidersHorizontal className="h-4 w-4" />} onClick={() => setCustomizeOpen(true)}>Customize</Button>
          </div>
        </div>

        {error && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--danger)]/30 bg-[var(--danger-soft)] px-4 py-3 text-[13px] text-[var(--danger)]">
            <span className="flex items-center gap-2"><AlertCircle className="h-4 w-4" aria-hidden="true" />{error}</span>
            <Button size="sm" variant="secondary" onClick={refresh}>Try again</Button>
          </div>
        )}

        {showChecklist && <GettingStartedCard steps={steps} onDismiss={() => setPrefs({ checklistDismissed: true })} />}

        {visible.length ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:grid-flow-dense">
            {visible.map((id) => (
              <div key={id} className={cx('min-w-0 [&>*]:h-full', SPAN[id])} data-section={id}>{renderSection(id)}</div>
            ))}
          </div>
        ) : (
          <Card className="p-8 text-center">
            <p className="text-[13px] text-[var(--text-muted)]">All sections are hidden.</p>
            <Button className="mt-3" variant="secondary" onClick={() => setCustomizeOpen(true)}>Choose sections</Button>
          </Card>
        )}
      </div>

      <NewDealDialog open={dealOpen} onClose={() => setDealOpen(false)} onCreated={(m) => notify('ok', m)} />
      <CustomizeDialog
        open={customizeOpen} onClose={() => setCustomizeOpen(false)} sections={SECTIONS} order={prefs.order} hidden={prefs.hidden}
        onChange={(order, hidden) => setPrefs({ order, hidden, customized: true })}
        onReset={() => setPrefs({ order: DEFAULT_ORDER, hidden: [], customized: true })}
      />

      {toast && (
        <div role={toast.kind === 'error' ? 'alert' : 'status'} className="fixed bottom-20 sm:bottom-6 left-1/2 -translate-x-1/2 z-[70] flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] px-4 py-2.5 text-[13px] text-[var(--text)] shadow-xl animate-in fade-in slide-in-from-bottom-2 print:hidden max-w-[calc(100vw-2rem)]">
          {toast.kind === 'error' ? <AlertCircle className="h-4 w-4 text-[var(--danger)] shrink-0" aria-hidden="true" /> : <CheckCircle2 className="h-4 w-4 text-[var(--success)] shrink-0" aria-hidden="true" />}
          {toast.text}
        </div>
      )}
    </div>
  );
}

