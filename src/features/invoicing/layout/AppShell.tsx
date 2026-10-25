import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeftRight, BarChart3, Bell, ChevronRight, ChevronsLeft, ChevronsRight, FileText, HelpCircle,
  LayoutDashboard, Menu as MenuIcon, Moon, PiggyBank, Plus, Search, Settings, Users, Wallet, X, Sun,
} from 'lucide-react';
import { formatMoney } from '../domain/money';
import { formatDate } from '../domain/status';
import { useBillingData } from '../state/BillingStore';
import { sectionOf, useNav, type Route, type SectionName } from '../state/navigation';
import { Button, ScopedPortal, cx } from '../ui/primitives';
import { Dialog } from '../ui/overlays';

const NAV: { group: string; items: { id: SectionName; label: string; icon: React.ElementType }[] }[] = [
  { group: 'Main menu', items: [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'transactions', label: 'Transactions', icon: ArrowLeftRight },
    { id: 'wallet', label: 'Wallet', icon: Wallet },
  ] },
  { group: 'Billing', items: [
    { id: 'invoices', label: 'Invoices', icon: FileText },
    { id: 'clients', label: 'Clients', icon: Users },
  ] },
  { group: 'Planning', items: [
    { id: 'budgeting', label: 'Budgeting', icon: PiggyBank },
    { id: 'reports', label: 'Reports', icon: BarChart3 },
  ] },
  { group: 'General', items: [
    { id: 'settings', label: 'Settings', icon: Settings },
  ] },
];

const SECTION_LABEL: Record<SectionName, string> = {
  dashboard: 'Dashboard', transactions: 'Transactions', wallet: 'Wallet', invoices: 'Invoices',
  clients: 'Clients', budgeting: 'Budgeting', reports: 'Reports', settings: 'Settings',
};

export type LayoutMode = 'desktop' | 'tablet' | 'mobile';

function useLayoutMode(ref: React.RefObject<HTMLElement | null>): LayoutMode {
  const [mode, setMode] = useState<LayoutMode>('desktop');
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width;
      setMode(w >= 1180 ? 'desktop' : w >= 720 ? 'tablet' : 'mobile');
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return mode;
}

export function Initials({ name, size = 32 }: { name: string; size?: number }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('');
  return (
    <span aria-hidden className="inline-flex flex-none items-center justify-center rounded-full font-semibold" style={{ width: size, height: size, fontSize: size * 0.38, background: 'var(--inv-primary-tint)', color: 'var(--inv-primary-ink)' }}>
      {initials || '?'}
    </span>
  );
}

export function useTitle(route: Route): { crumbs: { label: string; to?: Route }[]; title: string } {
  const { viewById } = useBillingData();
  const section = sectionOf(route);
  const crumbs: { label: string; to?: Route }[] = [{ label: 'Billing', to: { name: 'dashboard' } }];
  if (section !== 'dashboard') crumbs.push({ label: SECTION_LABEL[section], to: { name: section } as Route });
  let title = SECTION_LABEL[section];
  if (route.name === 'invoice-new') { title = 'Create invoice'; crumbs.push({ label: 'New' }); }
  if (route.name === 'invoice-edit' || route.name === 'invoice-view') {
    const n = viewById.get(route.id)?.invoice.number ?? 'Invoice';
    title = route.name === 'invoice-edit' ? `Edit ${n}` : n;
    crumbs.push({ label: n, to: route.name === 'invoice-edit' ? { name: 'invoice-view', id: route.id } : undefined });
    if (route.name === 'invoice-edit') crumbs.push({ label: 'Edit' });
  }
  if (section === 'dashboard') title = 'Overview';
  return { crumbs, title };
}

// ---------- Global search ----------

