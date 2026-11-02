/**
 * Pulse — the Social Planner tab. Self-contained and scoped (.sp).
 * All posts and accounts come from /api/posts; nothing is seeded client-side.
 */
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, BarChart3, Bell, Calendar, Check, ChevronsUpDown, Inbox, LayoutDashboard, Menu, PenSquare, Plus, Radio, Search, Settings, X,
} from 'lucide-react';
import './planner.css';
import { addDays, defaultSlot, formatDateTime, startOfDay } from './domain/calendar';
import { PLATFORMS, postTitle, type PlannerPost } from './domain/model';
import { createPlannerApi, type PlannerApi } from './services/plannerApi';
import { PlannerStoreProvider, usePlanner } from './state/PlannerStore';
import { PrefsProvider, usePrefs } from './state/prefs';
import { PreviewProvider, usePreview } from './components/posts';
import { Composer, type ComposerOpen } from './components/Composer';
import { CalendarPage, type CalView } from './pages/CalendarPage';
import { AccountsPage as LegacyAccountsPage, AnalyticsPage, DashboardPage, InboxPage, NotificationList, SettingsPage, useNotifications } from './pages/OtherPages';
import { AccountsPage } from './pages/AccountsPage';
import type { AccountsApi } from '../social-accounts/client/accountsApi';
import { normalizeAccount } from './domain/model';
import { Button, Dialog, IconButton, PlatformGlyph, PlatformLogo, Portal, SectionHeader, Skeleton, ToastProvider, cx } from './ui/kit';

type Route = 'dashboard' | 'calendar' | 'compose' | 'analytics' | 'accounts' | 'inbox' | 'settings' | 'classic';

type NavItem = { id: Exclude<Route, 'classic'>; label: string; icon: React.ElementType };
const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  { label: 'Plan', items: [
    { id: 'dashboard', label: 'Overview', icon: LayoutDashboard },
    { id: 'calendar', label: 'Calendar', icon: Calendar },
    { id: 'compose', label: 'Compose', icon: PenSquare },
  ] },
  { label: 'Manage', items: [
    { id: 'accounts', label: 'Channels', icon: Radio },
    { id: 'inbox', label: 'Inbox', icon: Inbox },
  ] },
  { label: 'Insights', items: [
    { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  ] },
];

/** Section title + one-line description shown above each page. */
const SECTIONS: Record<Route, { title: string; description: string }> = {
  dashboard: { title: 'Overview', description: 'What’s scheduled, what went out, and what needs your attention.' },
  calendar: { title: 'Content calendar', description: 'Plan and reschedule posts across every channel. Drag a post to move it.' },
  compose: { title: 'Compose', description: '' },
  analytics: { title: 'Analytics', description: 'Publishing activity across your channels.' },
  accounts: { title: 'Channels', description: '' },
  inbox: { title: 'Inbox', description: 'Comments and direct messages from your channels.' },
  settings: { title: 'Settings', description: 'Planner preferences and advanced integrations.' },
  classic: { title: 'Advanced tools', description: 'Postiz panel, publishing worker monitor and the grid planner.' },
};

