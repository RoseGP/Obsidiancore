/**
 * Channels: the social accounts the planner publishes to.
 * Connection flow (popup / redirect / credentials / workspace consent) talks to /api/accounts.
 */
import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Clock, Copy, ExternalLink, Layers, Link2Off, Loader2, Plug, Plus, RefreshCw, RotateCw, ShieldCheck, Users, Wrench, X } from 'lucide-react';
import type { AccountsApi } from '../../social-accounts/client/accountsApi';
import { AccountsApiError } from '../../social-accounts/client/accountsApi';
import type { AccountPlatform, AccountProfile, AccountsOverview, CardStatus, ConnectNext, PlatformCard } from '../../social-accounts/shared/types';
import { PLATFORMS } from '../domain/model';
import { usePlanner } from '../state/PlannerStore';
import { Banner, Button, Dialog, EmptyState, ErrorState, IconButton, Menu, PlatformLogo, SearchField, SectionHeader, Skeleton, cx, useToast, type MenuEntry } from '../ui/kit';

const STATUS: Record<CardStatus, { label: string; cls: string }> = {
  connected: { label: 'Connected', cls: 'sp-status-published' },
  not_connected: { label: 'Disconnected', cls: 'sp-status-draft' },
  expired: { label: 'Expired', cls: 'sp-status-failed' },
  needs_attention: { label: 'Needs attention', cls: 'sp-status-publishing' },
};

const RETURN_REASONS: Record<string, string> = {
  invalid_state: 'The authorization link was invalid or expired. Start again.',
  state_mismatch: 'The authorization didn’t match this browser session. Start again from this page.',
  expired: 'The authorization took too long or was already used. Start again.',
  missing_code: 'Postiz didn’t return an authorization code.',
  token_exchange: 'Postiz didn’t accept the authorization. Try again, or ask an admin to check the Postiz app settings.',
};

/** Per-card operation state machine. */
type Op =
  | { kind: 'idle' }
  | { kind: 'starting'; connectionId?: string }
  | { kind: 'waiting'; attemptId: string; url: string; popup: Window | null; reconnect: boolean }
  | { kind: 'finishing' }
  | { kind: 'error'; message: string };

/** Profile picture (or initial) with the platform's logo as a corner badge. */
function AccountAvatar({ account, platform, size = 44 }: { account: AccountProfile; platform: AccountPlatform; size?: number }) {
  const [broken, setBroken] = useState(false);
  const badge = Math.round(size * 0.45);
  return (
    <span className="relative flex-none" style={{ width: size, height: size }}>
      {account.pictureUrl && !broken
        ? <img src={account.pictureUrl} alt="" className="h-full w-full rounded-full object-cover" style={{ border: '1px solid var(--sp-border)' }} onError={() => setBroken(true)} referrerPolicy="no-referrer" />
        : (
          <span className="flex h-full w-full items-center justify-center rounded-full font-semibold" style={{ background: 'var(--sp-surface-2)', color: 'var(--sp-muted)', border: '1px solid var(--sp-border)', fontSize: size * 0.38 }} aria-hidden>
            {account.name.trim().charAt(0).toUpperCase() || '?'}
          </span>
        )}
      <PlatformLogo id={platform} size={badge} className="sp-avatar-ring absolute" style={{ right: -3, bottom: -3, borderRadius: 999 }} />
    </span>
  );
}

/** Connection status badge: Connected · Disconnected · Expired · Needs attention. */
export function ConnectionBadge({ status }: { status: CardStatus }) {
  const s = STATUS[status];
  return <span className={`sp-status ${s.cls}`}><span className="sp-dot" aria-hidden />{s.label}</span>;
}

const fmtDate = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(d);
};

function relativeTime(iso?: string): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 45) return 'Just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return fmtDate(iso);
}

type StatusFilter = 'all' | 'connected' | 'attention' | 'disconnected';
const isProblem = (s: CardStatus) => s === 'expired' || s === 'needs_attention';

