/**
 * Local Growth: AI-powered Google Business Profile management.
 * CONNECT → AUDIT → ANALYZE → RECOMMEND → APPROVE → OPTIMIZE → MONITOR → GROW
 */
import React, { Suspense, lazy, useEffect, useState } from 'react';
import { BarChart3, Bell, Bot, ClipboardCheck, LayoutDashboard, Menu, MessageSquareText, Megaphone, Radar, Settings, ShieldCheck, Sparkles, Store, Swords, Wand2, X } from 'lucide-react';
import './growth.css';
import { useTheme } from '../../../context/ThemeContext';
import { GrowthProvider, useGrowth, type Route } from './GrowthStore';
import { Onboarding } from './Onboarding';
import { Alert, Badge, Button, Skeleton, ToastProvider, fmtDate } from './ui';

const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const AuditPage = lazy(() => import('./pages/AuditPage'));
const OptimizePage = lazy(() => import('./pages/OptimizePage'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));
const ReviewsPage = lazy(() => import('./pages/ReviewsPage'));
const PostsPage = lazy(() => import('./pages/PostsPage'));
const CompetitorsPage = lazy(() => import('./pages/CompetitorsPage'));
const VisibilityPage = lazy(() => import('./pages/VisibilityPage'));
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage'));
const AssistantPage = lazy(() => import('./pages/AssistantPage'));
const AutomationPage = lazy(() => import('./pages/AutomationPage'));
const SecurityPage = lazy(() => import('./pages/SecurityPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));

const NAV: { group: string; items: { id: Route; label: string; icon: React.ElementType }[] }[] = [
  { group: 'Overview', items: [{ id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard }, { id: 'assistant', label: 'AI assistant', icon: Bot }] },
  { group: 'Improve', items: [{ id: 'audit', label: 'Profile audit', icon: ClipboardCheck }, { id: 'optimize', label: 'Local SEO optimizer', icon: Wand2 }, { id: 'profile', label: 'Business profile', icon: Store }] },
  { group: 'Engage', items: [{ id: 'reviews', label: 'Reviews', icon: MessageSquareText }, { id: 'posts', label: 'Posts & calendar', icon: Megaphone }] },
  { group: 'Monitor', items: [{ id: 'analytics', label: 'Performance', icon: BarChart3 }, { id: 'visibility', label: 'Visibility', icon: Radar }, { id: 'competitors', label: 'Competitors', icon: Swords }] },
  { group: 'Manage', items: [{ id: 'automation', label: 'Recommendations', icon: Bell }, { id: 'security', label: 'Security center', icon: ShieldCheck }, { id: 'settings', label: 'Settings', icon: Settings }] },
];

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { route, go, dash } = useGrowth();
  return (
    <nav aria-label="Local growth" className="flex h-full flex-col gap-1 overflow-y-auto px-3 py-4" style={{ background: 'var(--g-surface)', borderRight: '1px solid var(--g-line)' }}>
      <div className="flex items-center gap-2.5 px-2 pb-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: 'linear-gradient(135deg, var(--g-accent-strong), var(--g-teal))', color: '#fff' }}><Sparkles size={18} aria-hidden /></span>
        <span className="leading-tight"><span className="block text-[15px] font-bold">Local Growth</span><span className="g-faint block text-[11.5px]">Business Profile manager</span></span>
      </div>
      {NAV.map((g) => (
        <div key={g.group}>
          <div className="g-nav-group">{g.group}</div>
          {g.items.map((n) => (
            <button key={n.id} type="button" className="g-nav-item" aria-current={route === n.id ? 'page' : undefined} onClick={() => { go(n.id); onNavigate?.(); }}>
              <n.icon size={17} aria-hidden /><span className="flex-1">{n.label}</span>
              {n.id === 'automation' && !!dash?.inboxOpen && <Badge tone="accent">{dash.inboxOpen}</Badge>}
              {n.id === 'security' && dash?.security.status === 'attention' && <Badge tone="warn">!</Badge>}
            </button>
          ))}
        </div>
      ))}
      <p className="g-faint mt-auto px-2 pt-4 text-[11px]">Not affiliated with or endorsed by Google.</p>
    </nav>
  );
}

function Header({ onMenu }: { onMenu: () => void }) {
  const { dash, location, setLocation } = useGrowth();
  const conn = dash?.connection;
  const lastAudit = dash?.locations.find((l) => l.location.name === location?.name)?.growthAudit?.generatedAt;
  return (
    <header className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-6" style={{ borderBottom: '1px solid var(--g-line)', background: 'var(--g-surface)' }}>
      <button type="button" className="g-icon-btn lg:hidden" aria-label="Open navigation" onClick={onMenu}><Menu size={20} /></button>
      {dash && dash.locations.length > 0 && (
        <label className="flex min-w-0 items-center gap-2">
          <span className="sr-only">Location</span>
          <select className="g-select" style={{ minHeight: 36, maxWidth: 320 }} value={location?.name ?? ''} onChange={(e) => setLocation(e.target.value)}>
            {dash.locations.map((l) => <option key={l.location.name} value={l.location.name}>{l.location.title}{l.location.address?.city ? ` · ${l.location.address.city}` : ''}</option>)}
          </select>
        </label>
      )}
      <span className="flex-1" />
      <span className="flex flex-wrap items-center gap-2 text-[12.5px]">
        {conn?.connected ? <Badge tone="ok">Google connected</Badge> : conn?.needsReconnect ? <Badge tone="danger">Reconnect needed</Badge> : <Badge>Not connected</Badge>}
        {lastAudit && <span className="g-faint hidden sm:inline">Last audit {fmtDate(lastAudit)}</span>}
      </span>
    </header>
  );
}

function Page() {
  const { route } = useGrowth();
  const P = { dashboard: DashboardPage, audit: AuditPage, optimize: OptimizePage, profile: ProfilePage, reviews: ReviewsPage, posts: PostsPage, competitors: CompetitorsPage, visibility: VisibilityPage, analytics: AnalyticsPage, assistant: AssistantPage, automation: AutomationPage, security: SecurityPage, settings: SettingsPage }[route];
  return <Suspense fallback={<div className="space-y-4 p-6"><Skeleton h={32} w={260} /><Skeleton h={180} /><Skeleton h={240} /></div>}><P /></Suspense>;
}

function Shell() {
  const { dash, status, error, reload } = useGrowth();
  const [drawer, setDrawer] = useState(false);
  const [onboardingClosed, setOnboardingClosed] = useState(false);
  useEffect(() => { const p = new URLSearchParams(window.location.search); if (p.get('gbp') === 'connected') { p.delete('gbp'); window.history.replaceState(null, '', `${window.location.pathname}${p.toString() ? `?${p}` : ''}`); } }, []);

  if (status === 'loading') return <div className="space-y-4 p-6"><Skeleton h={40} w={320} /><div className="grid gap-4 sm:grid-cols-3"><Skeleton h={120} /><Skeleton h={120} /><Skeleton h={120} /></div><Skeleton h={260} /></div>;
  if (status === 'error') return <div className="p-6"><Alert tone="danger" title="This tab couldn’t load" action={<Button size="sm" onClick={reload}>Try again</Button>}>{error}</Alert></div>;

  const conn = dash!.connection;
  const needsOnboarding = !conn.connected || !dash!.locations.length || (!dash!.onboarding.completedAt && !dash!.locations.some((l) => l.growthAudit) && !onboardingClosed);
  if (needsOnboarding) return <Onboarding onDone={() => setOnboardingClosed(true)} />;

  return (
    <div className="flex h-full min-h-0">
      <aside className="hidden w-[248px] flex-none lg:block"><Sidebar /></aside>
      {drawer && (
        <div className="g-overlay lg:hidden" style={{ justifyContent: 'flex-start', padding: 0 }} onMouseDown={(e) => { if (e.target === e.currentTarget) setDrawer(false); }}>
          <div className="relative h-full w-[280px] max-w-[85vw]" role="dialog" aria-modal="true" aria-label="Navigation">
            <Sidebar onNavigate={() => setDrawer(false)} />
            <button type="button" className="g-icon-btn absolute right-2 top-3" aria-label="Close navigation" onClick={() => setDrawer(false)}><X size={18} /></button>
          </div>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <Header onMenu={() => setDrawer(true)} />
        {conn.needsReconnect && <div className="px-4 pt-4 sm:px-6"><Alert tone="danger" title="Google access expired or was revoked">Reconnect in Settings to keep your data up to date.</Alert></div>}
        <main id="gp-main" className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6"><div className="mx-auto max-w-[1280px]"><Page /></div></main>
      </div>
    </div>
  );
}

export default function GrowthApp({ devUser }: { devUser: string }) {
  const { resolved } = useTheme();
  return (
    <div className="gp overflow-hidden rounded-2xl" data-theme={resolved} style={{ height: 'calc(100vh - 120px)', minHeight: 640, border: '1px solid var(--g-line)' }}>
      <ToastProvider>
        <GrowthProvider devUser={devUser}><Shell /></GrowthProvider>
      </ToastProvider>
    </div>
  );
}

