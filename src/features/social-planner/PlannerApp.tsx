/**
 * Pulse — the Social Planner tab. Self-contained and scoped (.sp).
 * All posts and accounts come from /api/posts; nothing is seeded client-side.
 */
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, BarChart3, Radio, Bell, Calendar, Check, ChevronsUpDown, Inbox, LayoutDashboard, Menu, PenSquare, Plus, Search, Settings, Users, X, Zap,
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
import { OverviewPage } from './pages/OverviewPage';
import { ChannelsPage } from './pages/ChannelsPage';
import { channelKey } from './domain/channels';
import type { AccountsApi } from '../social-accounts/client/accountsApi';
import { normalizeAccount } from './domain/model';
import { Button, Dialog, IconButton, PlatformGlyph, Portal, Skeleton, ToastProvider, cx } from './ui/kit';

type Route = 'channels' | 'dashboard' | 'calendar' | 'compose' | 'analytics' | 'accounts' | 'inbox' | 'settings' | 'classic';

const NAV: { id: Exclude<Route, 'classic'>; label: string; icon: React.ElementType }[] = [
  { id: 'channels', label: 'Channels', icon: Radio },
  { id: 'dashboard', label: 'Overview', icon: LayoutDashboard },
  { id: 'calendar', label: 'Calendar', icon: Calendar },
  { id: 'compose', label: 'Compose', icon: PenSquare },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'accounts', label: 'Accounts', icon: Users },
  { id: 'inbox', label: 'Inbox', icon: Inbox },
  { id: 'settings', label: 'Settings', icon: Settings },
];

const TITLES: Record<Route, string> = {
  channels: 'Channels', dashboard: 'Overview', calendar: 'Content Calendar', compose: 'Compose', analytics: 'Analytics',
  accounts: 'Accounts', inbox: 'Inbox', settings: 'Settings', classic: 'Advanced tools',
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

function Logo({ compact }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full" style={{ background: 'linear-gradient(135deg,#7c6cf6,#5468f2)', boxShadow: '0 6px 16px -6px rgba(109,94,245,.8)' }}>
        <Zap size={18} fill="#fff" color="#fff" aria-hidden />
      </span>
      {!compact && <span className="display text-[21px] font-bold tracking-tight">Pulse</span>}
    </div>
  );
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
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)} aria-label={`Workspace: ${name}`}
        className={cx('flex w-full items-center gap-2.5 rounded-xl text-left', compact ? 'justify-center p-1.5' : 'px-2.5 py-2')}
        style={{ background: 'var(--sp-surface)', border: '1px solid var(--sp-border-strong)', font: 'inherit', color: 'inherit', cursor: 'pointer' }}>
        <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full text-[12px] font-bold" style={{ background: '#2b2c55', color: '#c4bcff' }} aria-hidden>{initial}</span>
        {!compact && <><span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{name}</span><ChevronsUpDown size={15} className="sp-faint" aria-hidden /></>}
      </button>
      {open && (
        <div role="listbox" aria-label="Workspaces" className="sp-pop absolute left-0 top-[calc(100%+6px)] z-40 w-[230px] p-1.5">
          <div role="option" aria-selected="true" className="flex items-center gap-2.5 rounded-lg p-2 text-[13.5px]" style={{ background: 'var(--sp-surface-2)' }}>
            <span className="flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold" style={{ background: '#2b2c55', color: '#c4bcff' }}>{initial}</span>
            <span className="flex-1 truncate">{name}</span><Check size={15} style={{ color: 'var(--sp-accent-text)' }} />
          </div>
          <p className="sp-faint px-2 pb-1 pt-2 text-[12px]">Workspaces are managed in CRM settings.</p>
        </div>
      )}
    </div>
  );
}

