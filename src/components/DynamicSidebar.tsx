/**
 * App navigation. Modules are grouped by job (Sell, Engage, Market, Insights) with plain labels.
 * Desktop: collapsible rail (remembered per browser) with tooltips when collapsed.
 * Phones/tablets (< md): an off-canvas drawer opened from the header's menu button.
 */
import React, { useEffect, useState } from 'react';
import {
  LayoutDashboard, MessageSquare, FileText, BarChart3, Settings, ChevronLeft, ChevronRight, Video,
  Calendar, Share2, Globe, Phone, Briefcase, X,
} from 'lucide-react';

interface SidebarItem { id: string; label: string; icon: React.ComponentType<any>; hint: string }
interface SidebarGroup { label: string | null; items: SidebarItem[] }

const GROUPS: SidebarGroup[] = [
  { label: null, items: [{ id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, hint: 'Your day at a glance' }] },
  { label: 'Sell', items: [
    { id: 'deals', label: 'Leads & deals', icon: Briefcase, hint: 'Pipeline, leads and deals' },
    { id: 'proposals', label: 'Proposals & invoices', icon: FileText, hint: 'Quotes, e-signature, invoicing' },
  ] },
  { label: 'Engage', items: [
    { id: 'messages', label: 'Inbox', icon: MessageSquare, hint: 'Live chat and team messages' },
    { id: 'greet', label: 'Meetings', icon: Video, hint: 'Video meetings' },
    { id: 'calendar', label: 'Calendar', icon: Calendar, hint: 'Events and bookings' },
    { id: 'voice_dialer', label: 'Phone', icon: Phone, hint: 'Calls and voicemail' },
  ] },
  { label: 'Market', items: [
    { id: 'social_planner', label: 'Social planner', icon: Share2, hint: 'Schedule social posts' },
    { id: 'gbp', label: 'Local SEO', icon: Globe, hint: 'Google Business Profile' },
  ] },
  { label: 'Insights', items: [{ id: 'analytics', label: 'Analytics', icon: BarChart3, hint: 'Reports and trends' }] },
];
const SETTINGS: SidebarItem = { id: 'settings', label: 'Settings', icon: Settings, hint: 'Account and organization' };

