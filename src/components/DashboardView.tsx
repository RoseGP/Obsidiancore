/**
 * Dashboard: the AI Business Command Center.
 *
 *   Welcome header      greeting, live clock, AI status, notifications, settings, profile
 *   AI Copilot          Claude or Gemini, voice commands, suggested commands, history, full screen (focal point)
 *   Needs your attention priority cards from real records (meetings soon, unanswered messages, missed calls,
 *                        hot leads, overdue follow-ups, stalled deals, waiting proposals, critical tickets)
 *   Business performance five KPIs; click one to open the analytics (date range, trends, export)
 *   Upcoming meetings · Live activity · Daily missions · Service monitoring · AI insights · Business tools
 *   Work queues          leads, opportunities and tickets to act on (collapsed by default)
 *
 * Data: /api/dashboard (deals, leads, tickets, activity, missions, service), /api/proposals, /api/meetings,
 * /api/messaging (inbox, live stream) and /api/communication (WhatsApp/SMS, voicemail). Nothing is sample
 * data; anything not connected says so. Sections can be collapsed, hidden and reordered (saved per person).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle, BarChart3, Bell, Bot, CalendarClock, CheckCircle2, Download, FileSpreadsheet, FileText, Gauge, Headphones,
  LayoutGrid, Lightbulb, PhoneCall, Plus, Printer, Radio, RefreshCw, SlidersHorizontal, Trophy, UserPlus, Video, Wrench, CalendarPlus,
} from 'lucide-react';
import { CRMContact, CalendarEvent } from '../types';
import UnifiedAssistant, { askCopilot } from './assistant/UnifiedAssistant';
import CustomizableWidgetGrid from './dashboard/CustomizableWidgetGrid';
import { useOptionalAuth } from '../context/AuthContext';
import { useNotifications } from '../context/NotificationContext';
import { useMeetingSession } from '../context/MeetingSessionContext';
import { useTeamMembers } from '../hooks/useTeamMembers';
import { invalidateDashboard, useDashboardData } from '../lib/dashboardData';
import { useCommandCenterData } from '../lib/commandCenterData';
import { RANGE_OPTIONS, type RangeKey, buildInsights, exportRows, relativeTime, resolveRange, toCsv } from '../lib/dashboardMetrics';
import { type AgendaItem, type AttentionItem, buildAttention, commandCenterInsights, greetingLine, headlineKpis, upcomingMeetings } from '../lib/commandCenter';
import { LeadSourcesCard, PerformanceCard, PipelineCard } from './dashboard/AnalyticsSections';
import {
  AttentionGrid, CcSection, InsightsList, KpiStrip, LiveFeed, MeetingsList, MissionsPanel, ServicePanel, ToolsGrid, WelcomeHeader, buildFeed,
  type FeedItem, type Tool,
} from './dashboard/CommandCenterSections';
import TasksDueCard from '../features/crm-records/TasksDueCard';
import { GettingStartedCard, type ChecklistStep } from './dashboard/WorkSections';
import { CustomizeDialog, NewDealDialog, type SectionPref } from './dashboard/Dialogs';
import { Button, IconButton, Segmented, cx, focusRing } from './dashboard/ui';

interface DashboardViewProps {
  contacts: CRMContact[];
  onSelectContact: (contact: CRMContact) => void;
  onNavigate: (view: any) => void;
  onQuickAction?: (type: 'lead' | 'deal' | 'event') => void;
  onOpenSettings?: (tab: string) => void;
  events?: CalendarEvent[];
}

const SECTIONS: SectionPref[] = [
  { id: 'copilot', label: 'AI Copilot', description: 'Ask, command, draft and act with Claude or Gemini' },
  { id: 'attention', label: 'Needs your attention', description: 'Priority items that need you today' },
  { id: 'performance', label: 'Business performance', description: 'Five key figures and detailed analytics' },
  { id: 'meetings', label: 'Upcoming meetings', description: 'Today and the next two weeks' },
  { id: 'activity', label: 'Live activity', description: 'WhatsApp, email, SMS, calls and website chat' },
  { id: 'missions', label: 'Daily missions', description: 'High-impact goals, XP and streaks' },
  { id: 'service', label: 'Service monitoring', description: 'SLA, response times, missed calls, channels' },
  { id: 'insights', label: 'AI business insights', description: 'Opportunities and risks in your records' },
  { id: 'tools', label: 'Business tools', description: 'Receptionist, meetings, proposals, dialer, calendar, deals' },
  { id: 'work_queues', label: 'Work queues', description: 'Leads, opportunities and tickets to act on' },
];
const DEFAULT_ORDER = SECTIONS.map((s) => s.id);
const SPAN: Record<string, string> = {
  copilot: 'lg:col-span-12', attention: 'lg:col-span-12', performance: 'lg:col-span-12', work_queues: 'lg:col-span-12',
  meetings: 'lg:col-span-5', activity: 'lg:col-span-7', missions: 'lg:col-span-7', service: 'lg:col-span-5', insights: 'lg:col-span-7', tools: 'lg:col-span-5',
};

interface Prefs { order: string[]; hidden: string[]; collapsed: string[]; range: RangeKey; custom: { from: string; to: string }; checklistDismissed: boolean; customized: boolean }
const isoDay = (t: number) => new Date(t - new Date(t).getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
const DEFAULT_PREFS: Prefs = {
  order: DEFAULT_ORDER, hidden: [], collapsed: ['work_queues'], range: '30d',
  custom: { from: isoDay(Date.now() - 29 * 86_400_000), to: isoDay(Date.now()) }, checklistDismissed: false, customized: false,
};

function usePrefs(userKey: string) {
  const key = `obsidian_command_center_v1:${userKey || 'anon'}`;
  const read = (): Prefs => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return DEFAULT_PREFS;
      const p = JSON.parse(raw);
      const order = Array.isArray(p.order) ? p.order.filter((id: string) => DEFAULT_ORDER.includes(id)) : [...DEFAULT_ORDER];
      for (const id of DEFAULT_ORDER) if (!order.includes(id)) order.push(id);
      return { ...DEFAULT_PREFS, ...p, order, hidden: Array.isArray(p.hidden) ? p.hidden : [], collapsed: Array.isArray(p.collapsed) ? p.collapsed : DEFAULT_PREFS.collapsed };
    } catch { return DEFAULT_PREFS; }
  };
  const [prefs, setPrefs] = useState<Prefs>(read);
  useEffect(() => { setPrefs(read()); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const update = useCallback((patch: Partial<Prefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* storage unavailable: lasts this visit */ }
      return next;
    });
  }, [key]);
  return [prefs, update] as const;
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob(['﻿', text], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok && data.success !== false, data };
}

