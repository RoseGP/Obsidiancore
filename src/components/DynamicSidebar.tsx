/**
 * App navigation, grouped the way the business runs: Command Center, Customers, Communications,
 * Operations, Marketing and Settings. Every item opens one page; nothing is listed twice (dashboard
 * sections are reached on the dashboard, leads/contacts/companies inside the Sales Pipeline, and the
 * AI receptionist inside Voice Calls).
 * Item ids: a view ('leads'), a dashboard section ('dashboard#missions') or a Settings tab ('settings:integrations').
 * Desktop: collapsible rail and collapsible groups (remembered per browser), tooltips when collapsed.
 * Phones/tablets (< md): an off-canvas drawer opened from the header's menu button.
 */
import React, { useEffect, useState } from 'react';
import {
  LayoutDashboard, MessageSquare, FileText, BarChart3, Settings, ChevronLeft, ChevronRight, ChevronDown, Video, Calendar, Share2,
  Globe, Phone, X, Brain, Bell, KanbanSquare, MessageCircle, Plug, UserCog, UserCircle2, ListChecks, ShieldCheck, Scale, CreditCard,
} from 'lucide-react';

interface SidebarItem { id: string; label: string; icon: React.ComponentType<any>; hint: string }
interface SidebarGroup { id: string; label: string | null; items: SidebarItem[] }

export const NAV_GROUPS: SidebarGroup[] = [
  { id: 'command', label: 'Command Center', items: [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, hint: 'Your business at a glance, with your AI copilot' },
    { id: 'tasks', label: 'Tasks', icon: ListChecks, hint: 'Everyone’s tasks, follow-ups and reminders in one list' },
  ] },
  { id: 'customers', label: 'Customer Management', items: [
    { id: 'deals', label: 'Sales Pipeline & Deals', icon: KanbanSquare, hint: 'Pipeline, leads, contacts and companies' },
    { id: 'lead_intelligence', label: 'Lead Intelligence', icon: Brain, hint: 'Hot, warm and cold leads with next best actions' },
  ] },
  { id: 'communications', label: 'Communications', items: [
    { id: 'messages', label: 'Unified Inbox', icon: MessageSquare, hint: 'Website chat, team and customer conversations' },
    { id: 'voice_messages', label: 'WhatsApp & SMS', icon: MessageCircle, hint: 'Messages and voicemails on your numbers' },
    { id: 'voice_dialer', label: 'Voice Calls', icon: Phone, hint: 'Dialer, call history and the AI receptionist' },
  ] },
  { id: 'operations', label: 'Business Operations', items: [
    { id: 'calendar', label: 'Calendar', icon: Calendar, hint: 'GREET meetings, bookings and events' },
    { id: 'greet', label: 'GREET', icon: Video, hint: 'Video meetings: schedule, start and join' },
    { id: 'proposals', label: 'Proposals & Invoices', icon: FileText, hint: 'Quotes, e-signature, invoicing' },
    { id: 'analytics', label: 'Reports & Analytics', icon: BarChart3, hint: 'Reports and trends' },
  ] },
  { id: 'marketing', label: 'Marketing', items: [
    { id: 'social_planner', label: 'Social Planner', icon: Share2, hint: 'Schedule social posts' },
    { id: 'gbp', label: 'Local SEO', icon: Globe, hint: 'Google Business Profile' },
  ] },
  { id: 'settings', label: 'Settings', items: [
    { id: 'settings:integrations', label: 'Integrations', icon: Plug, hint: 'Connected services and AI providers' },
    { id: 'settings:notifications', label: 'Notifications', icon: Bell, hint: 'What you’re told about, and how' },
    { id: 'settings:workspace', label: 'Team Management', icon: UserCog, hint: 'Members, roles and invitations' },
    { id: 'billing', label: 'Billing & Subscription', icon: CreditCard, hint: 'Your plan, invoices and payment providers' },
    { id: 'security_access', label: 'Security & Access', icon: ShieldCheck, hint: 'Sign-in, two-step, sessions, roles and permissions' },
    { id: 'settings:compliance', label: 'Privacy & Compliance', icon: Scale, hint: 'Consent, data requests, retention, audit log' },
    { id: 'settings:account', label: 'Account Settings', icon: UserCircle2, hint: 'Your profile' },
  ] },
];

