/**
 * Shown once right after someone signs in (design: docs/design/sign-in-board): Obsidian Core checks the
 * workspace before opening it. Every value comes from a real request; nothing is simulated.
 *
 *   Workspace          GET /api/orgs/me             organization and role
 *   Data connections   GET /api/dashboard/service   which channels are connected
 *   Security check     GET /api/security/policy     two-step status and the organization's sign-in rules
 *   AI readiness       GET /api/dashboard/service   whether Claude / Gemini keys are configured
 *
 * When every check passes the workspace opens by itself; with a warning or a failed check it waits for the
 * person to read it ("Open workspace" or "Try again"). Nothing here blocks the app: "Skip" is always there.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, Check, Cpu, LayoutGrid, Link2, Loader2, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { CoreScan, CoreWordmark } from './CoreVisuals';
import { useOptionalAuth } from '../../context/AuthContext';

export type CheckId = 'workspace' | 'connections' | 'security' | 'ai';
export type CheckStatus = 'running' | 'ok' | 'warn' | 'error';
export interface CheckState { status: CheckStatus; detail: string; note?: string }
interface FeedItem { at: Date; text: string; tone: 'info' | 'ok' | 'warn' | 'error' }
interface Channel { id: string; label: string; status: 'connected' | 'not_configured' | 'not_available' }

export const CHECKS: Array<{ id: CheckId; label: string; running: string; icon: React.ComponentType<any> }> = [
  { id: 'workspace', label: 'Workspace', running: 'Loading your organization', icon: LayoutGrid },
  { id: 'connections', label: 'Data connections', running: 'Checking connected channels', icon: Link2 },
  { id: 'security', label: 'Security check', running: 'Checking sign-in and security rules', icon: ShieldCheck },
  { id: 'ai', label: 'AI readiness', running: 'Checking AI providers', icon: Cpu },
];

/** Auto-open delay once everything passed, so the result can be seen. */
export const OPEN_DELAY_MS = 1200;

const roleLabel = (r?: string) => (r ? r.toLowerCase().split('_').map((w) => w[0]!.toUpperCase() + w.slice(1)).join(' ') : 'Member');
const clock = (d: Date) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** A check that gets no answer within this time is shown as failed, with "Try again". */
export const CHECK_TIMEOUT_MS = 10_000;

async function getJson(url: string, signal: AbortSignal): Promise<any> {
  const r = await fetch(url, { signal });
  const body = await r.json().catch(() => ({}));
  if (!r.ok || body?.success === false) { const e: any = new Error(`request failed (${r.status})`); e.status = r.status; throw e; }
  return body;
}

/** Turns the API responses into check results. Exported for tests. */
export function interpretOrg(d: any): CheckState & { orgName?: string } {
  const orgId = d?.current?.orgId;
  const org = (d?.organizations || []).find((o: any) => o.id === orgId);
  return { status: 'ok', detail: `${org?.name || 'Your organization'} · ${roleLabel(d?.current?.role)}`, note: 'Organization and permissions loaded', orgName: org?.name };
}
export function interpretSecurity(d: any): CheckState & { twoStep: boolean } {
  const twoStep = !!d?.me?.twoStep, required = !!d?.policy?.requireMfa;
  if (required && !twoStep) return { status: 'warn', detail: 'Your organization requires two-step sign-in', note: 'Set it up under Security & Access', twoStep };
  const rules = [required ? 'Two-step required' : 'Two-step optional', d?.policy?.idleSignOutMinutes ? `sign-out after ${d.policy.idleSignOutMinutes} min idle` : null].filter(Boolean).join(' · ');
  return { status: 'ok', detail: twoStep ? 'Signed in with two-step verification' : 'Signed in', note: rules, twoStep };
}
export function interpretConnections(channels: Channel[]): CheckState {
  const on = channels.filter((c) => c.status === 'connected').length;
  if (!channels.length) return { status: 'warn', detail: 'No channels reported', note: 'Connect channels under Integrations' };
  if (!on) return { status: 'warn', detail: `None of ${channels.length} channels connected`, note: 'Connect channels under Integrations' };
  return { status: 'ok', detail: `${on} of ${channels.length} channels connected`, note: channels.filter((c) => c.status === 'connected').map((c) => c.label).join(', ') };
}
export function interpretAi(ai: any): CheckState {
  const on = [ai?.claude?.configured && 'Claude', ai?.gemini?.configured && 'Gemini'].filter(Boolean) as string[];
  if (!on.length) return { status: 'warn', detail: 'No AI provider set up yet', note: 'An administrator adds a Claude or Gemini key' };
  return { status: 'ok', detail: `${on.join(' and ')} ${on.length > 1 ? 'are' : 'is'} ready`, note: 'The AI assistant can answer from your records' };
}