export default function DashboardView({ contacts, onSelectContact, onNavigate, onQuickAction, onOpenSettings, events = [] }: DashboardViewProps) {
  const auth = useOptionalAuth();
  const userKey = auth?.user?.uid || auth?.userProfile?.uid || '';
  const fullName = (auth?.userProfile?.displayName || '').trim();
  const firstName = fullName.split(/\s+/)[0] || '';
  const notificationsCtx = useNotifications();
  const meeting = useMeetingSession();
  const team = useTeamMembers();
  const [prefs, setPrefs] = usePrefs(userKey);
  const { data, loading, error, refresh } = useDashboardData();
  const cc = useCommandCenterData();
  const [dealOpen, setDealOpen] = useState(false);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [selectedKpi, setSelectedKpi] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const exportRef = useRef<HTMLDivElement>(null);
  const notify = useCallback((kind: 'ok' | 'error', text: string) => { setToast({ kind, text }); setTimeout(() => setToast(null), 4500); }, []);

  useEffect(() => {
    if (!exportOpen) return;
    const close = (e: MouseEvent | KeyboardEvent) => { if (e instanceof KeyboardEvent ? e.key === 'Escape' : !exportRef.current?.contains(e.target as Node)) setExportOpen(false); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [exportOpen]);
  useEffect(() => {
    const show = () => setPrefs({ checklistDismissed: false });
    window.addEventListener('obsidian:show-setup', show);
    return () => window.removeEventListener('obsidian:show-setup', show);
  }, [setPrefs]);

  const records = data || { deals: [], leads: [], tickets: [], activities: [] };
  const ccInput = useMemo(() => ({
    ...records,
    proposals: cc.proposals.data || [],
    meetings: cc.meetings.data || [],
    conversations: cc.conversations.data || [],
    events: events.map((e: any) => ({ id: String(e.id), title: e.title, date: e.date, time: e.time || e.startTime, start: e.start, contactName: e.contactName || e.attendee, type: e.type })),
    service: cc.service.data ? { unansweredCount: cc.service.data.unansweredCount, missedCalls: cc.service.data.missedCalls } : null,
  }), [records, cc.proposals.data, cc.meetings.data, cc.conversations.data, cc.service.data, events]);

  const now = Date.now();
  const attention = useMemo(() => buildAttention(ccInput), [ccInput]);
  const agenda = useMemo(() => upcomingMeetings(ccInput), [ccInput]);
  const kpis = useMemo(() => (data ? headlineKpis(data) : []), [data]);
  const range = useMemo(() => resolveRange(prefs.range, now, prefs.custom), [prefs.range, prefs.custom]); // eslint-disable-line react-hooks/exhaustive-deps
  const insights = useMemo(() => {
    const extra = commandCenterInsights(ccInput);
    const base = data ? buildInsights(data, range).map((i) => ({ ...i, ask: i.action ? `${i.title}. ${i.detail} What should I do about it?` : undefined })) : [];
    const seen = new Set<string>();
    return [...base.filter((i) => i.tone === 'warning'), ...extra, ...base.filter((i) => i.tone !== 'warning')].filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)));
  }, [ccInput, data, range]);
  const feed = useMemo(() => buildFeed(cc.conversations.data || [], cc.inbound.data?.messages || [], cc.inbound.data?.voicemails || []), [cc.conversations.data, cc.inbound.data]);
  const notConnected = useMemo(() => {
    const map: Record<string, string> = { website_chat: 'website', whatsapp: 'whatsapp', sms: 'sms', voice: 'voice', email: 'email', telegram: 'telegram', instagram: 'instagram' };
    return new Set((cc.service.data?.channels || []).filter((c) => c.status !== 'connected').map((c) => map[c.id]).filter(Boolean));
  }, [cc.service.data]);
  const greeting = loading && !data ? 'Getting your business up to date…' : greetingLine(ccInput, attention);

  // ---- Navigation & actions ----
  const open = useCallback((view: string) => {
    if (view.startsWith('dashboard#')) {
      const id = view.slice('dashboard#'.length);
      if (prefs.collapsed.includes(id.replace(/-/g, '_'))) setPrefs({ collapsed: prefs.collapsed.filter((c) => c !== id.replace(/-/g, '_')) });
      setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
      return;
    }
    if (view === 'proposals-builder') {
      try { const u = new URL(window.location.href); u.searchParams.set('subtab', 'proposals'); window.history.replaceState(null, '', u.toString()); } catch { /* ignore */ }
      onNavigate('proposals'); return;
    }
    onNavigate(view);
  }, [onNavigate, prefs.collapsed, setPrefs]);

  /** Join a scheduled meeting's room; if nobody has started it yet, start it (the server applies the plan). */
  const join = useCallback(async (roomCode: string, title?: string) => {
    let r = await meeting.joinMeeting(roomCode);
    if (!r.success && /no meeting is running/i.test(r.message || '')) r = await meeting.startInstantMeeting(roomCode, undefined, title);
    if (r.success) onNavigate('call_canvas');
    else notify('error', r.message || 'You couldn’t join that meeting.');
  }, [meeting, onNavigate, notify]);

  const onAttention = useCallback(async (it: AttentionItem) => {
    if (it.action.type === 'join') return join(it.action.roomCode, it.title);
    if (it.action.type === 'reply') return open('messages');
    return open(it.action.view);
  }, [join, open]);

  const onReply = useCallback(async (item: FeedItem, text: string) => {
    if (!item.reply) return { ok: false, message: 'This item can’t be answered here.' };
    if (item.reply.kind === 'conversation') {
      const r = await postJson(`/api/messaging/conversations/${encodeURIComponent(item.reply.conversationId)}/messages`, { content: text });
      if (r.ok) { cc.refreshConversations(); return { ok: true, message: 'Reply added to the conversation. Website chat visitors see it right away.' }; }
      return { ok: false, message: r.data?.error || 'The reply couldn’t be saved. Try again.' };
    }
    if (item.reply.kind === 'send') {
      const r = await postJson('/api/communication/send', { to: item.reply.to, channel: item.reply.channel, body: text });
      if (r.ok) return { ok: true, message: `Sent by ${item.reply.channel === 'WHATSAPP' ? 'WhatsApp' : 'SMS'}.` };
      return { ok: false, message: r.data?.error || 'The message wasn’t sent. Try again.' };
    }
    return { ok: false, message: 'Call them back from the Phone page.' };
  }, [cc]);

  const tools: Tool[] = [
    { id: 'receptionist', label: 'AI Voice Receptionist', description: 'Answers calls, takes messages, routes callers', icon: Headphones, cta: 'Open', color: '#22d3ee', onClick: () => open('voice_dialer') },
    { id: 'meetings', label: 'Video Meetings', description: 'Start or join a call with screen sharing and notes', icon: Video, cta: 'Start', color: '#5b6cff', onClick: () => open('greet') },
    { id: 'proposal', label: 'Proposal Generator', description: 'Build, send and e-sign proposals', icon: FileText, cta: 'Create', color: '#a78bfa', onClick: () => open('proposals-builder') },
    { id: 'dialer', label: 'AI Dialer', description: 'Call leads with notes and call history', icon: PhoneCall, cta: 'Dial', color: '#34d399', onClick: () => open('voice_dialer') },
    { id: 'calendar', label: 'Calendar Scheduler', description: 'Book a meeting or follow-up', icon: CalendarPlus, cta: 'Schedule', color: '#fbbf24', onClick: () => (onQuickAction ? onQuickAction('event') : open('calendar')) },
    { id: 'deal', label: 'Register New Deal', description: 'Add an opportunity to your pipeline', icon: Plus, cta: 'Register', color: '#f472b6', onClick: () => setDealOpen(true) },
  ];

  const steps: ChecklistStep[] = [
    { id: 'lead', label: 'Add your first lead', detail: 'Leads feed every figure on this page.', done: records.leads.length > 0, action: { label: 'Add a lead', onClick: () => (onQuickAction ? onQuickAction('lead') : open('leads')) } },
    { id: 'deal', label: 'Register a deal', detail: 'Track value and stage in your pipeline.', done: records.deals.length > 0, action: { label: 'New deal', onClick: () => setDealOpen(true) } },
    { id: 'team', label: 'Invite a teammate', detail: 'Share leads and assign owners.', done: team.members.length > 1, action: { label: 'Invite', onClick: () => (onOpenSettings ? onOpenSettings('workspace') : open('settings')) } },
    { id: 'ai', label: 'Ask your copilot', detail: 'Try “Show me today’s hottest leads.”', done: prefs.customized || false, action: { label: 'Try it', onClick: () => { setPrefs({ customized: true }); askCopilot('Show me today’s hottest leads.'); } } },
  ];
  const showChecklist = !prefs.checklistDismissed && !!data && steps.some((s) => !s.done);

  const doExport = (kind: 'summary' | 'deals' | 'leads' | 'print') => {
    setExportOpen(false);
    if (kind === 'print') { setTimeout(() => window.print(), 50); return; }
    if (!data) { notify('error', 'Data is still loading. Try again in a moment.'); return; }
    const rows = exportRows(data, range)[kind];
    if (!rows.length) { notify('error', `No ${kind} in ${range.label.toLowerCase()} to export.`); return; }
    const name = `${kind}-${isoDay(Date.now())}.csv`;
    download(name, toCsv(rows as any));
    notify('ok', `Downloaded ${name} (${rows.length} row${rows.length === 1 ? '' : 's'}).`);
  };

  const collapsed = (id: string) => prefs.collapsed.includes(id);
  const toggle = (id: string) => setPrefs({ collapsed: collapsed(id) ? prefs.collapsed.filter((c) => c !== id) : [...prefs.collapsed, id] });
  const refreshAll = () => { invalidateDashboard(); refresh(); cc.refreshAll(); };
  const kpiMetric = selectedKpi === 'open_deals' ? 'deals' : selectedKpi === 'pipeline' || selectedKpi === 'forecast' ? 'won' : 'leads';
  const attentionHigh = attention.filter((a) => a.priority === 'high').length;

  const renderSection = (id: string) => {
    switch (id) {
      case 'copilot': return <UnifiedAssistant contacts={contacts} onNavigate={onNavigate} />;
      case 'attention': return (
        <CcSection id="attention" title="Needs Your Attention" subtitle="Important business activities that need your attention today." icon={<Bell className="h-4 w-4" />}
          badge={attention.length ? <span className="inline-flex items-center gap-1 rounded-full bg-[var(--danger-soft)] px-2 py-0.5 text-[11px] font-semibold text-[var(--danger)]">{attentionHigh ? `${attentionHigh} high priority` : `${attention.length} open`}</span> : undefined}
          collapsed={collapsed('attention')} onToggle={() => toggle('attention')}>
          <AttentionGrid items={attention} loading={loading || cc.conversations.loading} onAction={onAttention} />
          <div className="mt-4"><TasksDueCard onNavigate={open} /></div>
        </CcSection>
      );
      case 'performance': return (
        <CcSection id="performance" title="Business Performance" subtitle="Click a figure to explore trends, pipeline and sources." icon={<BarChart3 className="h-4 w-4" />}
          collapsed={collapsed('performance')} onToggle={() => toggle('performance')}
          actions={<IconButton label="Refresh all dashboard data" onClick={refreshAll} disabled={loading}><RefreshCw className={cx('h-4 w-4', loading && 'animate-spin')} /></IconButton>}>
          <KpiStrip kpis={kpis} loading={loading} selected={selectedKpi} onSelect={(k) => setSelectedKpi(selectedKpi === k ? null : k)} />
          {selectedKpi && (
            <div className="mx-4 sm:mx-5 mb-5 rounded-xl border border-[var(--border)] bg-[var(--surface-sunken)] p-3 space-y-3" aria-label="Detailed analytics">
              <div className="flex flex-wrap items-center gap-2 justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  <Segmented label="Date range" size="sm" value={prefs.range} options={RANGE_OPTIONS.map((o) => ({ value: o.key, label: o.label }))} onChange={(v) => setPrefs({ range: v })} />
                  {prefs.range === 'custom' && (
                    <span className="flex items-center gap-1.5 text-[12px] text-[var(--text-muted)]">
                      <label className="sr-only" htmlFor="range-from">From</label>
                      <input id="range-from" type="date" value={prefs.custom.from} max={prefs.custom.to} onChange={(e) => e.target.value && setPrefs({ custom: { ...prefs.custom, from: e.target.value } })} className={cx('h-8 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 text-[12px] text-[var(--text)]', focusRing)} />
                      –
                      <label className="sr-only" htmlFor="range-to">To</label>
                      <input id="range-to" type="date" value={prefs.custom.to} min={prefs.custom.from} max={isoDay(Date.now())} onChange={(e) => e.target.value && setPrefs({ custom: { ...prefs.custom, to: e.target.value } })} className={cx('h-8 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 text-[12px] text-[var(--text)]', focusRing)} />
                    </span>
                  )}
                  <span className="text-[11px] text-[var(--text-subtle)]">{range.label} · {range.compareLabel}</span>
                </div>
                <div className="relative" ref={exportRef}>
                  <Button size="sm" variant="ghost" icon={<Download className="h-4 w-4" />} aria-haspopup="menu" aria-expanded={exportOpen} onClick={() => setExportOpen((o) => !o)}>Export</Button>
                  {exportOpen && (
                    <div role="menu" aria-label="Export" className="absolute right-0 z-40 mt-1 w-56 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-1 shadow-2xl">
                      {([['summary', 'Key figures (CSV)', FileSpreadsheet], ['deals', 'Deals in this period (CSV)', FileSpreadsheet], ['leads', 'Leads in this period (CSV)', FileSpreadsheet], ['print', 'Print or save as PDF', Printer]] as const).map(([k, label, Icon]) => (
                        <button key={k} role="menuitem" type="button" onClick={() => doExport(k)} className={cx('flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-[var(--text)] hover:bg-[var(--surface-sunken)] cursor-pointer', focusRing)}>
                          <Icon className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />{label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="grid gap-3 lg:grid-cols-12">
                <div className="lg:col-span-6 min-w-0 [&>*]:h-full"><PerformanceCard key={kpiMetric} data={records} range={range} loading={loading} initialMetric={kpiMetric as any} /></div>
                <div className="lg:col-span-3 min-w-0 [&>*]:h-full"><PipelineCard data={records} loading={loading} onOpen={() => open('deals')} /></div>
                <div className="lg:col-span-3 min-w-0 [&>*]:h-full"><LeadSourcesCard data={records} range={range} loading={loading} onOpen={() => open('leads')} /></div>
              </div>
            </div>
          )}
        </CcSection>
      );
      case 'meetings': return (
        <CcSection id="meetings" title="Upcoming Meetings" subtitle="Today’s meetings, calls and follow-ups." icon={<CalendarClock className="h-4 w-4" />}
          collapsed={collapsed('meetings')} onToggle={() => toggle('meetings')}
          actions={<Button size="sm" variant="secondary" onClick={() => open('calendar')}>Open Full Calendar</Button>}>
          <MeetingsList items={agenda} loading={cc.meetings.loading} error={cc.meetings.error} onJoin={(a: AgendaItem) => a.roomCode && join(a.roomCode, a.title)} onSchedule={() => (onQuickAction ? onQuickAction('event') : open('calendar'))} />
        </CcSection>
      );
      case 'activity': return (
        <CcSection id="activity" title="Live Activity" subtitle="Incoming and outgoing conversations across your channels." icon={<Radio className="h-4 w-4" />}
          badge={<span className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--success)]"><span className="h-1.5 w-1.5 rounded-full bg-[var(--success)] animate-pulse" aria-hidden="true" />Live</span>}
          collapsed={collapsed('activity')} onToggle={() => toggle('activity')}>
          <LiveFeed items={feed} loading={cc.conversations.loading || cc.inbound.loading}
            errors={[cc.conversations.error, cc.inbound.error].filter(Boolean) as string[]} notConnected={notConnected}
            onReply={onReply} onOpenInbox={() => open('messages')} onCall={() => open('voice_dialer')} />
        </CcSection>
      );
      case 'missions': return (
        <CcSection id="missions" title="Your AI Daily Missions" subtitle="Complete high-impact activities and move your business forward." icon={<Trophy className="h-4 w-4" />}
          collapsed={collapsed('missions')} onToggle={() => toggle('missions')}
          actions={<IconButton label="Refresh missions" onClick={cc.refreshMissions}><RefreshCw className="h-4 w-4" /></IconButton>}>
          <MissionsPanel state={cc.missions.data} loading={cc.missions.loading} error={cc.missions.error} onRetry={cc.refreshMissions} onAction={(m) => m.action && open(m.action.view)} />
        </CcSection>
      );
      case 'service': return (
        <CcSection id="service" title="SLA & Service Monitoring" subtitle="Response times, missed calls and channel health." icon={<Gauge className="h-4 w-4" />}
          collapsed={collapsed('service')} onToggle={() => toggle('service')}
          actions={<Button size="sm" variant="ghost" onClick={() => (onOpenSettings ? onOpenSettings('integrations') : open('settings'))}>Integrations</Button>}>
          <ServicePanel s={cc.service.data} loading={cc.service.loading} error={cc.service.error} onRetry={cc.refreshAll} />
        </CcSection>
      );
      case 'insights': return (
        <CcSection id="insights" title="Your AI Business Insights" subtitle="Opportunities and risks spotted in your records. Ask your copilot to dig deeper." icon={<Lightbulb className="h-4 w-4" />}
          collapsed={collapsed('insights')} onToggle={() => toggle('insights')}>
          <InsightsList insights={insights} loading={loading} onOpen={open} onAsk={askCopilot} />
        </CcSection>
      );
      case 'tools': return (
        <CcSection id="tools" title="Your Business Tools" subtitle="Everything you use most, one click away." icon={<Wrench className="h-4 w-4" />}
          collapsed={collapsed('tools')} onToggle={() => toggle('tools')}>
          <ToolsGrid tools={tools} />
        </CcSection>
      );
      case 'work_queues': return (
        <CcSection id="work-queues" title="Work Queues" subtitle="Act on leads, move deals forward and answer tickets." icon={<LayoutGrid className="h-4 w-4" />}
          collapsed={collapsed('work_queues')} onToggle={() => toggle('work_queues')}>
          <div className="px-3 sm:px-4 pb-4"><CustomizableWidgetGrid contacts={contacts} onSelectContact={onSelectContact} onNavigate={onNavigate} /></div>
        </CcSection>
      );
      default: return null;
    }
  };

  const visible = prefs.order.filter((id) => !prefs.hidden.includes(id));
  const unreadNotifications = notificationsCtx.notifications;

  return (
    <div className="cc min-h-full shrink-0 w-full" id="dashboard-root">
      <div className="mx-auto w-full max-w-[1440px] px-4 sm:px-6 lg:px-8 py-5 sm:py-7 space-y-5">
        <WelcomeHeader
          name={firstName} greeting={greeting}
          ai={{ claude: cc.service.data ? cc.service.data.ai.claude.configured : null, gemini: cc.service.data ? cc.service.data.ai.gemini.configured : null }}
          actions={
            <div className="flex flex-wrap items-center gap-2 print:hidden">
              <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setDealOpen(true)} className="bg-gradient-to-br from-[#4f8df7] to-[#6b6cf2] shadow-[0_10px_24px_-8px_rgb(79_110_247/0.6)]">Register deal</Button>
              <Button variant="secondary" icon={<UserPlus className="h-4 w-4" />} onClick={() => (onQuickAction ? onQuickAction('lead') : open('leads'))}>Add lead</Button>
              <Button variant="secondary" icon={<Bot className="h-4 w-4" />} className="cc-aurora" onClick={() => { document.getElementById('copilot')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); document.getElementById('assistant-input')?.focus({ preventScroll: true }); }}>Ask copilot</Button>
              <span className="mx-1 h-5 w-px bg-[var(--border)]" aria-hidden="true" />
              <Button size="sm" variant="ghost" icon={<SlidersHorizontal className="h-4 w-4" />} onClick={() => setCustomizeOpen(true)}>Customize</Button>
              <span className="text-[11px] text-[var(--text-subtle)]">{loading ? 'Updating…' : 'Up to date'}</span>
            </div>
          }
        />

        {error && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[var(--danger-soft)] px-4 py-3 text-[13px] text-[var(--danger)]">
            <span className="flex items-center gap-2"><AlertCircle className="h-4 w-4" aria-hidden="true" />{error}</span>
            <Button size="sm" variant="secondary" onClick={refreshAll}>Try again</Button>
          </div>
        )}

        {showChecklist && <GettingStartedCard steps={steps} onDismiss={() => setPrefs({ checklistDismissed: true })} />}

        {visible.length ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:grid-flow-dense items-start">
            {visible.map((id) => <div key={id} className={cx('min-w-0', SPAN[id])} data-section={id}>{renderSection(id)}</div>)}
          </div>
        ) : (
          <div className="rounded-2xl border border-[var(--border)] p-8 text-center">
            <p className="text-[13px] text-[var(--text-muted)]">All sections are hidden.</p>
            <Button className="mt-3" variant="secondary" onClick={() => setCustomizeOpen(true)}>Choose sections</Button>
          </div>
        )}
        <p className="text-center text-[11px] text-[var(--text-subtle)] pb-2">Your AI business partner is ready. Your business is under control. Let’s grow.</p>
      </div>

      <NewDealDialog open={dealOpen} onClose={() => setDealOpen(false)} onCreated={(m) => notify('ok', m)} />
      <CustomizeDialog
        open={customizeOpen} onClose={() => setCustomizeOpen(false)} sections={SECTIONS} order={prefs.order} hidden={prefs.hidden}
        onChange={(order, hidden) => setPrefs({ order, hidden, customized: true })}
        onReset={() => setPrefs({ order: DEFAULT_ORDER, hidden: [], collapsed: DEFAULT_PREFS.collapsed, customized: true })}
      />
      {toast && (
        <div role={toast.kind === 'error' ? 'alert' : 'status'} className="fixed bottom-20 sm:bottom-6 left-1/2 -translate-x-1/2 z-[80] flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] px-4 py-2.5 text-[13px] text-[var(--text)] shadow-2xl max-w-[calc(100vw-2rem)] print:hidden">
          {toast.kind === 'error' ? <AlertCircle className="h-4 w-4 text-[var(--danger)] shrink-0" aria-hidden="true" /> : <CheckCircle2 className="h-4 w-4 text-[var(--success)] shrink-0" aria-hidden="true" />}
          {toast.text}
        </div>
      )}
    </div>
  );
}