function Sidebar({ route, go, workspaceName, compact, failedCount, onOpenChannel, activeChannel }: {
  route: Route; go: (r: Route) => void; workspaceName: string; compact: boolean; failedCount: number;
  onOpenChannel: (key: string) => void; activeChannel: string;
}) {
  const { accounts, accountsState } = usePlanner();
  return (
    <nav aria-label="Pulse" className="flex h-full flex-col gap-5 px-3 py-5" style={{ background: 'var(--sp-sidebar)', borderRight: '1px solid var(--sp-border)' }}>
      <div className={cx(compact ? 'flex justify-center' : 'px-2')}><Logo compact={compact} /></div>
      <WorkspaceSelector name={workspaceName} compact={compact} />
      <ul className="space-y-1">
        {NAV.map((n) => (
          <li key={n.id}>
            <button type="button" className={cx('sp-nav-item', compact && 'justify-center px-0')} aria-current={route === n.id || (n.id === 'settings' && route === 'classic') ? 'page' : undefined}
              onClick={() => go(n.id)} title={compact ? n.label : undefined} aria-label={compact ? n.label : undefined}>
              <n.icon size={18} aria-hidden />
              {!compact && n.label}
              {n.id === 'dashboard' && failedCount > 0 && (compact
                ? <span className="absolute right-2 top-2 h-2 w-2 rounded-full" style={{ background: 'var(--sp-danger)' }} aria-label={`${failedCount} failed`} />
                : <span className="sp-badge" style={{ background: 'var(--sp-danger-strong)' }} aria-label={`${failedCount} failed posts`}>{failedCount}</span>)}
            </button>
          </li>
        ))}
      </ul>
      {!compact && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <p className="sp-faint px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.1em]">Connected accounts</p>
          {accountsState.status === 'loading' ? <div className="space-y-2 px-3">{[0, 1].map((i) => <Skeleton key={i} style={{ height: 18 }} />)}</div>
            : accountsState.status === 'error' ? <p className="sp-faint px-3 text-[12.5px]">Couldn’t load accounts.</p>
            : !accounts?.length ? <button type="button" onClick={() => go('accounts')} className="px-3 text-left text-[12.5px]" style={{ background: 'none', border: 0, color: 'var(--sp-accent-text)', cursor: 'pointer', font: 'inherit' }}>Connect an account</button>
            : (
              <ul className="space-y-1">
                {accounts.map((a) => {
                  const key = a.platform ? channelKey(a.platform) : null;
                  const current = route === 'channels' && key === activeChannel;
                  return (
                    <li key={a.id}>
                      <button type="button" disabled={!key} onClick={() => key && onOpenChannel(key)} aria-current={current ? 'page' : undefined}
                        className="flex w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-left text-[12.5px]"
                        style={{ background: current ? 'var(--sp-surface-2)' : 'none', border: 0, font: 'inherit', color: 'inherit', cursor: key ? 'pointer' : 'default' }}>
                        {a.platform ? <PlatformGlyph id={a.platform} size={14} color={PLATFORMS[a.platform].dot} /> : <span className="h-3.5 w-3.5" />}
                        <span className={cx('min-w-0 flex-1 truncate', !current && 'sp-muted')}>{a.handle || a.rawPlatform}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
        </div>
      )}
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
          : range.status === 'error' ? <p className="text-[13px]" style={{ color: '#fca5a5' }}>{range.error}</p>
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
        <span className="relative"><Bell size={18} />{count > 0 && <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full" style={{ background: 'var(--sp-danger-strong)', boxShadow: '0 0 0 2px var(--sp-surface)' }} />}</span>
      </IconButton>
      {open && (
        <div className="sp-pop animate absolute right-0 top-[calc(100%+8px)] z-40 w-[min(340px,calc(100vw-24px))]" role="dialog" aria-label="Notifications">
          <p className="display px-4 pb-1 pt-3 text-[14px] font-semibold">Notifications</p>
          <NotificationList onPick={(p, el) => { setOpen(false); openPreview(p, el, true); }} />
        </div>
      )}
    </div>
  );
}

function Shell(props: PlannerAppProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1280);
  const [route, setRoute] = useState<Route>(props.startInClassic ? 'classic' : props.startInAccounts ? 'accounts' : 'channels');
  const [activeChannel, setActiveChannel] = useState('all');
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

  const newPost = (iso?: string, platforms?: import('./domain/model').PlatformId[]) =>
    setComposer({
      mode: 'create',
      scheduledAt: iso ?? defaultSlot(new Date(), prefs.defaultHour),
      initialPlatforms: platforms,
    });
  const go = (r: Route) => {
    setDrawer(false);
    if (r === 'compose') { newPost(); return; }
    setRoute(r);
  };

  const openChannel = (key: string) => { setDrawer(false); setActiveChannel(key); setRoute('channels'); };
  const sidebar = (compact: boolean) => (
    <Sidebar route={route} go={go} workspaceName={props.workspaceName} compact={compact} failedCount={failedCount}
      onOpenChannel={openChannel} activeChannel={activeChannel} />
  );

  return (
    <PreviewProvider onEdit={(p: PlannerPost) => setComposer({ mode: 'edit', post: p })}>
      <div ref={rootRef} className="flex h-full overflow-hidden rounded-[22px]" style={{ background: 'var(--sp-shell)', border: '1px solid var(--sp-border)' }}>
        {mode !== 'mobile' && <aside className="flex-none" style={{ width: mode === 'desktop' ? 244 : 76 }}>{sidebar(mode === 'tablet')}</aside>}
        {mode === 'mobile' && drawer && (
          <Portal>
            <div className="sp-overlay" style={{ justifyContent: 'flex-start', padding: 0 }} onMouseDown={(e) => { if (e.target === e.currentTarget) setDrawer(false); }}>
              <div className="relative h-full w-[272px] max-w-[85vw]" role="dialog" aria-modal="true" aria-label="Navigation">
                {sidebar(false)}
                <IconButton label="Close navigation" small className="absolute right-2 top-5" onClick={() => setDrawer(false)}><X size={18} /></IconButton>
              </div>
            </div>
          </Portal>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex flex-none items-center gap-3 px-4 py-3.5 sm:px-6" style={{ borderBottom: '1px solid var(--sp-border)' }}>
            {mode === 'mobile' && <IconButton label="Open navigation" small onClick={() => setDrawer(true)}><Menu size={20} /></IconButton>}
            {route === 'classic' && <IconButton label="Back to settings" small onClick={() => setRoute('settings')}><ArrowLeft size={18} /></IconButton>}
            <h1 className="display min-w-0 flex-none truncate text-[18px] font-semibold sm:text-[20px]">{mode === 'mobile' && route === 'calendar' ? 'Calendar' : TITLES[route]}</h1>

            {/* Murmura Segmented View Switcher */}
            {mode !== 'mobile' && (
              <div className="mx-auto flex items-center gap-1 rounded-xl p-1" style={{ background: 'var(--sp-surface)', border: '1px solid var(--sp-border)' }}>
                {(['channels', 'dashboard', 'calendar', 'analytics'] as const).map((r) => {
                  const active = route === r;
                  return (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setRoute(r)}
                      className={cx(
                        'whitespace-nowrap rounded-lg px-3 py-1 text-[12.5px] font-medium transition-all',
                        active
                          ? 'font-semibold shadow-sm'
                          : 'hover:text-[var(--sp-text)]',
                      )}
                      style={{
                        background: active ? 'var(--sp-surface-3)' : 'transparent',
                        color: active ? 'var(--sp-text)' : 'var(--sp-muted)',
                      }}
                    >
                      {r === 'dashboard' ? 'Overview' : r === 'calendar' ? 'Calendar' : TITLES[r]}
                    </button>
                  );
                })}
              </div>
            )}

            <div className="flex items-center gap-2">
              <IconButton label="Search posts" onClick={() => setSearch(true)}><Search size={18} /></IconButton>
              <NotificationsButton />
              {mode === 'mobile'
                ? <IconButton label="New post" onClick={() => newPost()} style={{ background: 'linear-gradient(135deg,#6366f1,#4f46e5)', border: 0 }}><Plus size={18} /></IconButton>
                : <Button variant="primary" icon={<Plus size={16} />} onClick={() => newPost()}>New Post</Button>}
            </div>
          </header>
          {props.notice && !noticeHidden && (
            <div role="status" className="flex flex-none items-center gap-3 px-4 py-2 text-[12.5px] sm:px-6" style={{ background: 'rgba(99,102,241,0.14)', borderBottom: '1px solid var(--sp-border)' }}>
              <span className="min-w-0 flex-1">{props.notice}</span>
              <IconButton label="Hide notice" small onClick={() => setNoticeHidden(true)}><X size={14} /></IconButton>
            </div>
          )}
          <main className={cx('relative min-h-0 flex-1', route === 'channels' ? 'overflow-hidden' : 'overflow-y-auto')} id="sp-main">
            {route === 'channels' && (
              <ChannelsPage
                compact={mode !== 'desktop'}
                selected={activeChannel}
                onSelect={setActiveChannel}
                onCompose={(iso, pl) => newPost(iso, pl)}
                onOpenAccounts={() => setRoute('accounts')}
                onOpenCalendar={() => setRoute('calendar')}
              />
            )}
            {route === 'dashboard' && (
              <OverviewPage
                onOpenCalendar={() => setRoute('calendar')}
                onOpenAccounts={() => setRoute('accounts')}
                onOpenAnalytics={() => setRoute('analytics')}
                onCompose={(iso, pl) => newPost(iso, pl)}
                workspaceName={props.workspaceName}
              />
            )}
            {route === 'calendar' && <CalendarPage onCompose={newPost} view={calView} setView={setCalView} anchor={anchor} setAnchor={setAnchor} />}
            {route === 'analytics' && <AnalyticsPage />}
            {route === 'accounts' && (props.accountsApi
              ? <AccountsPage api={props.accountsApi} onOpenAdvanced={props.renderClassicTools ? () => setRoute('classic') : undefined} />
              : <LegacyAccountsPage onManage={() => setRoute('classic')} />)}
            {route === 'inbox' && <InboxPage onOpenMessaging={props.onOpenMessaging} />}
            {route === 'settings' && <SettingsPage onOpenClassic={() => setRoute('classic')} />}
            {route === 'classic' && (
              <div className="p-3 sm:p-5">
                <div className="overflow-hidden rounded-2xl" style={{ background: '#f8fafc', color: '#0f172a' }}>
                  {props.renderClassicTools ? props.renderClassicTools() : <p className="p-6 text-[13px]">Advanced tools aren’t available here.</p>}
                </div>
              </div>
            )}
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
          normalizeAccount({ id: a.connectionId, platform: c.platform, handle: a.handle || a.name }))).filter((a): a is NonNullable<typeof a> => a !== null);
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