function useCleanReturnParams(handler: (p: URLSearchParams) => void) {
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    const p = new URLSearchParams(window.location.search);
    if (!p.has('sa')) return;
    handler(p);
    for (const k of ['sa', 'sa_reason', 'sa_resume', 'sa_attempt', 'view']) p.delete(k);
    const q = p.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${q ? `?${q}` : ''}${window.location.hash}`);
  }, [handler]);
}

export function AccountsPage({ api, onOpenAdvanced }: { api: AccountsApi; onOpenAdvanced?: () => void }) {
  const toast = useToast();
  const { reloadAccounts } = usePlanner();
  const [data, setData] = useState<AccountsOverview | null>(null);
  const [loadState, setLoadState] = useState<{ status: 'loading' | 'ready' | 'error'; error?: string; code?: string }>({ status: 'loading' });
  const [ops, setOps] = useState<Partial<Record<AccountPlatform, Op>>>({});
  const [resume, setResume] = useState<AccountPlatform | null>(null);
  const [consent, setConsent] = useState<{ platform: AccountPlatform; url: string } | null>(null);
  const [direct, setDirect] = useState<{ platform: AccountPlatform; fields: Extract<ConnectNext, { next: 'credentials' }>['fields']; reconnectId?: string } | null>(null);
  const [disconnecting, setDisconnecting] = useState<{ platform: AccountPlatform; account: AccountProfile; method: 'postiz' | 'direct' } | null>(null);
  const [busyDisconnect, setBusyDisconnect] = useState(false);
  const timers = useRef(new Map<AccountPlatform, number[]>());

  const setOp = (p: AccountPlatform, op: Op) => setOps((s) => ({ ...s, [p]: op }));

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoadState({ status: 'loading' });
    try {
      const o = await api.overview();
      setData(o);
      setLoadState({ status: 'ready' });
      reloadAccounts();
    } catch (err: any) {
      setLoadState({ status: 'error', error: err?.message, code: err?.code });
    }
  }, [api, reloadAccounts]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => () => { for (const ids of timers.current.values()) ids.forEach((id) => clearInterval(id)); }, []);

  // Results of full-page redirects back to the app.
  useCleanReturnParams(useCallback((p: URLSearchParams) => {
    const sa = p.get('sa');
    if (sa === 'workspace_connected') {
      toast({ tone: 'success', title: 'Postiz workspace connected', body: 'You can now connect social accounts.' });
      const r = p.get('sa_resume');
      if (r && r in PLATFORMS) setResume(r as AccountPlatform);
    } else if (sa === 'workspace_cancelled') {
      toast({ tone: 'info', title: 'Authorization cancelled', body: 'Nothing was connected.' });
    } else if (sa === 'channel_returned') {
      const attempt = p.get('sa_attempt');
      if (attempt) {
        api.check(attempt, true).then((r) => {
          if (r.status === 'completed') toast({ tone: 'success', title: 'Account connected', body: r.account?.name });
          else if (r.status === 'cancelled') toast({ tone: 'info', title: 'Connection cancelled', body: r.detail });
          else toast({ tone: 'error', title: 'Account not connected', body: r.detail });
          void load(true);
        }).catch((err) => toast({ tone: 'error', title: 'Couldn’t confirm the connection', body: err?.message }));
      }
    } else if (sa === 'error') {
      toast({ tone: 'error', title: 'Connection didn’t complete', body: RETURN_REASONS[p.get('sa_reason') || ''] || 'Start again from this page.' });
    }
  }, [api, load, toast]));

  const stopPolling = (p: AccountPlatform) => {
    (timers.current.get(p) ?? []).forEach((id) => clearInterval(id));
    timers.current.delete(p);
  };

  const finish = useCallback(async (p: AccountPlatform, attemptId: string, popup: Window | null, reconnect: boolean, final: boolean) => {
    try {
      const r = await api.check(attemptId, final);
      if (r.status === 'pending') return false;
      stopPolling(p);
      try { popup?.close(); } catch { /* cross-origin close is allowed for windows we opened */ }
      if (r.status === 'completed') {
        toast({ tone: 'success', title: reconnect ? `${PLATFORMS[p].label} reconnected` : `${PLATFORMS[p].label} connected`, body: r.account?.name });
        setOp(p, { kind: 'idle' });
      } else if (r.status === 'cancelled') {
        toast({ tone: 'info', title: 'Connection cancelled', body: r.detail });
        setOp(p, { kind: 'idle' });
      } else {
        setOp(p, { kind: 'error', message: r.detail || 'The connection didn’t complete.' });
        toast({ tone: 'error', title: `${PLATFORMS[p].label} not connected`, body: r.detail });
      }
      void load(true);
      return true;
    } catch (err: any) {
      if (final) { stopPolling(p); setOp(p, { kind: 'error', message: err?.message || 'Couldn’t confirm the connection.' }); }
      return final;
    }
  }, [api, load, toast]);

  const startPopupWatch = (p: AccountPlatform, attemptId: string, popup: Window | null, reconnect: boolean) => {
    stopPolling(p);
    const ids: number[] = [];
    // New channels are detected while the window is still open; reconnects are confirmed when it closes.
    if (!reconnect) ids.push(window.setInterval(() => { void finish(p, attemptId, popup, reconnect, false); }, 2500));
    if (popup) {
      ids.push(window.setInterval(() => {
        if (popup.closed) { stopPolling(p); setOp(p, { kind: 'finishing' }); void finish(p, attemptId, null, reconnect, true); }
      }, 600));
    }
    timers.current.set(p, ids);
  };

  const connect = async (card: PlatformCard, reconnectId?: string) => {
    const p = card.platform;
    // Open the window inside the click so pop-up blockers allow it; we navigate it once the URL arrives.
    let popup: Window | null = null;
    if (card.method === 'postiz' && !data?.postiz.returnsToApp) {
      popup = window.open('', `sa_${p}`, 'popup,width=620,height=780');
      if (popup) {
        try {
          popup.document.title = `Connect ${card.label}`;
          popup.document.body.style.cssText = 'margin:0;font:15px system-ui;background:#f5f5f3;color:#1d1c1b;display:flex;align-items:center;justify-content:center;height:100vh';
          popup.document.body.textContent = `Opening ${card.label}…`;
        } catch { /* ignore */ }
      }
    }
    setOp(p, { kind: 'starting', connectionId: reconnectId });
    try {
      const next = await api.connect(p, reconnectId);
      if (next.next === 'credentials') { popup?.close(); setDirect({ platform: p, fields: next.fields, reconnectId }); setOp(p, { kind: 'idle' }); return; }
      if (next.next === 'authorize_workspace') { popup?.close(); setConsent({ platform: p, url: next.url }); setOp(p, { kind: 'idle' }); return; }
      if (next.next === 'redirect') { popup?.close(); window.location.assign(next.url); return; }
      // popup
      if (popup && !popup.closed) {
        popup.location.href = next.url;
      } else {
        popup = window.open(next.url, `sa_${p}`, 'popup,width=620,height=780');
      }
      setOp(p, { kind: 'waiting', attemptId: next.attemptId, url: next.url, popup, reconnect: !!reconnectId });
      startPopupWatch(p, next.attemptId, popup, !!reconnectId);
    } catch (err: any) {
      try { popup?.close(); } catch { /* */ }
      const message = err instanceof AccountsApiError ? err.message : 'The connection couldn’t be started.';
      setOp(p, { kind: 'error', message });
      toast({ tone: 'error', title: `Couldn’t connect ${card.label}`, body: message });
    }
  };

  const cancel = async (p: AccountPlatform, op: Extract<Op, { kind: 'waiting' }>) => {
    stopPolling(p);
    try { op.popup?.close(); } catch { /* */ }
    try { await api.cancel(op.attemptId); } catch { /* still idle locally */ }
    setOp(p, { kind: 'idle' });
    toast({ tone: 'info', title: 'Connection cancelled' });
  };

  const doDisconnect = async () => {
    if (!disconnecting) return;
    setBusyDisconnect(true);
    try {
      await api.disconnect(disconnecting.account.connectionId);
      toast({ tone: 'success', title: `${PLATFORMS[disconnecting.platform].label} disconnected`, body: disconnecting.account.name });
      setDisconnecting(null);
      void load(true);
    } catch (err: any) {
      toast({ tone: 'error', title: 'Account not disconnected', body: err?.message });
    } finally { setBusyDisconnect(false); }
  };

  // ---------- Derived view state ----------

  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [platformFilter, setPlatformFilter] = useState<AccountPlatform | 'all'>('all');
  const [picker, setPicker] = useState(false);

  const platforms = data?.platforms ?? [];
  const rows = useMemo(() => platforms.flatMap((card) => card.accounts.map((account) => ({ card, account }))), [platforms]);
  const unconnected = useMemo(() => platforms.filter((c) => c.accounts.length === 0), [platforms]);
  const counts = {
    all: rows.length + unconnected.length,
    connected: rows.filter((r) => r.card.status === 'connected').length,
    attention: rows.filter((r) => isProblem(r.card.status)).length + unconnected.filter((c) => isProblem(c.status)).length,
    disconnected: unconnected.length,
  };
  const term = query.trim().toLowerCase();
  const matchesCard = (c: PlatformCard) => (platformFilter === 'all' || c.platform === platformFilter);
  const shownRows = rows.filter(({ card, account }) => matchesCard(card)
    && (statusFilter === 'all' || (statusFilter === 'connected' && card.status === 'connected') || (statusFilter === 'attention' && isProblem(card.status)))
    && (!term || [account.name, account.handle, card.label].some((v) => v?.toLowerCase().includes(term))));
  const shownUnconnected = unconnected.filter((c) => matchesCard(c)
    && (statusFilter === 'all' || statusFilter === 'disconnected' || (statusFilter === 'attention' && isProblem(c.status)))
    && (!term || c.label.toLowerCase().includes(term)));
  const activeOps = platforms.filter((c) => { const k = ops[c.platform]?.kind; return k === 'waiting' || k === 'finishing' || k === 'error'; });
  const filtered = !!term || statusFilter !== 'all' || platformFilter !== 'all';
  const clearFilters = () => { setQuery(''); setStatusFilter('all'); setPlatformFilter('all'); };
  const refreshing = loadState.status === 'loading' && !!data;

  const header = (
    <SectionHeader id="sp-channels-title" title="Channels"
      description="Connect the social accounts you publish to and keep every connection healthy."
      actions={<>
        <IconButton label="Refresh status" onClick={() => void load(true)} disabled={loadState.status === 'loading'}>
          <RefreshCw size={16} className={refreshing ? 'sp-spin' : undefined} />
        </IconButton>
        <Button variant="primary" icon={<Plus size={16} />} onClick={() => setPicker(true)} disabled={!data}>Connect account</Button>
      </>} />
  );

  // ---------- Render ----------

  if (loadState.status === 'error' && !data) {
    return (
      <div className="space-y-5 p-4 sm:p-6">
        {header}
        <div className="sp-card">
          <ErrorState
            title={loadState.code === 'unauthorized' ? 'Sign in to manage channels' : 'Channels couldn’t load'}
            message={loadState.code === 'unauthorized' ? 'Your session couldn’t be verified by the server. Sign in again, then reload this page.' : loadState.error}
            onRetry={() => void load()}
          />
        </div>
      </div>
    );
  }

  const pz = data?.postiz;
  const accountMenu = (card: PlatformCard, a: AccountProfile, busy: boolean): MenuEntry[] => [
    { label: 'Reconnect', icon: <RotateCw size={15} />, disabled: busy || !card.available, onSelect: () => void connect(card, a.connectionId) },
    ...(card.method === 'postiz' ? [{ label: `Add another ${card.label} account`, icon: <Plus size={15} />, disabled: busy || !card.available, onSelect: () => void connect(card) }] : []),
    ...(a.handle ? [{
      label: 'Copy username', icon: <Copy size={15} />,
      onSelect: () => { navigator.clipboard?.writeText(a.handle!).then(() => toast({ tone: 'success', title: 'Username copied' }), () => toast({ tone: 'error', title: 'Couldn’t copy' })); },
    }] : []),
    { label: 'Refresh status', icon: <RefreshCw size={15} />, onSelect: () => void load(true) },
    'separator',
    { label: 'Disconnect', icon: <Link2Off size={15} />, danger: true, disabled: busy, onSelect: () => setDisconnecting({ platform: card.platform, account: a, method: card.method }) },
  ];

  return (
    <div className="space-y-6 p-4 sm:p-6" aria-labelledby="sp-channels-title">
      {header}

      {(pz?.mode === 'none' || pz?.problem || resume) && (
        <div className="space-y-2.5">
          {pz?.mode === 'none' && (
            <Banner tone="warning"><b>Postiz isn’t configured on the server.</b> <span className="sp-muted">Set POSTIZ_CLIENT_ID and POSTIZ_CLIENT_SECRET (or POSTIZ_API_KEY) to connect Instagram, Facebook, LinkedIn, X, TikTok and Mastodon.</span></Banner>
          )}
          {pz?.problem && <Banner tone={pz.problem.status === 'expired' ? 'danger' : 'warning'}>{pz.problem.detail}</Banner>}
          {resume && (
            <Banner tone="info" action={<Button size="sm" variant="primary" onClick={() => { const c = data?.platforms.find((x) => x.platform === resume); setResume(null); if (c) void connect(c); }}>Continue</Button>}>
              Continue connecting <b>{PLATFORMS[resume].label}</b>.
            </Banner>
          )}
        </div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryTile icon={<Users size={16} />} label="Connected accounts" value={data ? String(rows.length) : null} hint={data ? `${counts.connected} active` : ''} />
        <SummaryTile icon={<Layers size={16} />} label="Platforms in use" value={data ? `${platforms.length - unconnected.length}` : null} hint={data ? `of ${platforms.length} available` : ''} />
        <SummaryTile icon={<AlertTriangle size={16} />} label="Need attention" value={data ? String(counts.attention) : null} hint={!data ? '' : counts.attention ? 'Reconnect to keep publishing' : 'All connections healthy'} tone={counts.attention ? 'danger' : undefined} />
        <SummaryTile icon={<Clock size={16} />} label="Last checked" value={data ? relativeTime(data.checkedAt) : null} hint={!data ? '' : pz && pz.mode !== 'none'
          ? (pz.mode === 'api_key' ? 'Team Postiz workspace' : pz.workspaceAuthorized ? `Postiz${pz.workspaceName ? ` · ${pz.workspaceName}` : ''} authorized` : 'Postiz not yet authorized')
          : 'Connection status'} />
      </div>

      {/* In-flight connections */}
      {activeOps.length > 0 && (
        <div className="space-y-2.5" aria-live="polite">
          {activeOps.map((card) => {
            const op = ops[card.platform]!;
            return (
              <div key={card.platform} className="sp-card flex flex-wrap items-center gap-3 p-3.5" style={op.kind === 'error' ? { borderColor: 'color-mix(in srgb, var(--sp-danger) 35%, var(--sp-border))' } : { borderColor: 'color-mix(in srgb, var(--sp-accent) 35%, var(--sp-border))' }}>
                <PlatformLogo id={card.platform} size={32} />
                <div className="min-w-0 flex-1">
                  {op.kind === 'waiting' && <>
                    <p className="flex items-center gap-2 text-[13.5px] font-semibold"><Loader2 size={14} className="sp-spin" aria-hidden />Waiting for {card.label}…</p>
                    <p className="sp-muted text-[12.5px]">{op.popup ? 'Finish in the pop-up window. It closes automatically when the account is connected.' : 'Your browser blocked the pop-up. Open the authorization page, then come back here.'}</p>
                  </>}
                  {op.kind === 'finishing' && <p className="sp-muted flex items-center gap-2 text-[13.5px]"><Loader2 size={14} className="sp-spin" aria-hidden />Checking the {card.label} connection…</p>}
                  {op.kind === 'error' && <>
                    <p className="text-[13.5px] font-semibold">{card.label} wasn’t connected</p>
                    <p role="alert" className="sp-danger-text text-[12.5px]">{op.message}</p>
                  </>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {op.kind === 'waiting' && <>
                    {!op.popup && <a className="sp-btn sp-btn-secondary sp-btn-sm" href={op.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} />Open authorization</a>}
                    {op.popup && <Button size="sm" variant="ghost" onClick={() => { try { op.popup!.focus(); } catch { /* */ } }}>Show window</Button>}
                    <Button size="sm" variant="secondary" onClick={() => { stopPolling(card.platform); setOp(card.platform, { kind: 'finishing' }); void finish(card.platform, op.attemptId, op.popup, op.reconnect, true); }}>I’ve finished</Button>
                    <Button size="sm" variant="ghost" onClick={() => void cancel(card.platform, op)}>Cancel</Button>
                  </>}
                  {op.kind === 'error' && <>
                    <Button size="sm" variant="secondary" icon={<RotateCw size={14} />} disabled={!card.available} onClick={() => void connect(card)}>Try again</Button>
                    <IconButton small label="Dismiss" onClick={() => setOp(card.platform, { kind: 'idle' })}><X size={15} /></IconButton>
                  </>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div role="tablist" aria-label="Filter by status" className="sp-tabs rounded-[10px] p-1" style={{ background: 'var(--sp-surface-2)', border: '1px solid var(--sp-border)' }}>
          {([['all', 'All'], ['connected', 'Connected'], ['attention', 'Needs attention'], ['disconnected', 'Not connected']] as [StatusFilter, string][]).map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={statusFilter === id} className="sp-tab" onClick={() => setStatusFilter(id)} style={{ height: 30 }}>
              {label}{data && <span className={cx('sp-count', id === 'attention' && counts.attention > 0 && 'is-danger')}>{counts[id]}</span>}
            </button>
          ))}
        </div>
        <div className="flex flex-1 flex-wrap items-center gap-2 lg:justify-end">
          <SearchField className="min-w-[180px] flex-1 lg:max-w-[280px]" value={query} onChange={setQuery} placeholder="Search accounts" label="Search accounts" />
          <select className="sp-input" style={{ width: 'auto', minWidth: 150 }} aria-label="Filter by platform" value={platformFilter} onChange={(e) => setPlatformFilter(e.target.value as AccountPlatform | 'all')}>
            <option value="all">All platforms</option>
            {platforms.map((c) => <option key={c.platform} value={c.platform}>{platformName(c)}</option>)}
          </select>
        </div>
      </div>

      {/* Connected accounts */}
      {statusFilter !== 'disconnected' && (
        <section aria-labelledby="sp-connected-h" className="space-y-3">
          <SubHeading id="sp-connected-h" title="Connected accounts" count={data ? shownRows.length : undefined} />
          {!data ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 3 }).map((_, i) => <AccountCardSkeleton key={i} />)}</div>
          ) : shownRows.length === 0 ? (
            rows.length === 0 && !filtered
              ? <div className="sp-card sp-card-dashed"><EmptyState icon={<Plug size={20} />} title="No channels connected yet" body="Connect Instagram, Facebook, LinkedIn and more to schedule and publish from one place." action={<Button variant="primary" icon={<Plus size={16} />} onClick={() => setPicker(true)}>Connect your first account</Button>} /></div>
              : <div className="sp-card sp-card-dashed"><EmptyState title="No accounts match" body="Try a different search or filter." action={<Button variant="secondary" onClick={clearFilters}>Clear filters</Button>} /></div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {shownRows.map(({ card, account: a }) => {
                const op = ops[card.platform] ?? { kind: 'idle' as const };
                const busy = op.kind === 'starting' || op.kind === 'waiting' || op.kind === 'finishing';
                const problem = isProblem(card.status);
                return (
                  <article key={a.connectionId} className="sp-card sp-card-interactive flex flex-col" aria-label={`${a.name} on ${card.label}`} aria-busy={busy}>
                    <div className="flex items-start gap-3 p-4 pb-3">
                      <AccountAvatar account={a} platform={card.platform} />
                      <div className="min-w-0 flex-1 pt-0.5">
                        <p className="truncate text-[14.5px] font-semibold leading-snug">{a.name}</p>
                        <p className="sp-muted truncate text-[12.5px]">{a.handle ? (a.handle.startsWith('@') ? a.handle : `@${a.handle}`) : platformName(card)}</p>
                      </div>
                      <Menu label={`Actions for ${a.name}`} items={accountMenu(card, a, busy)} />
                    </div>
                    <dl className="mx-4 mb-3.5 grid grid-cols-3 rounded-lg text-[12.5px]" style={{ background: 'var(--sp-surface-2)' }}>
                      {[['Platform', platformName(card)], ['Since', fmtDate(a.connectedAt) || '—'], ['Publishing', PLATFORMS[card.platform].autoPublish ? 'Auto' : 'Scheduled']].map(([k, v], i) => (
                        <div key={k} className="min-w-0 px-3 py-2" style={i ? { borderLeft: '1px solid var(--sp-border)' } : undefined}>
                          <dt className="sp-faint text-[11px]">{k}</dt><dd className="num truncate font-medium" title={k === 'Publishing' ? (v === 'Auto' ? 'Posts publish automatically' : 'Scheduled with reminders; auto-publishing isn’t available yet') : v}>{v}</dd>
                        </div>
                      ))}
                    </dl>
                    {problem && card.detail && (
                      <p className="mx-4 mb-3 rounded-lg px-3 py-2 text-[12.5px]" style={{ background: card.status === 'expired' ? 'var(--sp-danger-soft)' : 'var(--sp-warning-soft)', color: card.status === 'expired' ? 'var(--sp-danger)' : 'var(--sp-warning)' }}>{card.detail}</p>
                    )}
                    <div className="mt-auto flex items-center justify-between gap-2 px-4 py-3" style={{ borderTop: '1px solid var(--sp-border)' }}>
                      {busy ? <span className="sp-status sp-status-scheduled"><Loader2 size={12} className="sp-spin" aria-hidden />Connecting</span> : <ConnectionBadge status={card.status} />}
                      {problem
                        ? <Button size="sm" variant="primary" icon={<RotateCw size={14} />} disabled={busy || !card.available} loading={op.kind === 'starting' && op.connectionId === a.connectionId} onClick={() => void connect(card, a.connectionId)}>Reconnect</Button>
                        : <span className="sp-faint truncate text-[12px]">{[a.lastVerifiedAt && `Verified ${relativeTime(a.lastVerifiedAt)}`, card.method === 'direct' ? 'Direct API' : 'via Postiz'].filter(Boolean).join(' · ')}</span>}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* Platforms without an account */}
      {statusFilter !== 'connected' && (data ? shownUnconnected.length > 0 || statusFilter === 'disconnected' : true) && (
        <section aria-labelledby="sp-available-h" className="space-y-3">
          <SubHeading id="sp-available-h" title="Available platforms" count={data ? shownUnconnected.length : undefined} description="Platforms you haven’t connected yet." />
          {!data ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="sp-card flex items-center gap-3 p-4"><Skeleton style={{ width: 40, height: 40, borderRadius: 11 }} /><div className="flex-1 space-y-2"><Skeleton style={{ height: 13, width: '45%' }} /><Skeleton style={{ height: 11, width: '75%' }} /></div></div>)}</div>
          ) : shownUnconnected.length === 0 ? (
            <div className="sp-card sp-card-dashed"><EmptyState title={filtered && unconnected.length ? 'No platforms match' : 'Every platform is connected'} body={filtered && unconnected.length ? 'Try a different search or filter.' : 'Nice — there’s nothing left to connect.'} action={filtered && unconnected.length ? <Button variant="secondary" onClick={clearFilters}>Clear filters</Button> : undefined} /></div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {shownUnconnected.map((card) => {
                const op = ops[card.platform] ?? { kind: 'idle' as const };
                const busy = op.kind === 'starting' || op.kind === 'waiting' || op.kind === 'finishing';
                const note = !card.available ? card.unavailableReason : (isProblem(card.status) && card.detail) || noteFor(card.platform) || (PLATFORMS[card.platform].autoPublish ? 'Auto-publishing supported.' : 'Scheduling and reminders.');
                return (
                  <div key={card.platform} className="sp-card sp-card-interactive flex items-center gap-3 p-4" aria-busy={busy}>
                    <PlatformLogo id={card.platform} size={40} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-[14px] font-semibold">{platformName(card)}</p>
                        {isProblem(card.status) && <ConnectionBadge status={card.status} />}
                      </div>
                      <p className={cx('mt-0.5 line-clamp-2 text-[12.5px]', isProblem(card.status) && card.available ? 'sp-danger-text' : 'sp-faint')}>{note}</p>
                    </div>
                    <Button size="sm" variant="secondary" icon={<Plus size={14} />} disabled={!card.available || busy} loading={op.kind === 'starting'} onClick={() => void connect(card)} aria-label={`Connect ${card.label}`}>Connect</Button>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-1 text-[12.5px]">
        {pz && pz.mode !== 'none' && (
          <span className="sp-faint inline-flex items-center gap-1.5">
            <ShieldCheck size={14} style={{ color: pz.workspaceAuthorized ? 'var(--sp-success)' : 'var(--sp-faint)' }} aria-hidden />
            {pz.mode === 'api_key' ? 'Connected through your team’s Postiz workspace'
              : pz.workspaceAuthorized ? `Postiz workspace${pz.workspaceName ? `: ${pz.workspaceName}` : ''} authorized`
              : 'You’ll approve access to your Postiz workspace the first time you connect'}
            {!pz.returnsToApp && ' · Authorization opens in a pop-up.'}
          </span>
        )}
        {onOpenAdvanced && (
          <span className="sp-faint inline-flex items-center gap-1.5"><Wrench size={13} aria-hidden />Older integrations live in <button type="button" className="underline" style={{ background: 'none', border: 0, color: 'var(--sp-accent-text)', cursor: 'pointer', font: 'inherit', padding: 0 }} onClick={onOpenAdvanced}>Advanced tools</button>.</span>
        )}
      </div>

      <ConnectPicker open={picker} platforms={platforms} ops={ops} onClose={() => setPicker(false)} onPick={(card) => { setPicker(false); void connect(card); }} />

      <Dialog open={!!consent} onClose={() => setConsent(null)} width={480} title="Approve access to Postiz"
        description="Your social accounts connect through Postiz. You’ll approve this app’s access to your Postiz workspace once; after that, connecting accounts happens right here."
        footer={<><Button variant="ghost" onClick={() => setConsent(null)}>Not now</Button><Button variant="primary" icon={<ExternalLink size={15} />} onClick={() => { const u = consent!.url; setConsent(null); window.location.assign(u); }}>Continue to Postiz</Button></>}>
        <p className="sp-muted text-[13px]">You’ll come straight back here afterwards to finish connecting {consent ? PLATFORMS[consent.platform].label : ''}.</p>
      </Dialog>

      {direct && <DirectDialog api={api} target={direct} onClose={() => setDirect(null)} onDone={(acc) => { setDirect(null); toast({ tone: 'success', title: `${PLATFORMS[direct.platform].label} connected`, body: acc.name }); void load(true); }} />}

      <Dialog open={!!disconnecting} onClose={() => !busyDisconnect && setDisconnecting(null)} width={460} busy={busyDisconnect}
        title={disconnecting ? `Disconnect ${disconnecting.account.name}?` : ''}
        footer={<><Button variant="ghost" onClick={() => setDisconnecting(null)} disabled={busyDisconnect}>Cancel</Button><Button variant="danger" loading={busyDisconnect} onClick={doDisconnect} data-autofocus>Disconnect</Button></>}>
        <p className="sp-muted text-[13.5px]">
          {disconnecting?.method === 'postiz'
            ? 'This removes the channel from your Postiz workspace. Postiz also deletes any posts still scheduled for it there. Posts already published stay live.'
            : 'The saved credential is deleted. Posts already published stay live.'}
        </p>
      </Dialog>
    </div>
  );
}

const platformName = (c: { platform: AccountPlatform; label: string }) => (c.platform === 'x' ? 'X (Twitter)' : c.label);

function SummaryTile({ icon, label, value, hint, tone }: { icon: React.ReactNode; label: string; value: string | null; hint: string; tone?: 'danger' }) {
  const danger = tone === 'danger';
  return (
    <div className="sp-card p-3.5 sm:p-4">
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 flex-none items-center justify-center rounded-lg" style={{ background: danger ? 'var(--sp-danger-soft)' : 'var(--sp-surface-2)', color: danger ? 'var(--sp-danger)' : 'var(--sp-muted)' }} aria-hidden>{icon}</span>
        <span className="sp-muted text-[12.5px] font-medium leading-tight">{label}</span>
      </div>
      {value === null ? <Skeleton className="mt-3" style={{ height: 26, width: 64 }} /> : <p className="display num mt-2.5 truncate text-[24px] font-semibold leading-none">{value}</p>}
      <p className={cx('mt-1.5 line-clamp-2 text-[12px] leading-snug', danger ? 'sp-danger-text' : 'sp-faint')}>{hint || ' '}</p>
    </div>
  );
}

function SubHeading({ id, title, count, description }: { id: string; title: string; count?: number; description?: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <h3 id={id} className="text-[14px] font-semibold">{title}</h3>
      {count !== undefined && <span className="sp-count">{count}</span>}
      {description && <span className="sp-faint hidden text-[12.5px] sm:inline">· {description}</span>}
    </div>
  );
}

function AccountCardSkeleton() {
  return (
    <div className="sp-card" aria-hidden>
      <div className="flex items-center gap-3 p-4"><Skeleton style={{ width: 44, height: 44, borderRadius: 999 }} /><div className="flex-1 space-y-2"><Skeleton style={{ height: 13, width: '55%' }} /><Skeleton style={{ height: 11, width: '35%' }} /></div></div>
      <div className="grid grid-cols-2 gap-3 px-4 pb-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} style={{ height: 26 }} />)}</div>
      <div className="px-4 py-3" style={{ borderTop: '1px solid var(--sp-border)' }}><Skeleton style={{ height: 20, width: 90, borderRadius: 999 }} /></div>
    </div>
  );
}

/** "Connect account" dialog: every platform with its availability and current account count. */
function ConnectPicker({ open, platforms, ops, onClose, onPick }: {
  open: boolean; platforms: PlatformCard[]; ops: Partial<Record<AccountPlatform, Op>>; onClose: () => void; onPick: (c: PlatformCard) => void;
}) {
  const [q, setQ] = useState('');
  const term = q.trim().toLowerCase();
  const list = platforms.filter((c) => !term || platformName(c).toLowerCase().includes(term));
  return (
    <Dialog open={open} onClose={() => { setQ(''); onClose(); }} width={600} title="Connect an account" description="Choose a platform. You’ll sign in with that platform to authorize publishing.">
      <SearchField value={q} onChange={setQ} placeholder="Search platforms" label="Search platforms" />
      <div className="mt-3 grid gap-2 pb-2 sm:grid-cols-2">
        {list.map((c) => {
          const k = ops[c.platform]?.kind;
          const busy = k === 'starting' || k === 'waiting' || k === 'finishing';
          const blockedAdd = c.accounts.length > 0 && c.method !== 'postiz'; // direct connections hold one account
          const disabled = !c.available || busy || blockedAdd;
          return (
            <button key={c.platform} type="button" disabled={disabled} onClick={() => onPick(c)}
              title={!c.available ? c.unavailableReason : blockedAdd ? 'Already connected' : undefined}
              className="sp-card sp-card-interactive flex items-center gap-3 p-3 text-left disabled:cursor-not-allowed disabled:opacity-55"
              style={{ font: 'inherit', color: 'inherit', cursor: disabled ? undefined : 'pointer' }}>
              <PlatformLogo id={c.platform} size={36} />
              <span className="min-w-0 flex-1">
                <span className="block text-[13.5px] font-semibold">{platformName(c)}</span>
                <span className="sp-faint block truncate text-[12px]">
                  {!c.available ? 'Unavailable' : busy ? 'Connecting…' : c.accounts.length ? `${c.accounts.length} connected` : 'Not connected'}
                </span>
              </span>
              {c.accounts.length > 0 && isProblem(c.status) ? <ConnectionBadge status={c.status} /> : c.available && !blockedAdd && !busy ? <Plus size={16} className="sp-faint flex-none" aria-hidden /> : null}
            </button>
          );
        })}
        {!list.length && <p className="sp-muted col-span-full py-8 text-center text-[13px]">No platforms match “{q.trim()}”.</p>}
      </div>
    </Dialog>
  );
}

function noteFor(p: AccountPlatform): string {
  return ({ bluesky: 'Uses a Bluesky app password, not your main password.', instagram: 'Needs an Instagram Business or Creator account linked to a Facebook Page.', facebook: 'Connect Facebook Pages you manage.', mastodon: 'For accounts on mastodon.social.' } as Partial<Record<AccountPlatform, string>>)[p] ?? '';
}

function DirectDialog({ api, target, onClose, onDone }: {
  api: AccountsApi; target: { platform: AccountPlatform; fields: Extract<ConnectNext, { next: 'credentials' }>['fields']; reconnectId?: string };
  onClose: () => void; onDone: (a: AccountProfile) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const base = useId();
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const missing = target.fields.filter((f) => !values[f.key]?.trim());
    if (missing.length) { setErrors(Object.fromEntries(missing.map((f) => [f.key, `Enter your ${f.label.toLowerCase()}.`]))); return; }
    setBusy(true); setErrors({}); setFormError('');
    try { onDone(await api.connectDirect(target.platform, values, target.reconnectId)); }
    catch (err: any) {
      if (err instanceof AccountsApiError && err.field) setErrors({ [err.field]: err.message });
      else setFormError(err?.message || 'The account couldn’t be connected.');
    } finally { setBusy(false); }
  };
  return (
    <Dialog open onClose={onClose} busy={busy} width={460} title={`Connect ${PLATFORMS[target.platform].label}`}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" type="submit" form={`${base}-f`} loading={busy}>Connect</Button></>}>
      <form id={`${base}-f`} noValidate onSubmit={submit} className="space-y-4">
        {formError && <Banner tone="danger">{formError}</Banner>}
        {target.fields.map((f, i) => (
          <div key={f.key}>
            <label htmlFor={`${base}-${f.key}`} className="sp-label">{f.label}</label>
            <input id={`${base}-${f.key}`} className="sp-input" type={f.type === 'password' ? 'password' : f.type === 'url' ? 'url' : 'text'} autoComplete={f.type === 'password' ? 'off' : 'username'}
              placeholder={f.placeholder} value={values[f.key] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              aria-invalid={!!errors[f.key]} data-autofocus={i === 0 ? true : undefined} />
            {errors[f.key] ? <p className="sp-error" role="alert">{errors[f.key]}</p> : f.help ? <p className="sp-hint">{f.help}</p> : null}
          </div>
        ))}
        <p className="sp-faint text-[12px]">Stored encrypted on the server and only used to publish your posts.</p>
      </form>
    </Dialog>
  );
}
