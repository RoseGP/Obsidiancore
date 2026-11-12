import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink, Link2Off, Loader2, Plug, Plus, RefreshCw, ShieldCheck, Wrench } from 'lucide-react';
import type { AccountsApi } from '../../social-accounts/client/accountsApi';
import { AccountsApiError } from '../../social-accounts/client/accountsApi';
import type { AccountPlatform, AccountProfile, AccountsOverview, CardStatus, ConnectNext, PlatformCard } from '../../social-accounts/shared/types';
import { PLATFORMS } from '../domain/model';
import { usePlanner } from '../state/PlannerStore';
import { Banner, Button, Dialog, ErrorState, PlatformGlyph, Skeleton, cx, useToast } from '../ui/kit';

const STATUS: Record<CardStatus, { label: string; cls: string; icon: React.ElementType }> = {
  connected: { label: 'Connected', cls: 'sp-status-published', icon: CheckCircle2 },
  not_connected: { label: 'Not connected', cls: 'sp-status-draft', icon: Plug },
  expired: { label: 'Expired', cls: 'sp-status-failed', icon: AlertTriangle },
  needs_attention: { label: 'Needs attention', cls: 'sp-status-publishing', icon: AlertTriangle },
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

function Avatar({ account, platform }: { account: AccountProfile; platform: AccountPlatform }) {
  const [broken, setBroken] = useState(false);
  if (account.pictureUrl && !broken) {
    return <img src={account.pictureUrl} alt="" className="h-9 w-9 flex-none rounded-full object-cover" onError={() => setBroken(true)} referrerPolicy="no-referrer" />;
  }
  return (
    <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full text-[13px] font-bold" style={{ background: 'var(--sp-surface-3)', color: PLATFORMS[platform].dot }} aria-hidden>
      {account.name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  );
}

function StatusPill({ status }: { status: CardStatus }) {
  const s = STATUS[status];
  return <span className={`sp-status ${s.cls}`}><s.icon size={12} aria-hidden />{s.label}</span>;
}

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
          popup.document.body.style.cssText = 'margin:0;font:15px system-ui;background:#141519;color:#ececf1;display:flex;align-items:center;justify-content:center;height:100vh';
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

  // ---------- Render ----------

  if (loadState.status === 'error' && !data) {
    return (
      <div className="p-4 sm:p-6"><div className="sp-card">
        <ErrorState
          title={loadState.code === 'unauthorized' ? 'Sign in to manage accounts' : 'Accounts couldn’t load'}
          message={loadState.code === 'unauthorized' ? 'Your session couldn’t be verified by the server. Sign in again, then reload this page.' : loadState.error}
          onRetry={() => void load()}
        />
      </div></div>
    );
  }

  const pz = data?.postiz;
  return (
    <div className="space-y-4 p-4 sm:p-6">
      {pz?.mode === 'none' && (
        <Banner tone="warning"><b>Postiz isn’t configured on the server.</b> <span className="sp-muted">Set POSTIZ_CLIENT_ID and POSTIZ_CLIENT_SECRET (or POSTIZ_API_KEY) to connect Instagram, Facebook, LinkedIn, X, TikTok and Mastodon.</span></Banner>
      )}
      {pz?.problem && <Banner tone={pz.problem.status === 'expired' ? 'danger' : 'warning'}>{pz.problem.detail}</Banner>}
      {resume && (
        <Banner tone="info" action={<Button size="sm" variant="primary" onClick={() => { const c = data?.platforms.find((x) => x.platform === resume); setResume(null); if (c) void connect(c); }}>Continue</Button>}>
          Continue connecting <b>{PLATFORMS[resume].label}</b>.
        </Banner>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px]">
        {pz && pz.mode !== 'none' && (
          <span className="sp-muted inline-flex items-center gap-1.5">
            <ShieldCheck size={15} style={{ color: pz.workspaceAuthorized ? 'var(--sp-success)' : 'var(--sp-faint)' }} aria-hidden />
            {pz.mode === 'api_key' ? 'Connected through your team’s Postiz workspace'
              : pz.workspaceAuthorized ? `Postiz workspace${pz.workspaceName ? `: ${pz.workspaceName}` : ''} authorized`
              : 'You’ll approve access to your Postiz workspace the first time you connect'}
          </span>
        )}
        {pz && pz.mode !== 'none' && !pz.returnsToApp && (
          <span className="sp-faint">Authorization opens in a pop-up and closes when it’s done.</span>
        )}
        <div className="flex-1" />
        <Button size="sm" variant="ghost" icon={<RefreshCw size={14} className={loadState.status === 'loading' && data ? 'sp-spin' : undefined} />} onClick={() => void load(true)}>Refresh status</Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {!data && Array.from({ length: 6 }).map((_, i) => <div key={i} className="sp-card p-4"><div className="flex gap-3"><Skeleton style={{ width: 40, height: 40, borderRadius: 12 }} /><div className="flex-1 space-y-2"><Skeleton style={{ height: 14, width: '50%' }} /><Skeleton style={{ height: 12, width: '70%' }} /></div></div><Skeleton className="mt-4" style={{ height: 34 }} /></div>)}
        {data?.platforms.map((card) => {
          const op = ops[card.platform] ?? { kind: 'idle' as const };
          const def = PLATFORMS[card.platform];
          const busy = op.kind === 'starting' || op.kind === 'waiting' || op.kind === 'finishing';
          const problem = card.status === 'expired' || card.status === 'needs_attention';
          return (
            <section key={card.platform} className="sp-card flex flex-col p-4" aria-labelledby={`acc-${card.platform}`} aria-busy={busy}>
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl" style={{ background: def.chip }}><PlatformGlyph id={card.platform} size={18} color="#fff" /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                    <h2 id={`acc-${card.platform}`} className="font-semibold">{card.label}</h2>
                    <StatusPill status={card.status} />
                  </div>
                  <p className="sp-faint mt-0.5 text-[12px]">{card.method === 'direct' ? 'Direct connection' : 'Via Postiz'}{def.autoPublish ? '' : ' · scheduling only'}</p>
                </div>
              </div>

              {card.detail && problem && <p className="mt-3 text-[12.5px]" style={{ color: card.status === 'expired' ? 'var(--danger)' : 'var(--warning)' }}>{card.detail}</p>}
              {!card.available && <p className="sp-faint mt-3 text-[12.5px]">{card.unavailableReason}</p>}

              {card.accounts.length > 0 && (
                <ul className="mt-3 space-y-2">
                  {card.accounts.map((a) => (
                    <li key={a.connectionId} className="flex items-center gap-2.5 rounded-xl p-2" style={{ background: 'var(--sp-surface-2)' }}>
                      <Avatar account={a} platform={card.platform} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13.5px] font-medium">{a.name}</p>
                        <p className="sp-faint truncate text-[12px]">{[a.handle, `Since ${new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(a.connectedAt))}`].filter(Boolean).join(' · ')}</p>
                      </div>
                      {problem && <Button size="sm" variant="secondary" disabled={busy || !card.available} loading={op.kind === 'starting' && op.connectionId === a.connectionId} onClick={() => void connect(card, a.connectionId)}>Reconnect</Button>}
                      <button type="button" className="sp-btn sp-icon-btn sm" aria-label={`Disconnect ${a.name}`} title="Disconnect" disabled={busy}
                        onClick={() => setDisconnecting({ platform: card.platform, account: a, method: card.method })}><Link2Off size={15} /></button>
                    </li>
                  ))}
                </ul>
              )}

              {card.accounts.length === 0 && card.available && noteFor(card.platform) && <p className="sp-faint mt-3 text-[12px]">{noteFor(card.platform)}</p>}

              <div className="mt-auto pt-4" aria-live="polite">
                {op.kind === 'waiting' ? (
                  <div className="rounded-xl p-3 text-[12.5px]" style={{ background: 'var(--sp-accent-tint)' }}>
                    <p className="flex items-center gap-2 font-semibold"><Loader2 size={14} className="sp-spin" aria-hidden />Waiting for {card.label}…</p>
                    <p className="sp-muted mt-1">{op.popup ? 'Finish in the pop-up window. It closes automatically when the account is connected.' : 'Your browser blocked the pop-up. Open the authorization page, then come back here.'}</p>
                    <div className="mt-2.5 flex flex-wrap gap-2">
                      {!op.popup && <a className="sp-btn sp-btn-secondary sp-btn-sm" href={op.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} />Open authorization</a>}
                      {op.popup && <Button size="sm" variant="ghost" onClick={() => { try { op.popup!.focus(); } catch { /* */ } }}>Show window</Button>}
                      <Button size="sm" variant="secondary" onClick={() => { stopPolling(card.platform); setOp(card.platform, { kind: 'finishing' }); void finish(card.platform, op.attemptId, op.popup, op.reconnect, true); }}>I’ve finished</Button>
                      <Button size="sm" variant="ghost" onClick={() => void cancel(card.platform, op)}>Cancel</Button>
                    </div>
                  </div>
                ) : op.kind === 'finishing' ? (
                  <p className="sp-muted flex items-center gap-2 text-[12.5px]"><Loader2 size={14} className="sp-spin" aria-hidden />Checking the connection…</p>
                ) : (
                  <>
                    {op.kind === 'error' && <p role="alert" className="mb-2 text-[12.5px]" style={{ color: 'var(--danger)' }}>{op.message}</p>}
                    {card.accounts.length === 0 ? (
                      <Button className="w-full" variant="primary" icon={<Plug size={15} />} disabled={!card.available} loading={op.kind === 'starting'} onClick={() => void connect(card)}>Connect {card.label}</Button>
                    ) : card.method === 'postiz' ? (
                      <Button className="w-full" variant="secondary" icon={<Plus size={15} />} disabled={!card.available} loading={op.kind === 'starting' && !op.connectionId} onClick={() => void connect(card)}>Add another</Button>
                    ) : null}
                  </>
                )}
              </div>
            </section>
          );
        })}
      </div>

      {onOpenAdvanced && (
        <p className="sp-faint flex items-center gap-1.5 pt-1 text-[12.5px]"><Wrench size={13} aria-hidden />Older integrations (Postiz panel, worker monitor) are under <button type="button" className="underline" style={{ background: 'none', border: 0, color: 'var(--sp-accent-text)', cursor: 'pointer', font: 'inherit', padding: 0 }} onClick={onOpenAdvanced}>Advanced tools</button>.</p>
      )}

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