interface DynamicSidebarProps {
  activeId?: string;
  onActiveIdChange?: (id: string) => void;
  className?: string;
  /** Small screens: whether the drawer is open, and how to close it. */
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

const STORAGE_KEY = 'obsidian_sidebar_expanded';

export default function DynamicSidebar({ activeId = 'dashboard', onActiveIdChange, className = '', mobileOpen = false, onMobileClose }: DynamicSidebarProps) {
  const [expanded, setExpanded] = useState<boolean>(() => {
    try { return localStorage.getItem(STORAGE_KEY) !== 'false'; } catch { return true; }
  });
  useEffect(() => { try { localStorage.setItem(STORAGE_KEY, String(expanded)); } catch { /* storage unavailable */ } }, [expanded]);

  // Close the drawer with Escape.
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onMobileClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mobileOpen, onMobileClose]);

  const go = (id: string) => { onActiveIdChange?.(id); onMobileClose?.(); };
  // In the drawer the labels are always shown.
  const showLabels = (desktop: boolean) => (desktop ? expanded : true);

  const renderItem = (item: SidebarItem, desktop: boolean) => {
    const Icon = item.icon;
    const active = activeId === item.id;
    const labels = showLabels(desktop);
    return (
      <li key={item.id} className="relative group/item">
        <button
          type="button"
          id={desktop ? `dynamic-sidebar-btn-${item.id}` : undefined}
          onClick={() => go(item.id)}
          aria-current={active ? 'page' : undefined}
          aria-label={labels ? undefined : item.label}
          className={`relative w-full flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--obsidian-accent)] ${
            labels ? '' : 'justify-center'
          } ${active ? 'bg-white/[0.08] text-white' : 'text-neutral-400 hover:text-neutral-100 hover:bg-white/[0.04]'}`}
        >
          <span className={`absolute left-0 top-2 bottom-2 w-[3px] rounded-r bg-[var(--accent)] transition-opacity ${active ? 'opacity-100' : 'opacity-0'}`} aria-hidden="true" />
          <Icon className={`h-[18px] w-[18px] shrink-0 ${active ? 'text-[var(--obsidian-accent)]' : 'text-neutral-500 group-hover/item:text-neutral-200'}`} aria-hidden="true" />
          {labels && <span className="truncate">{item.label}</span>}
        </button>
        {desktop && !expanded && (
          <span role="tooltip" className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-3 z-50 whitespace-nowrap rounded-lg border border-white/10 bg-neutral-950 px-2.5 py-1.5 text-[12px] text-white shadow-xl opacity-0 group-hover/item:opacity-100 group-focus-within/item:opacity-100 transition-opacity">
            <span className="font-medium">{item.label}</span><span className="block text-[11px] text-neutral-400">{item.hint}</span>
          </span>
        )}
      </li>
    );
  };

  const renderNav = (desktop: boolean) => (
    <>
      <nav aria-label="Main" className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-4 space-y-4">
        {GROUPS.map((g, gi) => (
          <div key={gi}>
            {g.label && (showLabels(desktop)
              ? <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-neutral-500">{g.label}</p>
              : <div className="mx-3 mb-2 h-px bg-white/[0.06]" aria-hidden="true" />)}
            <ul className="space-y-0.5">{g.items.map((i) => renderItem(i, desktop))}</ul>
          </div>
        ))}
      </nav>
      <div className="border-t border-white/5 px-3 py-3">
        <ul>{renderItem(SETTINGS, desktop)}</ul>
      </div>
    </>
  );

  const brand = (labels: boolean) => (
    <div className="flex items-center gap-3 overflow-hidden">
      <div className="h-8 w-8 rounded-lg bg-[var(--accent)] flex items-center justify-center shrink-0" aria-hidden="true"><LayoutDashboard className="h-4 w-4 text-white" /></div>
      {labels && <div className="flex flex-col whitespace-nowrap"><span className="font-semibold text-[13px] text-white tracking-[-0.01em]">Obsidian</span><span className="text-[11px] text-neutral-500">CRM</span></div>}
    </div>
  );

  return (
    <>
      {/* Desktop rail */}
      <aside
        id="dynamic-sidebar-container"
        className={`hidden md:flex print:!hidden relative flex-col h-screen shrink-0 select-none obsidian bg-[var(--obsidian-1)] border-r border-[var(--obsidian-line)] text-neutral-300 transition-[width] duration-200 ${expanded ? 'w-[232px]' : 'w-[68px]'} ${className}`}
      >
        <div className={`h-14 flex items-center border-b border-white/5 shrink-0 ${expanded ? 'justify-between px-4' : 'justify-center px-2'}`}>
          {expanded && brand(true)}
          <button
            id="sidebar-collapse-toggle-btn"
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="p-1.5 rounded-lg bg-white/5 border border-white/10 text-neutral-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--obsidian-accent)]"
            aria-label={expanded ? 'Collapse navigation' : 'Expand navigation'}
            aria-expanded={expanded}
          >
            {expanded ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </div>
        {renderNav(true)}
      </aside>

      {/* Mobile drawer */}
      <div className={`md:hidden fixed inset-0 z-[80] ${mobileOpen ? '' : 'pointer-events-none'}`} aria-hidden={!mobileOpen}>
        <div className={`absolute inset-0 bg-black/50 transition-opacity ${mobileOpen ? 'opacity-100' : 'opacity-0'}`} onClick={onMobileClose} />
        <aside
          role="dialog" aria-modal="true" aria-label="Navigation"
          className={`obsidian absolute inset-y-0 left-0 w-[min(280px,85vw)] flex flex-col bg-[var(--obsidian-1)] text-neutral-300 shadow-2xl transition-transform duration-200 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}
        >
          <div className="h-14 flex items-center justify-between px-4 border-b border-white/5 shrink-0">
            {brand(true)}
            <button type="button" onClick={onMobileClose} aria-label="Close navigation" className="p-2 rounded-lg text-neutral-400 hover:text-white hover:bg-white/10 cursor-pointer"><X className="h-4 w-4" /></button>
          </div>
          {mobileOpen && renderNav(false)}
        </aside>
      </div>
    </>
  );
}