function GlobalSearch({ compact }: { compact: boolean }) {
  const { views, data } = useBillingData();
  const { navigate } = useNav();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const listId = 'inv-global-search-list';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) && !t.isContentEditable) {
        e.preventDefault();
        setExpanded(true);
        requestAnimationFrame(() => input.current?.focus());
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return [];
    const inv = views
      .filter((v) => [v.invoice.number, v.invoice.billTo.name, v.invoice.billTo.company].some((s) => s.toLowerCase().includes(term)))
      .slice(0, 6)
      .map((v) => ({ key: v.invoice.id, kind: 'Invoice', label: v.invoice.number, sub: `${v.invoice.billTo.company || v.invoice.billTo.name} · ${formatMoney(v.totals.total, v.invoice.currency)}`, to: { name: 'invoice-view', id: v.invoice.id } as Route }));
    const cl = data.clients
      .filter((c) => [c.name, c.company, c.email].some((s) => s.toLowerCase().includes(term)))
      .slice(0, 4)
      .map((c) => ({ key: c.id, kind: 'Client', label: c.company || c.name, sub: `${c.name} · ${c.email}`, to: { name: 'clients', clientId: c.id } as Route }));
    return [...inv, ...cl];
  }, [q, views, data.clients]);

  const pick = (i: number) => {
    const r = results[i];
    if (!r) return;
    navigate(r.to);
    setQ(''); setOpen(false); setExpanded(false);
  };

  if (compact && !expanded) {
    return <Button variant="ghost" iconOnly icon={<Search size={17} />} aria-label="Search invoices and clients" onClick={() => { setExpanded(true); requestAnimationFrame(() => input.current?.focus()); }} />;
  }

  return (
    <div className={cx('relative', compact ? 'absolute inset-x-3 top-2.5 z-30' : 'w-[280px]')}>
      <Search size={15} className="inv-faint pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" aria-hidden />
      <input
        ref={input}
        type="search"
        role="combobox"
        aria-expanded={open && q.trim() !== ''}
        aria-controls={listId}
        aria-activedescendant={open && results[active] ? `inv-sr-${results[active].key}` : undefined}
        aria-label="Search invoices and clients"
        placeholder="Search invoices, clients"
        className="inv-input"
        style={{ paddingLeft: 34, paddingRight: 40 }}
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(0); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => { setOpen(false); if (compact) setExpanded(false); }, 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          if (e.key === 'Enter') { e.preventDefault(); pick(active); }
          if (e.key === 'Escape') { setQ(''); setOpen(false); input.current?.blur(); }
        }}
      />
      {!compact && <span className="inv-kbd pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2" aria-hidden>/</span>}
      {open && q.trim() !== '' && (
        <div id={listId} role="listbox" className="inv-pop absolute left-0 right-0 top-[calc(100%+6px)] z-40 max-h-[360px] overflow-auto p-1.5">
          {results.length === 0 ? (
            <p className="inv-muted px-3 py-4 text-[13px]">No invoices or clients match “{q.trim()}”.</p>
          ) : results.map((r, i) => (
            <div
              key={r.key}
              id={`inv-sr-${r.key}`}
              role="option"
              aria-selected={i === active}
              data-active={i === active}
              className="inv-menu-item"
              onMouseDown={(e) => { e.preventDefault(); pick(i); }}
              onMouseEnter={() => setActive(i)}
            >
              <span className="w-14 flex-none text-[11px] font-medium inv-faint">{r.kind}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{r.label}</span>
                <span className="inv-muted block truncate text-[12px]">{r.sub}</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- Notifications ----------

function Notifications() {
  const { views, data } = useBillingData();
  const { navigate } = useNav();
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState<Set<string>>(new Set());
  const ref = useRef<HTMLDivElement>(null);

  const items = useMemo(() => {
    const out: { id: string; tone: string; title: string; body: string; to: Route }[] = [];
    for (const v of views) {
      const last = v.invoice.deliveries[v.invoice.deliveries.length - 1];
      if (last && last.result !== 'delivered') {
        out.push({ id: `dl-${last.id}`, tone: 'failed', title: `${v.invoice.number} wasn’t emailed`, body: last.detail, to: { name: 'invoice-view', id: v.invoice.id } });
      }
    }
    for (const p of data.payments.filter((x) => x.status === 'pending')) {
      const inv = views.find((v) => v.invoice.id === p.invoiceId);
      if (inv) out.push({ id: `pp-${p.id}`, tone: 'pending', title: `Payment awaiting confirmation`, body: `${p.amount} ${p.currency} on ${inv.invoice.number}`, to: { name: 'invoice-view', id: inv.invoice.id } });
    }
    views.filter((v) => v.status === 'overdue').sort((a, b) => b.daysOverdue - a.daysOverdue).slice(0, 5).forEach((v) => {
      out.push({ id: `od-${v.invoice.id}`, tone: 'overdue', title: `${v.invoice.number} is ${v.daysOverdue} day${v.daysOverdue === 1 ? '' : 's'} overdue`, body: `${v.invoice.billTo.company || v.invoice.billTo.name} owes ${formatMoney(v.totals.balanceDue, v.invoice.currency)}`, to: { name: 'invoice-view', id: v.invoice.id } });
    });
    views.filter((v) => v.status === 'viewed' && v.invoice.viewedAt).sort((a, b) => (b.invoice.viewedAt! > a.invoice.viewedAt! ? 1 : -1)).slice(0, 3).forEach((v) => {
      out.push({ id: `vw-${v.invoice.id}`, tone: 'viewed', title: `${v.invoice.billTo.company || v.invoice.billTo.name} viewed ${v.invoice.number}`, body: formatDate(v.invoice.viewedAt!.slice(0, 10)), to: { name: 'invoice-view', id: v.invoice.id } });
    });
    return out;
  }, [views, data.payments]);

  const unread = items.filter((i) => !seen.has(i.id)).length;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <Button variant="ghost" iconOnly aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} aria-expanded={open} onClick={() => setOpen((o) => !o)}
        icon={<span className="relative"><Bell size={17} />{unread > 0 && <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full" style={{ background: 'var(--inv-danger)', boxShadow: '0 0 0 2px var(--inv-surface)' }} />}</span>} />
      {open && (
        <div className="inv-pop absolute right-0 top-[calc(100%+6px)] z-40 w-[min(360px,calc(100vw-24px))]" role="dialog" aria-label="Notifications">
          <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--inv-border)' }}>
            <p className="inv-h3">Notifications</p>
            <button type="button" className="text-[12.5px] font-semibold" style={{ color: 'var(--inv-primary)', background: 'none', border: 0, cursor: 'pointer' }} onClick={() => setSeen(new Set(items.map((i) => i.id)))} disabled={unread === 0}>Mark all as read</button>
          </div>
          <ul className="max-h-[380px] overflow-auto p-1.5">
            {items.length === 0 && <li className="inv-muted px-3 py-6 text-center text-[13px]">You’re all caught up.</li>}
            {items.map((n) => (
              <li key={n.id}>
                <button type="button" className="inv-menu-item items-start" onClick={() => { setSeen((s) => new Set(s).add(n.id)); setOpen(false); navigate(n.to); }}>
                  <span className="mt-1.5 h-2 w-2 flex-none rounded-full" style={{ background: seen.has(n.id) ? 'transparent' : n.tone === 'overdue' || n.tone === 'failed' ? 'var(--inv-danger)' : n.tone === 'pending' ? 'var(--inv-warning)' : 'var(--inv-primary)' }} aria-hidden />
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium">{n.title}</span>
                    <span className="inv-muted block text-[12px]">{n.body}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ---------- Sidebar ----------

function Sidebar({ collapsed, onToggleCollapse, theme, onToggleTheme, onNavigate, showCollapse, onHelp }: {
  collapsed: boolean; onToggleCollapse?: () => void; theme: 'light' | 'dark'; onToggleTheme: () => void;
  onNavigate?: () => void; showCollapse: boolean; onHelp: () => void;
}) {
  const { route, navigate } = useNav();
  const { repo } = useBillingData();
  const current = sectionOf(route);
  const go = (id: SectionName) => { navigate({ name: id } as Route); onNavigate?.(); };

  return (
    <nav aria-label="Billing" className="flex h-full flex-col" style={{ background: 'var(--inv-surface)', borderRight: '1px solid var(--inv-border)' }}>
      <div className={cx('flex h-16 flex-none items-center gap-2.5', collapsed ? 'justify-center px-2' : 'px-5')}>
        <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden>
          <rect width="28" height="28" rx="8" fill="var(--inv-primary)" />
          <path d="M9 8.5h7.2a3.3 3.3 0 0 1 0 6.6H11.6a3.3 3.3 0 0 0 0 6.6H19" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
        {!collapsed && <span className="text-[16px] font-semibold tracking-tight">Obsidian <span className="inv-faint font-medium">Billing</span></span>}
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-3">
        {NAV.map((g) => (
          <div key={g.group}>
            {collapsed ? <div className="mx-3 my-3 h-px" style={{ background: 'var(--inv-border)' }} /> : <p className="inv-nav-label">{g.group}</p>}
            <ul className="space-y-0.5">
              {g.items.map((it) => (
                <li key={it.id}>
                  <button type="button" className={cx('inv-nav-item', collapsed && 'justify-center px-0')} aria-current={current === it.id ? 'page' : undefined} onClick={() => go(it.id)} title={collapsed ? it.label : undefined} aria-label={collapsed ? it.label : undefined}>
                    <it.icon size={17} aria-hidden />
                    {!collapsed && it.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <ul className="mt-0.5 space-y-0.5">
          <li>
            <button type="button" className={cx('inv-nav-item', collapsed && 'justify-center px-0')} onClick={onHelp} title={collapsed ? 'Help and support' : undefined} aria-label={collapsed ? 'Help and support' : undefined}>
              <HelpCircle size={17} aria-hidden />{!collapsed && 'Help and support'}
            </button>
          </li>
          <li>
            <button type="button" role="switch" aria-checked={theme === 'dark'} className={cx('inv-nav-item', collapsed && 'justify-center px-0')} onClick={onToggleTheme} title={collapsed ? 'Dark mode' : undefined} aria-label={collapsed ? 'Dark mode' : undefined}>
              {theme === 'dark' ? <Sun size={17} aria-hidden /> : <Moon size={17} aria-hidden />}
              {!collapsed && <>
                <span className="flex-1">Dark mode</span>
                <span aria-hidden className="relative inline-block h-[18px] w-8 rounded-full transition-colors" style={{ background: theme === 'dark' ? 'var(--inv-primary)' : 'var(--inv-border-strong)' }}>
                  <span className="absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white transition-all" style={{ left: theme === 'dark' ? 16 : 2 }} />
                </span>
              </>}
            </button>
          </li>
        </ul>
      </div>

      <div className="flex-none p-3" style={{ borderTop: '1px solid var(--inv-border)' }}>
        <div className={cx('flex items-center gap-2.5 rounded-xl p-2', collapsed && 'justify-center')} style={{ background: collapsed ? undefined : 'var(--inv-surface-2)' }}>
          <Initials name={repo.user.name} size={34} />
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold">{repo.user.name}</p>
              <p className="inv-faint truncate text-[12px] capitalize">{repo.user.role}</p>
            </div>
          )}
        </div>
        {showCollapse && (
          <button type="button" className={cx('inv-nav-item mt-1.5 h-8 text-[12.5px]', collapsed && 'justify-center px-0')} onClick={onToggleCollapse} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            {collapsed ? <ChevronsRight size={16} /> : <><ChevronsLeft size={16} /> Collapse</>}
          </button>
        )}
      </div>
    </nav>
  );
}

// ---------- Help ----------

function HelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="Help and support" width={560} footer={<Button variant="primary" onClick={onClose}>Done</Button>}>
      <div className="space-y-4 text-[13.5px]">
        <div>
          <p className="inv-h3">How totals are calculated</p>
          <ol className="inv-muted mt-1.5 list-decimal space-y-1 pl-5">
            <li>Each line: quantity × unit price, rounded to the cent.</li>
            <li>Discounts come off the subtotal before tax, shared across lines in proportion to their amount.</li>
            <li>Tax is calculated per line on its discounted amount, then added up.</li>
            <li>Additional fees are added after tax and aren’t taxed.</li>
            <li>Only confirmed payments reduce the balance due.</li>
          </ol>
        </div>
        <div>
          <p className="inv-h3">Invoice statuses</p>
          <p className="inv-muted mt-1">An invoice becomes <b>Overdue</b> automatically when its due date passes with a balance left. Sending an invoice never marks it paid; record payments as they arrive.</p>
        </div>
        <div>
          <p className="inv-h3">Keyboard shortcuts</p>
          <p className="inv-muted mt-1"><span className="inv-kbd">/</span> search invoices and clients</p>
        </div>
        <p className="inv-muted">Need a hand? Email <a href="mailto:support@obsidian.studio" style={{ color: 'var(--inv-primary)' }}>support@obsidian.studio</a>.</p>
      </div>
    </Dialog>
  );
}

// ---------- Shell ----------

export function AppShell({ children, theme, onToggleTheme, headerActions }: {
  children: React.ReactNode; theme: 'light' | 'dark'; onToggleTheme: () => void; headerActions?: React.ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const mode = useLayoutMode(rootRef);
  const { route, navigate } = useNav();
  const { repo } = useBillingData();
  const { crumbs, title } = useTitle(route);
  const [collapsedPref, setCollapsedPref] = useState<boolean | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [help, setHelp] = useState(false);
  const [bannerHidden, setBannerHidden] = useState(false);
  const collapsed = mode === 'tablet' ? (collapsedPref ?? true) : mode === 'desktop' ? (collapsedPref ?? false) : false;

  useEffect(() => { setDrawer(false); }, [route]);

  return (
    <div ref={rootRef} className="flex h-full min-h-[640px] w-full overflow-hidden rounded-2xl" style={{ border: '1px solid var(--inv-border)' }}>
      {mode !== 'mobile' && (
        <aside className="flex-none transition-[width] duration-150" style={{ width: collapsed ? 72 : 248 }}>
          <Sidebar collapsed={collapsed} showCollapse onToggleCollapse={() => setCollapsedPref(!collapsed)} theme={theme} onToggleTheme={onToggleTheme} onHelp={() => setHelp(true)} />
        </aside>
      )}
      {mode === 'mobile' && drawer && (
        <ScopedPortal>
          <div className="inv-overlay" style={{ justifyContent: 'flex-start', padding: 0 }} onMouseDown={(e) => { if (e.target === e.currentTarget) setDrawer(false); }}>
            <div className="h-full w-[280px] max-w-[85vw]" role="dialog" aria-modal="true" aria-label="Navigation">
              <Sidebar collapsed={false} showCollapse={false} theme={theme} onToggleTheme={onToggleTheme} onNavigate={() => setDrawer(false)} onHelp={() => { setDrawer(false); setHelp(true); }} />
            </div>
            <Button variant="secondary" iconOnly icon={<X size={16} />} aria-label="Close navigation" className="absolute right-3 top-3" onClick={() => setDrawer(false)} />
          </div>
        </ScopedPortal>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="relative flex flex-none items-center gap-3 px-4 py-3 sm:px-6" style={{ background: 'var(--inv-surface)', borderBottom: '1px solid var(--inv-border)', minHeight: 64 }}>
          {mode === 'mobile' && <Button variant="ghost" iconOnly icon={<MenuIcon size={18} />} aria-label="Open navigation" onClick={() => setDrawer(true)} />}
          <div className="min-w-0 flex-1">
            <ol aria-label="Breadcrumb" className="inv-faint flex items-center gap-1 text-[12px]">
              {crumbs.map((c, i) => (
                <li key={i} className="flex min-w-0 items-center gap-1">
                  {i > 0 && <ChevronRight size={12} aria-hidden />}
                  {c.to && i < crumbs.length - 1 ? (
                    <button type="button" className="truncate hover:underline" style={{ background: 'none', border: 0, padding: 0, color: 'inherit', font: 'inherit', cursor: 'pointer' }} onClick={() => navigate(c.to!)}>{c.label}</button>
                  ) : <span aria-current={i === crumbs.length - 1 ? 'page' : undefined} className="truncate">{c.label}</span>}
                </li>
              ))}
            </ol>
            <h1 className="inv-h1 truncate">{title}</h1>
          </div>
          <GlobalSearch compact={mode !== 'desktop'} />
          <Notifications />
          {mode === 'desktop' && (
            <div className="flex items-center gap-2.5 pl-1 pr-1">
              <Initials name={repo.user.name} size={34} />
              <div className="leading-tight">
                <p className="text-[13px] font-semibold">{repo.user.name}</p>
                <p className="inv-faint text-[12px] capitalize">{repo.user.role}</p>
              </div>
            </div>
          )}
          {headerActions}
          {route.name !== 'invoice-new' && route.name !== 'invoice-edit' && (
            <Button variant="primary" icon={<Plus size={16} />} iconOnly={mode === 'mobile'} aria-label={mode === 'mobile' ? 'Create invoice' : undefined} onClick={() => navigate({ name: 'invoice-new' })}>Create invoice</Button>
          )}
        </header>

        {repo.mode === 'local' && !bannerHidden && (
          <div className="flex flex-none items-center gap-3 px-4 py-2 text-[12.5px] sm:px-6" style={{ background: 'var(--inv-warning-tint)', color: 'var(--inv-text)', borderBottom: '1px solid var(--inv-border)' }} role="status">
            <span className="font-semibold" style={{ color: 'var(--inv-warning)' }}>Prototype mode</span>
            <span className="min-w-0 flex-1 truncate">{repo.modeReason} Sample data only. Emails can’t be sent.</span>
            <button type="button" aria-label="Hide prototype notice" className="inv-faint" style={{ background: 'none', border: 0, cursor: 'pointer' }} onClick={() => setBannerHidden(true)}><X size={14} /></button>
          </div>
        )}

        <main id="inv-main" className="@container min-h-0 flex-1 overflow-y-auto" style={{ background: 'var(--inv-bg)' }}>
          {children}
        </main>
      </div>
      <HelpDialog open={help} onClose={() => setHelp(false)} />
    </div>
  );
}