interface DynamicSidebarProps {
  activeId?: string;
  onActiveIdChange?: (id: string) => void;
  className?: string;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

const STORAGE_KEY = 'obsidian_sidebar_expanded';
const GROUPS_KEY = 'obsidian_sidebar_collapsed_groups';

export default function DynamicSidebar({ activeId = 'dashboard', onActiveIdChange, className = '', mobileOpen = false, onMobileClose }: DynamicSidebarProps) {
  const [expanded, setExpanded] = useState<boolean>(() => { try { return localStorage.getItem(STORAGE_KEY) !== 'false'; } catch { return true; } });
  const [closedGroups, setClosedGroups] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem(GROUPS_KEY) || '[]'); } catch { return []; } });
  useEffect(() => { try { localStorage.setItem(STORAGE_KEY, String(expanded)); } catch { /* storage unavailable */ } }, [expanded]);
  useEffect(() => { try { localStorage.setItem(GROUPS_KEY, JSON.stringify(closedGroups)); } catch { /* storage unavailable */ } }, [closedGroups]);
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onMobileClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mobileOpen, onMobileClose]);

  const go = (id: string) => { onActiveIdChange?.(id); onMobileClose?.(); };
  const toggleGroup = (id: string) => setClosedGroups((g) => (g.includes(id) ? g.filter((x) => x !== id) : [...g, id]));
  const showLabels = (desktop: boolean) => (desktop ? expanded : true);

  const renderItem = (item: SidebarItem, desktop: boolean) => {
    const Icon = item.icon;
    const active = activeId === item.id;
    const labels = showLabels(desktop);
    const domId = desktop ? `dynamic-sidebar-btn-${item.id.replace(/[^a-z0-9_]/gi, '-')}` : undefined;
    return (
      <li key={item.id} className="relative group/item">
        <button
          type="button" id={domId} onClick={() => go(item.id)}
          aria-current={active ? 'page' : undefined} aria-label={labels ? undefined : item.label}
          className={`relative w-full flex items-center gap-3 rounded-lg px-3 py-[7px] text-[13px] font-medium transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-text)] ${labels ? '' : 'justify-center'} ${active ? 'bg-white/[0.08] text-[var(--text)]' : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-white/[0.04]'}`}
        >
          <span className={`absolute left-0 top-2 bottom-2 w-[3px] rounded-r bg-[var(--accent)] transition-opacity ${active ? 'opacity-100' : 'opacity-0'}`} aria-hidden="true" />
          <Icon className={`h-[17px] w-[17px] shrink-0 ${active ? 'text-[var(--accent-text)]' : 'text-[var(--text-subtle)] group-hover/item:text-[var(--text)]'}`} aria-hidden="true" />
          {labels && <span className="truncate">{item.label}</span>}
        </button>
        {desktop && !expanded && (
          <span role="tooltip" className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-3 z-50 whitespace-nowrap rounded-lg border border-[var(--border)] bg-[var(--surface-sunken)] px-2.5 py-1.5 text-[12px] text-[var(--text)] shadow-xl opacity-0 group-hover/item:opacity-100 group-focus-within/item:opacity-100 transition-opacity">
            <span className="font-medium">{item.label}</span><span className="block text-[11px] text-[var(--text-muted)]">{item.hint}</span>
          </span>
        )}
      </li>
    );
  };

  const renderNav = (desktop: boolean) => (
    <nav aria-label="Main" className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-3 space-y-3">
      {NAV_GROUPS.map((g) => {
        const labels = showLabels(desktop);
        const closed = labels && closedGroups.includes(g.id) && !g.items.some((i) => i.id === activeId);
        const listId = `${desktop ? 'd' : 'm'}-nav-${g.id}`;
        return (
          <div key={g.id}>
            {g.label && (labels ? (
              <button type="button" onClick={() => toggleGroup(g.id)} aria-expanded={!closed} aria-controls={listId}
                className="w-full flex items-center justify-between px-3 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-[0.09em] text-[var(--text-subtle)] hover:text-[var(--text-muted)] cursor-pointer rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-text)]">
                {g.label}<ChevronDown className={`h-3 w-3 transition-transform ${closed ? '-rotate-90' : ''}`} aria-hidden="true" />
              </button>
            ) : <div className="mx-3 mb-2 h-px bg-white/[0.06]" aria-hidden="true" />)}
            {!closed && <ul id={listId} className="space-y-0.5">{g.items.map((i) => renderItem(i, desktop))}</ul>}
          </div>
        );
      })}
    </nav>
  );

  const brand = (
    <div className="flex items-center gap-3 overflow-hidden">
      <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-[#5b6cff] to-[#22d3ee] flex items-center justify-center shrink-0 shadow-[0_0_16px_rgb(91_108_255/0.45)]" aria-hidden="true"><LayoutDashboard className="h-4 w-4 text-[var(--text)]" /></div>
      <div className="flex flex-col whitespace-nowrap"><span className="font-semibold text-[13px] text-[var(--text)] tracking-[-0.01em]">Obsidian</span><span className="text-[11px] text-[var(--text-subtle)]">AI Command Center</span></div>
    </div>
  );

  return (
    <>
      <aside
        id="dynamic-sidebar-container"
        className={`hidden md:flex print:!hidden relative flex-col h-screen shrink-0 select-none bg-[var(--surface)] border-r border-[var(--border)] text-[var(--text-muted)] transition-[width] duration-200 ${expanded ? 'w-[244px]' : 'w-[68px]'} ${className}`}
      >
        <div className={`h-14 flex items-center border-b border-[var(--border)] shrink-0 ${expanded ? 'justify-between px-4' : 'justify-center px-2'}`}>
          {expanded && brand}
          <button
            id="sidebar-collapse-toggle-btn" type="button" onClick={() => setExpanded(!expanded)}
            className="p-1.5 rounded-lg bg-[var(--surface-sunken)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--border)] transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-text)]"
            aria-label={expanded ? 'Collapse navigation' : 'Expand navigation'} aria-expanded={expanded}
          >
            {expanded ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </div>
        {renderNav(true)}
        <div className="border-t border-[var(--border)] px-3 py-3">
          <ul>{renderItem({ id: 'settings', label: 'All settings', icon: Settings, hint: 'Account and organization' }, true)}</ul>
        </div>
      </aside>

      <div className={`md:hidden fixed inset-0 z-[80] ${mobileOpen ? '' : 'pointer-events-none'}`} aria-hidden={!mobileOpen}>
        <div className={`absolute inset-0 bg-[var(--surface)] transition-opacity ${mobileOpen ? 'opacity-100' : 'opacity-0'}`} onClick={onMobileClose} />
        <aside
          role="dialog" aria-modal="true" aria-label="Navigation"
          className={`absolute inset-y-0 left-0 w-[min(288px,86vw)] flex flex-col bg-[var(--surface)] text-[var(--text-muted)] shadow-2xl transition-transform duration-200 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}
        >
          <div className="h-14 flex items-center justify-between px-4 border-b border-[var(--border)] shrink-0">
            {brand}
            <button type="button" onClick={onMobileClose} aria-label="Close navigation" className="p-2 rounded-lg text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--border)] cursor-pointer"><X className="h-4 w-4" /></button>
          </div>
          {mobileOpen && renderNav(false)}
        </aside>
      </div>
    </>
  );
}