export interface PlannerAppProps {
  userId: string;
  workspaceName: string;
  userName?: string;
  /** Opens the CRM's Messaging view (for Inbox). */
  onOpenMessaging?: () => void;
  /** Renders the previous planner (integrations, worker monitor…) under Settings. */
  renderClassicTools?: () => React.ReactNode;
  /** Start on the advanced tools (e.g. after an OAuth redirect). */
  startInClassic?: boolean;
  /** Inject an API implementation (tests, previews). Defaults to the /api/posts client. */
  api?: PlannerApi;
  /** Auth headers for /api/* calls (Firebase ID token). */
  getAuthHeaders?: () => Promise<Record<string, string>>;
  /** Optional notice shown under the header (e.g. preview mode). */
  notice?: string;
  /** Connected-accounts API (/api/accounts). Enables the full Accounts page. */
  accountsApi?: AccountsApi;
  /** Start on the Accounts page (e.g. returning from an authorization redirect). */
  startInAccounts?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

function WorkspaceSelector({ name, compact }: { name: string; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  const initial = name.trim().charAt(0).toUpperCase() || 'W';
  const mark = (s: number) => (
    <span className="flex flex-none items-center justify-center rounded-lg font-semibold" style={{ width: s, height: s, fontSize: s * 0.42, background: 'var(--sp-accent)', color: 'var(--accent-contrast, #fff)' }} aria-hidden>{initial}</span>
  );
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)} aria-label={`Workspace: ${name}`}
        className={cx('flex w-full items-center gap-2.5 rounded-[10px] text-left transition-colors hover:bg-[var(--sp-surface-2)]', compact ? 'justify-center p-1.5' : 'p-1.5 pr-2')}
        style={{ background: 'transparent', border: 0, font: 'inherit', color: 'inherit', cursor: 'pointer' }}>
        {mark(32)}
        {!compact && <>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13.5px] font-semibold leading-tight">{name}</span>
            <span className="sp-faint block truncate text-[12px] leading-tight">Social Planner</span>
          </span>
          <ChevronsUpDown size={15} className="sp-faint" aria-hidden />
        </>}
      </button>
      {open && (
        <div role="listbox" aria-label="Workspaces" className="sp-pop animate absolute left-0 top-[calc(100%+6px)] z-40 w-[232px] p-1.5">
          <div role="option" aria-selected="true" className="flex items-center gap-2.5 rounded-lg p-2 text-[13.5px]" style={{ background: 'var(--sp-surface-2)' }}>
            {mark(24)}
            <span className="flex-1 truncate font-medium">{name}</span><Check size={15} style={{ color: 'var(--sp-accent-text)' }} />
          </div>
          <p className="sp-faint px-2 pb-1 pt-2 text-[12px]">Workspaces are managed in CRM settings.</p>
        </div>
      )}
    </div>
  );
}

function NavButton({ item, active, compact, onClick, badge }: { item: NavItem; active: boolean; compact: boolean; onClick: () => void; badge?: number }) {
  return (
    <button type="button" className={cx('sp-nav-item', compact && 'justify-center px-0')} aria-current={active ? 'page' : undefined}
      onClick={onClick} title={compact ? item.label : undefined} aria-label={compact ? item.label : undefined}>
      <item.icon size={17} aria-hidden />
      {!compact && item.label}
      {!!badge && (compact
        ? <span className="absolute right-2 top-1.5 h-2 w-2 rounded-full" style={{ background: 'var(--sp-danger)' }} aria-label={`${badge} failed`} />
        : <span className="sp-badge" style={{ background: 'var(--sp-danger)' }} aria-label={`${badge} failed posts`}>{badge}</span>)}
    </button>
  );
}

function Sidebar({ route, go, workspaceName, compact, failedCount, onClose }: { route: Route; go: (r: Route) => void; workspaceName: string; compact: boolean; failedCount: number; onClose?: () => void }) {
  const { accounts, accountsState } = usePlanner();
  const shown = accounts?.slice(0, 5) ?? [];
  const more = (accounts?.length ?? 0) - shown.length;
  return (
    <nav aria-label="Social Planner" className="flex h-full flex-col px-3 py-4" style={{ background: 'var(--sp-sidebar)', borderRight: '1px solid var(--sp-border)' }}>
      <div className="flex items-center gap-1">
        <div className="min-w-0 flex-1"><WorkspaceSelector name={workspaceName} compact={compact} /></div>
        {onClose && <IconButton label="Close navigation" small onClick={onClose}><X size={18} /></IconButton>}
      </div>
      <div className="mt-5 min-h-0 flex-1 space-y-5 overflow-y-auto">
        {NAV_GROUPS.map((g) => (
          <div key={g.label}>
            {compact ? <div className="sp-divider mx-2 mb-2" /> : <p className="sp-nav-label">{g.label}</p>}
            <ul className="space-y-0.5">
              {g.items.map((n) => (
                <li key={n.id}><NavButton item={n} active={route === n.id} compact={compact} onClick={() => go(n.id)} badge={n.id === 'dashboard' ? failedCount : undefined} /></li>
              ))}
            </ul>
          </div>
        ))}
        {!compact && (
          <div>
            <div className="flex items-center justify-between pr-1">
              <p className="sp-nav-label">Connected</p>
              <button type="button" onClick={() => go('accounts')} className="sp-faint -mt-1.5 rounded-md p-1 hover:text-[var(--sp-text)]" style={{ background: 'none', border: 0, cursor: 'pointer' }} aria-label="Connect an account" title="Connect an account"><Plus size={14} /></button>
            </div>
            {accountsState.status === 'loading' && !accounts ? <div className="space-y-2 px-2.5">{[0, 1].map((i) => <Skeleton key={i} style={{ height: 18 }} />)}</div>
              : accountsState.status === 'error' ? <p className="sp-faint px-2.5 text-[12.5px]">Couldn’t load channels.</p>
              : !accounts?.length ? <button type="button" onClick={() => go('accounts')} className="px-2.5 text-left text-[12.5px] font-medium" style={{ background: 'none', border: 0, color: 'var(--sp-accent-text)', cursor: 'pointer', font: 'inherit' }}>Connect your first channel</button>
              : (
                <ul className="space-y-0.5">
                  {shown.map((a) => (
                    <li key={a.id}>
                      <button type="button" onClick={() => go('accounts')} className="sp-nav-item" style={{ height: 32, fontSize: 12.5 }}>
                        {a.platform ? <PlatformLogo id={a.platform} size={18} style={{ borderRadius: 5 }} /> : <span className="h-[18px] w-[18px]" />}
                        <span className="min-w-0 flex-1 truncate">{a.handle || a.rawPlatform}</span>
                        <span className="h-1.5 w-1.5 flex-none rounded-full" style={{ background: a.health === 'expired' ? 'var(--sp-danger)' : a.health === 'attention' ? 'var(--sp-warning)' : 'var(--sp-success)' }}
                          title={a.health === 'expired' ? 'Expired' : a.health === 'attention' ? 'Needs attention' : 'Connected'} aria-label={a.health === 'expired' ? 'Expired' : a.health === 'attention' ? 'Needs attention' : 'Connected'} />
                      </button>
                    </li>
                  ))}
                  {more > 0 && <li><button type="button" onClick={() => go('accounts')} className="sp-nav-item" style={{ height: 30, fontSize: 12.5 }}><span className="w-[18px]" />+{more} more</button></li>}
                </ul>
              )}
          </div>
        )}
      </div>
      <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--sp-border)' }}>
        <NavButton item={{ id: 'settings', label: 'Settings', icon: Settings }} active={route === 'settings' || route === 'classic'} compact={compact} onClick={() => go('settings')} />
      </div>
    </nav>
  );
}

function SearchDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { posts, useRange } = usePlanner();
  const { prefs } = usePrefs();
  const { open: openPreview } = usePreview();
  const [q, setQ] = useState('');
  const { from, to } = useMemo(() => { const t = startOfDay(new Date()); return { from: addDays(t, -180), to: addDays(t, 181) }; }, []);
  const range = useRange(from, to);
  const term = q.trim().toLowerCase();
  const results = term ? posts.filter((p) => p.content.toLowerCase().includes(term)).slice(0, 20) : [];
  return (
    <Dialog open={open} onClose={() => { setQ(''); onClose(); }} title="Search posts" width={560} description="Searches posts from the last and next six months.">
      <div className="relative">
        <Search size={16} className="sp-faint absolute left-3 top-1/2 -translate-y-1/2" aria-hidden />
        <input className="sp-input" style={{ paddingLeft: 36 }} type="search" placeholder="Search post text" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search post text" data-autofocus />
      </div>
      <div className="mt-3 min-h-[120px]" aria-live="polite">
        {range.status === 'loading' && term ? <div className="space-y-2">{[0, 1].map((i) => <Skeleton key={i} style={{ height: 48 }} />)}</div>
          : range.status === 'error' ? <p className="sp-danger-text text-[13px]">{range.error}</p>
          : !term ? <p className="sp-faint py-8 text-center text-[13px]">Type to search your posts.</p>
          : !results.length ? <p className="sp-muted py-8 text-center text-[13px]">No posts match “{q.trim()}”.</p>
          : (
            <ul className="space-y-1.5">
              {results.map((p) => (
                <li key={p.id}>
                  <button type="button" className="flex w-full items-center gap-3 rounded-xl p-2.5 text-left" style={{ background: 'var(--sp-surface)', border: '1px solid var(--sp-border)', font: 'inherit', color: 'inherit', cursor: 'pointer' }}
                    onClick={(e) => { const el = e.currentTarget; openPreview(p, el, true); }}>
                    {p.platforms[0] && <PlatformGlyph id={p.platforms[0]} size={16} color={PLATFORMS[p.platforms[0]].dot} />}
                    <span className="min-w-0 flex-1 truncate text-[13.5px]">{postTitle(p, 80)}</span>
                    <span className="sp-faint flex-none text-[12px] num">{formatDateTime(p.scheduledAt, prefs.hour12)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
      </div>
    </Dialog>
  );
}

function NotificationsButton() {
  const { count, soon } = useNotifications();
  const { open: openPreview } = usePreview();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  const total = count + soon.length;
  return (
    <div ref={ref} className="relative">
      <IconButton label={`Notifications${total ? `, ${total}` : ''}`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="relative flex"><Bell size={17} />{count > 0 && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full" style={{ background: 'var(--sp-danger)', boxShadow: '0 0 0 2px var(--sp-surface)' }} />}</span>
      </IconButton>
      {open && (
        <div className="sp-pop animate absolute right-0 top-[calc(100%+8px)] z-40 w-[min(340px,calc(100vw-24px))]" role="dialog" aria-label="Notifications">
          <p className="px-4 pb-1 pt-3 text-[13.5px] font-semibold">Notifications</p>
          <NotificationList onPick={(p, el) => { setOpen(false); openPreview(p, el, true); }} />
        </div>
      )}
    </div>
  );
}

function Shell(props: PlannerAppProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1280);
  const [route, setRoute] = useState<Route>(props.startInClassic ? 'classic' : props.startInAccounts ? 'accounts' : 'calendar');
  const [drawer, setDrawer] = useState(false);
  const [noticeHidden, setNoticeHidden] = useState(false);
  const [search, setSearch] = useState(false);
  const [composer, setComposer] = useState<ComposerOpen | null>(null);
  const [calView, setCalView] = useState<CalView>('month');
  const [anchor, setAnchor] = useState(() => new Date());
  const { prefs } = usePrefs();
  const { count: failedCount } = useNotifications();

  useLayoutEffect(() => {
    if (!rootRef.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(rootRef.current);
    return () => ro.disconnect();
  }, []);
  const mode = width >= 1100 ? 'desktop' : width >= 720 ? 'tablet' : 'mobile';
  useEffect(() => { if (mode === 'mobile' && calView === 'week') setCalView('list'); }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // ⌘K / Ctrl+K opens post search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && rootRef.current?.isConnected) { e.preventDefault(); setSearch(true); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const newPost = (iso?: string) => setComposer({ mode: 'create', scheduledAt: iso ?? defaultSlot(new Date(), prefs.defaultHour) });
  const go = (r: Route) => {
    setDrawer(false);
    if (r === 'compose') { newPost(); return; }
    setRoute(r);
    document.getElementById('sp-main')?.scrollTo({ top: 0 });
  };

  const sidebar = (compact: boolean, onClose?: () => void) => <Sidebar route={route} go={go} workspaceName={props.workspaceName} compact={compact} failedCount={failedCount} onClose={onClose} />;
  const section = SECTIONS[route];
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

  return (
    <PreviewProvider onEdit={(p: PlannerPost) => setComposer({ mode: 'edit', post: p })}>
      <div ref={rootRef} className="flex h-full overflow-hidden rounded-[var(--sp-radius-panel)]" style={{ background: 'var(--sp-shell)', border: '1px solid var(--sp-border)' }}>
        {mode !== 'mobile' && <aside className="flex-none" style={{ width: mode === 'desktop' ? 248 : 68 }}>{sidebar(mode === 'tablet')}</aside>}
        {mode === 'mobile' && drawer && (
          <Portal>
            <div className="sp-overlay" style={{ justifyContent: 'flex-start', padding: 0 }} onMouseDown={(e) => { if (e.target === e.currentTarget) setDrawer(false); }}>
              <div className="relative h-full w-[280px] max-w-[85vw]" role="dialog" aria-modal="true" aria-label="Navigation">
                {sidebar(false, () => setDrawer(false))}
              </div>
            </div>
          </Portal>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex flex-none items-center gap-3 px-4 py-3.5 sm:px-6" style={{ background: 'var(--sp-surface)', borderBottom: '1px solid var(--sp-border)' }}>
            {mode === 'mobile' && <IconButton label="Open navigation" small onClick={() => setDrawer(true)}><Menu size={20} /></IconButton>}
            <div className="min-w-0 flex-1">
              <h1 className="display truncate text-[18px] font-semibold leading-tight sm:text-[20px]">Social Planner</h1>
              {mode !== 'mobile' && <p className="sp-muted truncate text-[13px]">Plan, schedule and publish to every channel from one place.</p>}
            </div>
            {mode === 'desktop'
              ? <button type="button" className="sp-search-trigger" onClick={() => setSearch(true)} aria-label="Search posts" aria-keyshortcuts={isMac ? 'Meta+K' : 'Control+K'}><Search size={15} aria-hidden /><span>Search posts…</span><span className="sp-kbd" aria-hidden>{isMac ? '⌘K' : 'Ctrl K'}</span></button>
              : <IconButton label="Search posts" onClick={() => setSearch(true)}><Search size={17} /></IconButton>}
            <NotificationsButton />
            {mode === 'mobile'
              ? <IconButton label="New post" onClick={() => newPost()} style={{ background: 'var(--sp-accent)', borderColor: 'var(--sp-accent)', color: '#fff' }}><Plus size={18} /></IconButton>
              : <Button variant="primary" icon={<Plus size={16} />} onClick={() => newPost()}>New post</Button>}
          </header>
          {props.notice && !noticeHidden && (
            <div role="status" className="flex flex-none items-center gap-3 px-4 py-2 text-[12.5px] sm:px-6" style={{ background: 'var(--sp-accent-tint)', borderBottom: '1px solid var(--sp-border)' }}>
              <span className="min-w-0 flex-1">{props.notice}</span>
              <IconButton label="Hide notice" small onClick={() => setNoticeHidden(true)}><X size={14} /></IconButton>
            </div>
          )}
          <main className="relative min-h-0 flex-1 overflow-y-auto" id="sp-main">
            <div className="mx-auto w-full max-w-[1320px]">
              {route !== 'accounts' && (
                <div className="flex items-start gap-2 px-4 pt-5 sm:px-6 sm:pt-6">
                  {route === 'classic' && <IconButton label="Back to settings" small onClick={() => setRoute('settings')}><ArrowLeft size={18} /></IconButton>}
                  <div className="min-w-0 flex-1"><SectionHeader title={section.title} description={section.description} /></div>
                </div>
              )}
              {route === 'dashboard' && <DashboardPage onOpenCalendar={() => setRoute('calendar')} onCompose={() => newPost()} />}
              {route === 'calendar' && <CalendarPage onCompose={newPost} view={calView} setView={setCalView} anchor={anchor} setAnchor={setAnchor} />}
              {route === 'analytics' && <AnalyticsPage />}
              {route === 'accounts' && (props.accountsApi
                ? <AccountsPage api={props.accountsApi} onOpenAdvanced={props.renderClassicTools ? () => setRoute('classic') : undefined} />
                : <LegacyAccountsPage onManage={() => setRoute('classic')} />)}
              {route === 'inbox' && <InboxPage onOpenMessaging={props.onOpenMessaging} />}
              {route === 'settings' && <SettingsPage onOpenClassic={() => setRoute('classic')} />}
              {route === 'classic' && (
                <div className="p-4 sm:p-6">
                  <div className="sp-card overflow-hidden" style={{ background: '#f8fafc', color: '#0f172a' }}>
                    {props.renderClassicTools ? props.renderClassicTools() : <p className="p-6 text-[13px]">Advanced tools aren’t available here.</p>}
                  </div>
                </div>
              )}
            </div>
          </main>
        </div>
      </div>
      <Composer open={!!composer} target={composer} defaultPlatforms={prefs.defaultPlatforms} onClose={() => setComposer(null)} />
      {search && <SearchDialog open onClose={() => setSearch(false)} />}
    </PreviewProvider>
  );
}

export default function PlannerApp(props: PlannerAppProps) {
  const api = useMemo(() => {
    const base = props.api ?? createPlannerApi(props.getAuthHeaders ?? (async () => ({})));
    const accountsApi = props.accountsApi;
    if (!accountsApi) return base;
    // Sidebar and composer show the same connected accounts as the Accounts page.
    return {
      ...base,
      async listAccounts() {
        const o = await accountsApi.overview();
        return o.platforms.flatMap((c) => c.status === 'not_connected' ? [] : c.accounts.map((a) =>
          normalizeAccount({ id: a.connectionId, platform: c.platform, handle: a.handle || a.name, health: c.status === 'expired' ? 'expired' : c.status === 'needs_attention' ? 'attention' : 'ok' }))).filter((a): a is NonNullable<typeof a> => a !== null);
      },
    };
  }, [props.api, props.getAuthHeaders, props.accountsApi]);
  return (
    <div className={cx('sp', props.className)} style={{ height: 'calc(100vh - 120px)', minHeight: 620, ...props.style }}>
      <ToastProvider>
        <PrefsProvider userId={props.userId}>
          <PlannerStoreProvider api={api}>
            <Shell {...props} />
          </PlannerStoreProvider>
        </PrefsProvider>
      </ToastProvider>
    </div>
  );
}