const TONE: Record<CheckStatus, { tag: string; cls: string }> = {
  running: { tag: 'Checking', cls: 'bg-[var(--oc-cyan-soft)] text-[var(--oc-cyan)]' },
  ok: { tag: 'Ready', cls: 'bg-[var(--success-soft)] text-[var(--success)]' },
  warn: { tag: 'Needs attention', cls: 'bg-[var(--warning-soft)] text-[var(--warning)]' },
  error: { tag: 'Couldn’t check', cls: 'bg-[var(--danger-soft)] text-[var(--danger)]' },
};
const FEED_TONE: Record<FeedItem['tone'], string> = { info: 'text-[var(--text)]', ok: 'text-[var(--text)]', warn: 'text-[var(--warning)]', error: 'text-[var(--danger)]' };

export default function WorkspaceStartup({ onDone, timeoutMs = CHECK_TIMEOUT_MS }: { onDone: () => void; timeoutMs?: number }) {
  const auth = useOptionalAuth() as any;
  const who: string = auth?.user?.displayName || auth?.user?.email || '';
  const [checks, setChecks] = useState<Record<CheckId, CheckState>>(() => Object.fromEntries(CHECKS.map((c) => [c.id, { status: 'running', detail: c.running }])) as any);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [orgName, setOrgName] = useState<string | undefined>();
  const [twoStep, setTwoStep] = useState<boolean | null>(null);
  const [run, setRun] = useState(0);
  const openRef = useRef<HTMLButtonElement>(null);
  const startedAt = useRef(new Date());

  const log = useCallback((text: string, tone: FeedItem['tone']) => setFeed((f) => [{ at: new Date(), text, tone }, ...f].slice(0, 12)), []);
  const set = useCallback((id: CheckId, s: CheckState) => {
    setChecks((c) => ({ ...c, [id]: s }));
    const label = CHECKS.find((c) => c.id === id)!.label;
    log(s.status === 'error' ? `${label}: couldn’t check` : `${label}: ${s.detail}`, s.status === 'running' ? 'info' : s.status);
  }, [log]);

  useEffect(() => {
    let live = true;
    // One controller per run: aborted when a check takes too long, and on unmount / "Try again" so no request
    // outlives the screen.
    const ctrl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs);
    const guard = (fn: () => void) => { if (live) fn(); };
    const why = (what: string) => (timedOut ? { detail: `${what} didn’t answer in ${Math.ceil(timeoutMs / 1000)} s`, note: 'Try again in a moment' } : { detail: `Couldn’t load ${what}`, note: 'Check your connection and try again' });
    setChecks(Object.fromEntries(CHECKS.map((c) => [c.id, { status: 'running', detail: c.running }])) as any);
    if (!run) setFeed([]); // StrictMode runs this effect twice on mount
    log(run ? 'Checking again' : 'Preparing your workspace', 'info');

    const all = [] as Promise<unknown>[];
    all.push(getJson('/api/orgs/me', ctrl.signal).then((d) => guard(() => { const r = interpretOrg(d); setOrgName(r.orgName); set('workspace', r); }))
      .catch(() => guard(() => set('workspace', { status: 'error', ...why('your organization') }))));
    all.push(getJson('/api/security/policy', ctrl.signal).then((d) => guard(() => { const r = interpretSecurity(d); setTwoStep(r.twoStep); set('security', r); }))
      .catch(() => guard(() => set('security', { status: 'error', ...why('security settings') }))));
    all.push(getJson('/api/dashboard/service', ctrl.signal).then((d) => guard(() => {
      const ch: Channel[] = Array.isArray(d?.channels) ? d.channels : [];
      setChannels(ch); set('connections', interpretConnections(ch)); set('ai', interpretAi(d?.ai));
    })).catch(() => guard(() => {
      set('connections', { status: 'error', ...why('channel status') });
      set('ai', { status: 'error', ...why('AI status') });
    })));
    void Promise.allSettled(all).then(() => clearTimeout(timer));
    return () => { live = false; clearTimeout(timer); ctrl.abort(); };
  }, [run, set, log, timeoutMs]);

  const list = CHECKS.map((c) => ({ ...c, state: checks[c.id] }));
  const finished = list.filter((c) => c.state.status !== 'running').length;
  const percent = Math.round((finished / CHECKS.length) * 100);
  const done = finished === CHECKS.length;
  const failed = list.some((c) => c.state.status === 'error');
  const warned = list.some((c) => c.state.status === 'warn');
  const allGood = done && !failed && !warned;
  const current = list.find((c) => c.state.status === 'running');

  useEffect(() => { if (done) openRef.current?.focus(); }, [done]);
  useEffect(() => {
    if (!allGood) return;
    const t = setTimeout(onDone, OPEN_DELAY_MS);
    return () => clearTimeout(t);
  }, [allGood, onDone]);

  const headline = !done ? 'Preparing your workspace' : allGood ? 'Your workspace is ready' : failed ? 'Some checks didn’t finish' : 'Your workspace is ready, with notes';
  const status = useMemo(() => !done ? `${finished} of ${CHECKS.length} checks complete${current ? ` · ${current.running}` : ''}`
    : allGood ? 'Opening your workspace…' : failed ? 'You can try again, or open the workspace and check later.' : 'Review the notes below, then open your workspace.', [done, finished, current, allGood, failed]);

  return (
    <div className="oc-screen oc-grid fixed inset-0 z-[95] flex flex-col overflow-y-auto" role="dialog" aria-modal="true" aria-labelledby="startup-title">
      <header className="flex h-[60px] shrink-0 items-center justify-between gap-3 border-b border-[var(--border)] px-5 sm:px-6">
        <div className="flex min-w-0 items-center gap-2">
          <CoreWordmark />
          {orgName && <><span className="text-[var(--text-subtle)]" aria-hidden="true">/</span><span className="truncate text-[14px] font-medium text-[var(--text-muted)]">{orgName}</span></>}
        </div>
        <div className="flex items-center gap-2.5">
          {twoStep !== null && (
            <span className="hidden sm:inline-flex h-7 items-center gap-2 rounded-full border border-[var(--border-strong)] px-3 text-[12px] text-[var(--text-muted)]">
              <span className="h-[7px] w-[7px] rounded-full bg-[var(--success)] shadow-[0_0_8px_var(--success)]" aria-hidden="true" />{twoStep ? 'Signed in · Two-step verified' : 'Signed in'}
            </span>
          )}
          {!done && <button type="button" onClick={onDone} className="h-8 rounded-full px-3 text-[12.5px] font-medium text-[var(--text-muted)] hover:bg-[var(--surface-raised)] hover:text-[var(--text)] cursor-pointer">Skip</button>}
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[1180px] flex-1 flex-col gap-5 px-5 py-6 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="mb-1 text-[12.5px] font-medium text-[var(--text-subtle)]">{who ? `Signed in as ${who}` : 'Signed in'}</p>
            <h1 id="startup-title" className="text-[24px] font-semibold tracking-[-0.02em]">{headline}</h1>
          </div>
          <p className="text-[13px] text-[var(--text-muted)]" role="status" aria-live="polite">{status}</p>
        </div>

        <div className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-[264px_minmax(0,1fr)_264px]">
          <section aria-label="Checks" className="flex flex-col gap-3">
            {list.map(({ id, label, icon: Icon, state }) => (
              <div key={id} className={`oc-panel flex flex-1 flex-col justify-center px-4 py-3.5 ${state.status === 'running' ? 'border-[var(--oc-cyan-line)] shadow-[0_10px_30px_-18px_rgb(94_224_242/0.6)]' : ''}`}>
                <div className="flex items-center justify-between gap-2 text-[13px] font-semibold">
                  <span className="flex items-center gap-2.5"><Icon className={`h-[15px] w-[15px] ${state.status === 'ok' ? 'text-[var(--success)]' : state.status === 'running' ? 'text-[var(--oc-cyan)]' : state.status === 'warn' ? 'text-[var(--warning)]' : 'text-[var(--danger)]'}`} aria-hidden="true" />{label}</span>
                  <span className={`shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONE[state.status].cls}`}>{TONE[state.status].tag}</span>
                </div>
                <p className="mt-1.5 text-[12.5px] text-[var(--text-muted)]">{state.detail}</p>
                <div className="mt-2 h-1 overflow-hidden rounded bg-[rgb(255_255_255/0.06)]">
                  <div className={`h-full rounded transition-all duration-500 ${state.status === 'running' ? 'w-1/3 animate-pulse bg-[var(--oc-cyan)]' : state.status === 'ok' ? 'w-full bg-[var(--success)]' : state.status === 'warn' ? 'w-full bg-[var(--warning)]' : 'w-full bg-[var(--danger)]'}`} />
                </div>
                {state.note && state.status !== 'running' && <p className="mt-2 text-[11.5px] text-[var(--text-subtle)]">{state.note}</p>}
              </div>
            ))}
          </section>

          <section aria-label="Progress" className="flex flex-col items-center justify-center gap-4 py-2">
            <CoreScan percent={percent} size={340}>
              <span className="text-[34px] font-semibold tracking-[-0.02em] text-[#EEF9FC] tabular-nums">{percent}%</span>
              <span className="text-[12px] font-medium text-[#8FDCEA]">{done ? 'Scan complete' : 'Core scan'}</span>
            </CoreScan>
            <div className="w-full max-w-[400px]">
              <div className="flex justify-between text-[13px]"><span className="font-semibold">{done ? 'Checks finished' : 'Checking your workspace'}</span><span className="font-mono text-[12px] text-[var(--oc-cyan)]">{finished}/{CHECKS.length}</span></div>
              <div className="mt-2.5 h-2 overflow-hidden rounded bg-[rgb(255_255_255/0.06)]" role="progressbar" aria-label="Workspace checks" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
                <div className="h-full rounded bg-gradient-to-r from-[#5EE0F2] to-[#8B7CFF] shadow-[0_0_12px_rgb(94_224_242/0.6)] transition-all duration-500" style={{ width: `${percent}%` }} />
              </div>
            </div>
            {done && (
              <div className="flex flex-wrap justify-center gap-2">
                {failed && <button type="button" onClick={() => setRun((n) => n + 1)} className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-[var(--border-strong)] bg-[var(--surface-raised)] px-4 text-[13.5px] font-semibold hover:border-[var(--text-subtle)] cursor-pointer"><RefreshCw className="h-4 w-4" aria-hidden="true" />Try again</button>}
                <button ref={openRef} type="button" onClick={onDone} className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-gradient-to-b from-[#9284FF] to-[#7262F3] px-5 text-[13.5px] font-semibold text-white shadow-[0_8px_24px_-10px_rgb(114_98_243/0.8)] hover:brightness-110 cursor-pointer">Open workspace<ArrowRight className="h-4 w-4" aria-hidden="true" /></button>
              </div>
            )}
          </section>

          <section aria-labelledby="feed-title" className="oc-panel flex min-w-0 flex-col p-4">
            <div className="flex items-center justify-between">
              <h2 id="feed-title" className="text-[13px] font-semibold">Activity</h2>
              {!done && <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-strong)] px-2 py-0.5 text-[11px] text-[var(--text-muted)]"><span className="h-1.5 w-1.5 rounded-full bg-[var(--oc-cyan)]" aria-hidden="true" />Live</span>}
            </div>
            <ol className="mt-2 flex-1 text-[12px]">
              {feed.map((f, i) => (
                <li key={`${f.at.getTime()}-${i}`} className="grid grid-cols-[62px_minmax(0,1fr)] gap-2 border-t border-[var(--border)] py-2 first:border-t-0">
                  <span className="font-mono text-[11px] text-[var(--text-subtle)]">{clock(f.at)}</span>
                  <span className={`${FEED_TONE[f.tone]} break-words`}>{f.text}</span>
                </li>
              ))}
              <li className="grid grid-cols-[62px_minmax(0,1fr)] gap-2 border-t border-[var(--border)] py-2">
                <span className="font-mono text-[11px] text-[var(--text-subtle)]">{clock(startedAt.current)}</span>
                <span className="text-[var(--text)]">Signed in</span>
              </li>
            </ol>
          </section>
        </div>

        <section aria-labelledby="sources-title" className="oc-panel px-4 py-3.5">
          <div className="flex items-center justify-between">
            <h2 id="sources-title" className="text-[13px] font-semibold">Connected sources</h2>
            {channels && <span className="text-[11.5px] text-[var(--text-subtle)]">{channels.filter((c) => c.status === 'connected').length} of {channels.length}</span>}
          </div>
          {channels === null ? (
            <p className="mt-2 flex items-center gap-2 text-[12.5px] text-[var(--text-muted)]">{checks.connections.status === 'error' ? <><AlertTriangle className="h-4 w-4 text-[var(--danger)]" aria-hidden="true" />Channel status isn’t available right now.</> : <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Checking channels…</>}</p>
          ) : (
            <ul className="mt-2.5 flex flex-wrap gap-x-5 gap-y-2">
              {channels.map((c) => (
                <li key={c.id} className="flex items-center gap-2 text-[12.5px]">
                  {c.status === 'connected' ? <Check className="h-3.5 w-3.5 text-[var(--success)]" aria-hidden="true" /> : <X className="h-3.5 w-3.5 text-[var(--text-subtle)]" aria-hidden="true" />}
                  <span className={c.status === 'connected' ? '' : 'text-[var(--text-muted)]'}>{c.label}</span>
                  <span className="sr-only">{c.status === 'connected' ? 'connected' : 'not connected'}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>

      <footer className="flex min-h-[56px] shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-t border-[var(--border)] px-5 py-3 text-[12.5px] text-[var(--text-muted)] sm:px-6">
        {list.map(({ id, label, state }, i) => (
          <React.Fragment key={id}>
            {i > 0 && <span className="hidden h-px w-5 bg-[var(--border-strong)] sm:block" aria-hidden="true" />}
            <span className={`flex items-center gap-1.5 ${state.status === 'running' ? 'font-medium text-[var(--text)]' : ''}`}>
              <span className={`flex h-[18px] w-[18px] items-center justify-center rounded-full text-[10px] font-semibold ${TONE[state.status].cls}`} aria-hidden="true">
                {state.status === 'ok' ? '✓' : state.status === 'running' ? i + 1 : '!'}
              </span>{label}
            </span>
          </React.Fragment>
        ))}
      </footer>
    </div>
  );
}
