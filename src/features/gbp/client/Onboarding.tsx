/** Connect → choose locations → read data → first audit → score → top recommendations. */
import React, { useEffect, useState } from 'react';
import { ArrowRight, Check, CheckCircle2, Lock, MapPin, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react';
import type { AuditResult, GLocation } from './api';
import { routeForAction, useGrowth } from './GrowthStore';
import { Alert, Badge, Button, PRIORITY_TONE, ScoreRing } from './ui';

const REASONS: Record<string, string> = {
  invalid_state: 'The sign-in link was invalid. Please try again.', state_mismatch: 'The sign-in didn’t match this browser. Please try again from this page.',
  expired: 'The sign-in took too long or was already used. Please try again.', token_exchange: 'Google didn’t complete the sign-in. Please try again.',
  scope_denied: 'Business Profile access wasn’t granted. Please allow “Manage your business” when Google asks.', not_configured: 'Google sign-in isn’t set up on this server yet.',
  missing_code: 'Google didn’t return an authorization code. Please try again.',
};

const STEPS = ['Connect Google', 'Choose locations', 'Read profile', 'First audit', 'Your score'];

export function Onboarding({ onDone }: { onDone: () => void }) {
  const { api, dash, reload, go, setLocation } = useGrowth();
  const conn = dash?.connection;
  const [step, setStep] = useState(conn?.connected ? (conn.selectedCount ? 2 : 1) : 0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [locs, setLocs] = useState<GLocation[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [progress, setProgress] = useState<{ step: string; progress: number } | null>(null);
  const [audit, setAudit] = useState<AuditResult | null>(null);
  const [auditLoc, setAuditLoc] = useState('');

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const r = p.get('gbp');
    if (r === 'error') setErr(REASONS[p.get('gbp_reason') || ''] ?? 'Google sign-in didn’t complete. Please try again.');
    if (r === 'cancelled') setErr('You cancelled the Google sign-in. Nothing was connected.');
    if (r) { ['gbp', 'gbp_reason'].forEach((k) => p.delete(k)); const q = p.toString(); window.history.replaceState(null, '', `${window.location.pathname}${q ? `?${q}` : ''}`); }
  }, []);
  useEffect(() => { if (conn?.connected && step === 0) setStep(conn.selectedCount ? 2 : 1); }, [conn?.connected]); // eslint-disable-line react-hooks/exhaustive-deps

  const connect = async () => {
    setBusy(true); setErr(null);
    try { const { url } = await api<{ url: string }>('/connect', { method: 'POST', json: {} }); window.location.assign(url); }
    catch (e: any) { setErr(e.message); setBusy(false); }
  };

  const discover = async () => {
    setBusy(true); setErr(null);
    try { const l = await api<GLocation[]>('/locations/discover', { method: 'POST', json: {} }); setLocs(l); setPicked(l.filter((x) => x.selected).map((x) => x.name).slice(0, 10) || []); if (l.length === 1) setPicked([l[0].name]); }
    catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  };
  useEffect(() => { if (step === 1 && !locs) discover(); }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveLocations = async () => {
    setBusy(true); setErr(null);
    try { await api('/locations/selection', { method: 'PUT', json: { locationNames: picked } }); setLocation(picked[0]); await reload(); setStep(2); }
    catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const runAudit = async () => {
    const target = picked[0] || dash?.locations[0]?.location.name;
    if (!target) { setStep(1); return; }
    setAuditLoc(target); setBusy(true); setErr(null); setStep(3);
    try {
      let job = await api<any>('/growth/audits', { method: 'POST', json: { location: target } });
      while (job.status === 'queued' || job.status === 'running') {
        setProgress({ step: job.step, progress: job.progress });
        await new Promise((r) => setTimeout(r, 800));
        job = await api<any>(`/growth/jobs/${job.id}`);
      }
      if (job.status === 'failed') throw new Error(job.error || 'The audit couldn’t finish.');
      const a = await api<{ audit: AuditResult }>(`/growth/audit?location=${encodeURIComponent(target)}`);
      setAudit(a.audit); setStep(4); await reload();
    } catch (e: any) { setErr(e.message); setStep(2); }
    finally { setBusy(false); setProgress(null); }
  };

  const finish = async () => { await api('/growth/onboarding', { method: 'PUT', json: { completed: true } }).catch(() => undefined); await reload(); onDone(); };

  if (conn && !conn.configured) {
    return (
      <div className="mx-auto max-w-[760px] space-y-4 p-6">
        <h1 className="text-[24px] font-bold">Connect your Google Business Profile</h1>
        <Alert tone="warn" title="Google sign-in isn’t set up on this server yet">
          An administrator needs to create a Google Cloud OAuth client and request Business Profile API access from Google, then set
          <code className="mx-1">GOOGLE_CLIENT_ID</code>, <code className="mx-1">GOOGLE_CLIENT_SECRET</code> and <code className="mx-1">APP_URL</code>.
          Until then, nothing in this tab shows business data, because none is simulated.
        </Alert>
        <SetupList />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[880px] space-y-6 p-4 sm:p-6">
      <ol className="flex flex-wrap items-center gap-2" aria-label="Setup progress">
        {STEPS.map((s, i) => (
          <li key={s} className="flex items-center gap-2 text-[12.5px] font-semibold" aria-current={i === step ? 'step' : undefined}>
            <span className="flex h-6 w-6 items-center justify-center rounded-full" style={{ background: i < step ? 'var(--g-ok)' : i === step ? 'var(--g-accent-strong)' : 'var(--g-raised)', color: i <= step ? '#fff' : 'var(--g-faint)' }}>
              {i < step ? <Check size={13} /> : i + 1}
            </span>
            <span style={{ color: i === step ? 'var(--g-text)' : 'var(--g-faint)' }}>{s}</span>
            {i < STEPS.length - 1 && <span className="g-faint" aria-hidden>—</span>}
          </li>
        ))}
      </ol>

      {err && <Alert tone="danger" title={err} />}

      {step === 0 && (
        <div className="g-card g-card-pad g-fade space-y-5">
          <div className="space-y-2">
            <h1 className="text-[26px] font-bold">Grow your business on Google</h1>
            <p className="g-muted max-w-[62ch] text-[14.5px]">Connect your Google Business Profile to see how complete and healthy it is, what to fix first, and get help writing replies and posts. You approve every change before anything is published.</p>
          </div>
          <ul className="grid gap-3 sm:grid-cols-3">
            {[[ShieldCheck, 'Secure sign-in', 'You sign in on Google’s own page. We never see or store your password.'],
              [Lock, 'Only what’s needed', 'We ask for Business Profile access and your email, nothing else.'],
              [CheckCircle2, 'You stay in control', 'Nothing is changed on Google until you confirm it. Disconnect any time.']].map(([I, t, d]: any) => (
              <li key={t} className="rounded-xl p-3.5" style={{ background: 'var(--g-raised)' }}>
                <I size={18} style={{ color: 'var(--g-accent)' }} aria-hidden />
                <p className="mt-2 text-[13.5px] font-semibold">{t}</p><p className="g-muted text-[12.5px]">{d}</p>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" loading={busy} onClick={connect} icon={<ArrowRight size={16} />}>{conn?.needsReconnect ? 'Reconnect Google' : 'Connect Google Business Profile'}</Button>
            <span className="g-faint text-[12.5px]">This app isn’t made or endorsed by Google.</span>
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="g-card g-card-pad g-fade space-y-4">
          <div><h2 className="text-[20px] font-bold">Which locations do you want to manage?</h2><p className="g-muted text-[13.5px]">These are the Business Profiles your Google account can manage.</p></div>
          {!locs ? <p className="g-muted flex items-center gap-2 text-[13.5px]"><RefreshCw size={15} className="animate-spin" aria-hidden />Reading your locations from Google…</p>
            : !locs.length ? <Alert tone="warn" title="No Business Profiles found on this Google account">Sign in with the Google account that owns or manages the profile, or ask the owner to add you as a manager.</Alert>
            : (
              <ul className="max-h-[360px] space-y-2 overflow-y-auto">
                {locs.map((l) => {
                  const on = picked.includes(l.name);
                  return (
                    <li key={l.name}>
                      <label className="flex cursor-pointer items-start gap-3 rounded-xl p-3" style={{ background: on ? 'var(--g-accent-tint)' : 'var(--g-raised)', border: `1px solid ${on ? 'var(--g-accent)' : 'transparent'}` }}>
                        <input type="checkbox" className="mt-1" checked={on} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, l.name] : p.filter((x) => x !== l.name)))} />
                        <MapPin size={17} className="mt-0.5 flex-none" style={{ color: 'var(--g-accent)' }} aria-hidden />
                        <span className="min-w-0"><span className="block text-[14px] font-semibold">{l.title}</span><span className="g-muted block text-[12.5px]">{[l.primaryCategory, l.address?.lines?.[0], l.address?.city].filter(Boolean).join(' · ') || 'No address shown'}</span></span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          <div className="flex gap-2"><Button variant="primary" disabled={!picked.length} loading={busy} onClick={saveLocations}>Continue with {picked.length || 'no'} location{picked.length === 1 ? '' : 's'}</Button><Button variant="ghost" onClick={discover} disabled={busy}>Refresh list</Button></div>
        </div>
      )}

      {step === 2 && (
        <div className="g-card g-card-pad g-fade space-y-4">
          <div><h2 className="text-[20px] font-bold">Ready for your first audit</h2><p className="g-muted text-[13.5px]">We’ll read your profile, photos, posts, attributes and reviews from Google, then run 37 checks on what affects how customers see you. It takes under a minute.</p></div>
          <Button variant="primary" loading={busy} onClick={runAudit} icon={<Sparkles size={16} />}>Run my audit</Button>
        </div>
      )}

      {step === 3 && (
        <div className="g-card g-card-pad g-fade space-y-4" aria-live="polite">
          <h2 className="text-[20px] font-bold">Auditing your profile…</h2>
          <div className="h-2 overflow-hidden rounded-full" style={{ background: 'var(--g-raised)' }}><div className="h-full rounded-full" style={{ width: `${progress?.progress ?? 5}%`, background: 'var(--g-accent)', transition: 'width .4s' }} /></div>
          <p className="g-muted text-[13.5px]">{progress?.step ?? 'Starting'}</p>
        </div>
      )}

      {step === 4 && audit && (
        <div className="g-card g-card-pad g-fade space-y-5">
          <div className="flex flex-wrap items-center gap-5">
            <ScoreRing value={audit.overall} size={120} label="Profile Health" />
            <div className="min-w-0 flex-1">
              <h2 className="text-[22px] font-bold">Your Profile Health is {audit.overall}/100</h2>
              <p className="g-muted text-[13.5px]">{audit.overall >= 80 ? 'Strong foundation. A few improvements will keep you ahead.' : audit.overall >= 55 ? 'A good start with clear wins available.' : 'There are important gaps. The steps below are the fastest way to improve.'} This is this app’s assessment, not a Google score.</p>
            </div>
          </div>
          <div>
            <h3 className="mb-2 text-[15px] font-semibold">Start with these</h3>
            <ol className="space-y-2">
              {audit.issues.slice(0, 5).map((i, n) => (
                <li key={i.id} className="flex flex-wrap items-center gap-3 rounded-xl p-3" style={{ background: 'var(--g-raised)' }}>
                  <span className="g-num g-faint w-5 text-[13px] font-bold">{n + 1}</span>
                  <span className="min-w-0 flex-1"><span className="block text-[14px] font-semibold">{i.issue.title}</span><span className="g-muted block text-[12.5px]">{i.issue.description}</span></span>
                  <Badge tone={PRIORITY_TONE[i.issue.priority]}>{i.issue.priority}</Badge>
                  <Button size="sm" onClick={async () => { setLocation(auditLoc); await finish(); go(routeForAction(i.issue.action.type), { focus: i.issue.action.type }); }}>{i.issue.action.label}</Button>
                </li>
              ))}
            </ol>
          </div>
          <Button variant="primary" onClick={finish} icon={<ArrowRight size={16} />}>Go to my dashboard</Button>
        </div>
      )}
    </div>
  );
}

export function SetupList() {
  const items = [
    ['Google Cloud project with an OAuth client (Web application)', 'Authorised redirect URI: <APP_URL>/api/local-seo/callback'],
    ['Business Profile API access', 'Request access from Google (Business Profile APIs require approval), then enable My Business Account Management, Business Information, Verifications, Business Profile Performance and the Google My Business API (v4, reviews/posts/media).'],
    ['Server settings', 'GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, APP_URL, SOCIAL_ACCOUNTS_ENCRYPTION_KEY'],
    ['Optional: AI', 'GEMINI_API_KEY enables audit help, optimisation, posts and the assistant.'],
    ['Optional: competitors', 'GOOGLE_PLACES_API_KEY (Places API (New)) for public competitor details.'],
    ['Optional: rank tracking', 'Geo-grid rankings need a third-party rank-tracking provider subscription; none is connected.'],
  ];
  return (
    <ul className="g-card divide-y" style={{ borderColor: 'var(--g-line)' }}>
      {items.map(([t, d]) => <li key={t} className="px-5 py-3"><p className="text-[13.5px] font-semibold">{t}</p><p className="g-muted text-[12.5px]">{d}</p></li>)}
    </ul>
  );
}
