/**
 * IVR console (Twilio Programmable Voice + optional Dograh voice AI).
 * Everything shown comes from /api/voice/ivr/*; the simulator runs the same
 * TwiML builders Twilio calls. No simulated "live" calls.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Bot, CheckCircle2, Copy, Loader2, Phone, PhoneOff, RefreshCw, Workflow } from 'lucide-react';
import { getApiAuthHeaders } from '../../lib/apiAuth';
import { useDatabase } from '../../context/DatabaseContext';

type Step = 'inbound' | 'menu' | 'support';
interface Line { kind: 'say' | 'play' | 'wait' | 'dial' | 'queue' | 'conference' | 'redirect' | 'hangup' | 'pause'; text: string }

/** Turns TwiML into what the caller experiences, and finds the next step. */
function readTwiml(xml: string): { lines: Line[]; next: { step: Step; attempt: number } | null } {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const lines: Line[] = [];
  let next: { step: Step; attempt: number } | null = null;
  const walk = (el: Element) => {
    for (const n of Array.from(el.children)) {
      const t = (n.textContent || '').trim();
      switch (n.tagName) {
        case 'Say': lines.push({ kind: 'say', text: t }); break;
        case 'Play': lines.push({ kind: 'play', text: `Plays recording: ${t}` }); break;
        case 'Pause': lines.push({ kind: 'pause', text: `Silence ${n.getAttribute('length') || 1}s` }); break;
        case 'Gather': {
          walk(n);
          const action = n.getAttribute('action') || '';
          const u = new URL(action, window.location.origin);
          next = { step: u.pathname.endsWith('/support') ? 'support' : 'menu', attempt: Number(u.searchParams.get('attempt') || 0) };
          lines.push({ kind: 'wait', text: `Waiting up to ${n.getAttribute('timeout')}s for a key press` });
          return; // the Redirect after Gather only runs if Twilio skips actionOnEmptyResult
        }
        case 'Dial': {
          const num = n.querySelector('Number')?.textContent; const conf = n.querySelector('Conference')?.textContent;
          lines.push(num ? { kind: 'dial', text: `Forwards the call to ${num}` } : { kind: 'conference', text: `Joins conference room “${conf}” and waits for an agent` });
          break;
        }
        case 'Enqueue': lines.push({ kind: 'queue', text: `Joins queue “${t}” (hold announcements play while waiting)` }); break;
        case 'Redirect': if (!next) lines.push({ kind: 'redirect', text: t.includes('/telephony/inbound/run') ? 'Hands the call to the Dograh AI assistant' : `Continues at ${t}` }); break;
        case 'Hangup': lines.push({ kind: 'hangup', text: 'Call ends' }); break;
      }
    }
  };
  if (doc.documentElement) walk(doc.documentElement);
  return { lines, next };
}

const Copyable = ({ label, value }: { label: string; value: string }) => {
  const [done, setDone] = useState(false);
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-28 shrink-0 text-slate-500">{label}</span>
      <code className="min-w-0 flex-1 truncate rounded-lg bg-slate-50 border border-slate-200 px-2 py-1.5 text-slate-800">{value}</code>
      <button type="button" aria-label={`Copy ${label}`} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500" onClick={() => { navigator.clipboard?.writeText(value); setDone(true); setTimeout(() => setDone(false), 1200); }}>
        {done ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
      </button>
    </div>
  );
};

export default function DograhIvrConsole() {
  const db = useDatabase() as any;
  const devUser = db?.userId || 'demo-user-123';
  const api = useCallback(async (path: string, init: RequestInit = {}) => {
    const res = await fetch(`/api/voice/ivr${path}`, { ...init, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(await getApiAuthHeaders(devUser)) } });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`);
    return body;
  }, [devUser]);

  const [cfg, setCfg] = useState<any>(null);
  const [err, setErr] = useState('');
  const [events, setEvents] = useState<any[]>([]);
  const [callerName, setCallerName] = useState('');
  const [sim, setSim] = useState<{ transcript: { who: 'ivr' | 'caller'; line: Line }[]; next: { step: Step; attempt: number } | null; busy: boolean; active: boolean }>({ transcript: [], next: null, busy: false, active: false });

  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }); }, [sim.transcript.length]);

  const load = useCallback(() => {
    api('/config').then((c) => { setCfg(c); setErr(''); }).catch((e) => setErr(e.message));
    api('/calls').then((c) => setEvents(c.events)).catch(() => undefined);
  }, [api]);
  useEffect(() => { load(); const t = setInterval(() => api('/calls').then((c) => setEvents(c.events)).catch(() => undefined), 10_000); return () => clearInterval(t); }, [load, api]);

  const run = async (body: any, callerSays?: string) => {
    setSim((s) => ({ ...s, busy: true }));
    try {
      const { twiml, note } = await api('/preview', { method: 'POST', body: JSON.stringify(body) });
      const parsed = readTwiml(twiml);
      const lines = note ? [...parsed.lines, { kind: 'pause' as const, text: note }] : parsed.lines;
      const next = parsed.next;
      setSim((s) => ({
        busy: false, next, active: !!next,
        transcript: [...(body.step === 'inbound' ? [] : s.transcript), ...(callerSays ? [{ who: 'caller' as const, line: { kind: 'say' as const, text: callerSays } }] : []), ...lines.map((line) => ({ who: 'ivr' as const, line }))],
      }));
    } catch (e: any) { setErr(e.message); setSim((s) => ({ ...s, busy: false })); }
  };
  const press = (d: string) => sim.next && run({ step: sim.next.step, digits: d, attempt: sim.next.attempt }, `Presses ${d}`);
  const silence = () => sim.next && run({ step: sim.next.step, digits: '', attempt: sim.next.attempt }, 'Says nothing (10 s timeout)');

  if (err && !cfg) return <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-800" role="alert">IVR status couldn’t load: {err} <button className="ml-2 font-semibold underline" onClick={load}>Retry</button></div>;
  if (!cfg) return <div className="flex items-center gap-2 p-8 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />Loading IVR configuration…</div>;

  const r = cfg.routing;
  return (
    <div className="grid gap-4 lg:grid-cols-12">
      <div className="space-y-4 lg:col-span-7">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900"><Workflow className="h-4 w-4 text-blue-600" />Twilio IVR status</h2>
            <button type="button" onClick={load} className="flex items-center gap-1 text-xs font-semibold text-blue-600"><RefreshCw className="h-3.5 w-3.5" />Refresh</button>
          </div>
          {cfg.ready
            ? <p className="mt-3 flex items-center gap-2 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4" />Ready for calls. Signature verification {cfg.signatureVerification}.</p>
            : <div className="mt-3 rounded-xl bg-amber-50 p-3 text-xs text-amber-900"><p className="mb-1 flex items-center gap-1.5 font-semibold"><AlertTriangle className="h-4 w-4" />Setup needed</p><ul className="list-disc space-y-0.5 pl-5">{cfg.problems.map((p: string) => <li key={p}>{p}</li>)}</ul></div>}
          {cfg.webhooks && (
            <div className="mt-4 space-y-2">
              <p className="text-xs font-semibold text-slate-700">Paste into Twilio → Phone Numbers → your number → Voice configuration</p>
              <Copyable label="A call comes in" value={cfg.webhooks.voiceUrl} />
              <Copyable label="Call status changes" value={cfg.webhooks.statusCallback} />
              <p className="text-[11px] text-slate-500">Method: HTTP POST. Local testing: run <code>ngrok http 3000</code> and add its host (e.g. abc123.ngrok-free.app) to IVR_ALLOWED_HOSTS (docs/voice-ivr/README.md).</p>
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-bold text-slate-900">Call flow</h2>
          {cfg.profile === 'secure' ? (
          <ol className="mt-3 space-y-2 text-xs text-slate-700">
            <li><b>Greeting</b> → {cfg.personalize ? 'first name for known callers, generic otherwise' : 'generic (privacy mode)'} → menu (DTMF, 10 s, 1 digit; repeated {cfg.maxReplays}× on no or invalid input)</li>
            <li className="pl-4">1 · <b>SMS login code</b> → 6-digit code to the caller’s number on file, then hang up {cfg.sms.configured ? `(limit ${cfg.sms.maxPerHour}/hour, ${cfg.sms.countryCodes.join(', ')} only)` : <span className="text-amber-700">(SMS not configured)</span>}</li>
            <li className="pl-4">2 · <b>Support</b> → forward to {r.supportNumber} (30 s); unanswered → back to the menu</li>
            <li className="pl-4">0 · <b>Operator</b> → {r.operator.mode === 'number' ? `transfer to ${r.operator.number}` : `conference room “${r.operator.room}”`}</li>
            {r.dograh.enabled && <li className="pl-4">4 · <b>AI assistant</b> → Dograh</li>}
          </ol>
          ) : (
          <ol className="mt-3 space-y-2 text-xs text-slate-700">
            <li><b>Greeting</b> → main menu (DTMF, 10 s; replays {cfg.maxReplays}× on no or invalid input, then hangs up)</li>
            <li className="pl-4">1 · <b>Sales</b> → forward to {r.sales || 'not set'}; unanswered → back to the menu</li>
            <li className="pl-4">2 · <b>Technical Support</b> → 1 Billing queue “{r.support.billingQueue}” · 2 Technical queue “{r.support.technicalQueue}” · 3 Hours{r.dograh.enabled ? ' · 4 AI assistant' : ''} · * main menu</li>
            <li className="pl-4">3 · <b>Operator</b> → {r.operator.mode === 'number' ? `forward to ${r.operator.number}` : `conference room “${r.operator.room}” (agents join to answer)`}</li>
            {r.dograh.enabled && <li className="pl-4">4 · <b>AI assistant</b> → Dograh <code className="text-[11px]">{r.dograh.inboundUrl}</code></li>}
          </ol>
          )}
          <p className="mt-2 text-[11px] text-slate-500">Profile: <b>{cfg.profile}</b> (IVR_MENU_PROFILE) · Allowed hosts: {cfg.allowedHosts.length ? cfg.allowedHosts.join(', ') : <span className="text-amber-700">any (set IVR_ALLOWED_HOSTS)</span>}</p>
          {!r.dograh.enabled && <p className="mt-3 flex items-start gap-1.5 text-[11px] text-slate-500"><Bot className="h-3.5 w-3.5 mt-0.5" />Set DOGRAH_BASE_URL to add “press 4 for our AI assistant”, handled by your self-hosted Dograh workflow.</p>}
          <p className="mt-2 text-[11px] text-slate-500">Voice: {cfg.tts.voice} ({cfg.tts.language}){cfg.tts.recordedPrompts.length ? ` · recorded prompts: ${cfg.tts.recordedPrompts.join(', ')}` : ' · all prompts use text-to-speech'}</p>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-bold text-slate-900">Recent IVR calls</h2>
          {events.length === 0 ? <p className="mt-2 text-xs text-slate-500">No calls yet on this server. Call your Twilio number to see events here.</p> : (
            <ul className="mt-2 max-h-56 space-y-1 overflow-auto text-xs">
              {events.slice(0, 40).map((e, i) => <li key={i} className="flex gap-2"><span className="w-16 shrink-0 text-slate-400">{new Date(e.at).toLocaleTimeString()}</span><span className="w-24 shrink-0 text-slate-500">{e.from || e.callSid}</span><span className="text-slate-800">{e.detail}</span></li>)}
            </ul>
          )}
        </section>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-5" aria-labelledby="ivr-sim">
        <h2 id="ivr-sim" className="text-sm font-bold text-slate-900">Try the menu</h2>
        <p className="text-[11px] text-slate-500">Runs the same TwiML Twilio receives. No real call is placed and no SMS is sent.</p>
        {cfg.profile === 'secure' && cfg.personalize && (
          <label className="mt-2 flex items-center gap-2 text-[11px] text-slate-600">Known caller name (optional)
            <input value={callerName} onChange={(e) => setCallerName(e.target.value)} maxLength={80} placeholder="e.g. Ada Lovelace" className="flex-1 rounded-lg border border-slate-200 px-2 py-1 text-xs" />
          </label>
        )}
        <div ref={logRef} className="mt-3 min-h-[220px] max-h-[320px] space-y-1.5 overflow-auto rounded-xl bg-slate-50 p-3 text-xs" aria-live="polite">
          {sim.transcript.length === 0 && <p className="text-slate-400">Press “Start test call”.</p>}
          {sim.transcript.map((t, i) => (
            <p key={i} className={t.who === 'caller' ? 'text-right text-blue-700 font-medium' : t.line.kind === 'say' ? 'text-slate-800' : 'text-slate-500 italic'}>
              {t.who === 'ivr' && t.line.kind === 'say' ? `“${t.line.text}”` : t.line.text}
            </p>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'].map((d) => (
            <button key={d} type="button" disabled={!sim.active || sim.busy} onClick={() => press(d)} className="h-11 rounded-xl border border-slate-200 bg-white text-base font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-40">{d}</button>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <button type="button" disabled={sim.busy} onClick={() => run({ step: 'inbound', ...(callerName.trim() ? { callerName: callerName.trim() } : {}) })} className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 py-2.5 text-xs font-bold text-white disabled:opacity-50"><Phone className="h-4 w-4" />{sim.transcript.length ? 'Restart' : 'Start test call'}</button>
          <button type="button" disabled={!sim.active || sim.busy} onClick={silence} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-xs font-semibold text-slate-700 disabled:opacity-40">No input</button>
          <button type="button" disabled={!sim.active} onClick={() => setSim((s) => ({ ...s, active: false, next: null, transcript: [...s.transcript, { who: 'caller', line: { kind: 'hangup', text: 'Hangs up' } }] }))} aria-label="Hang up" className="rounded-xl bg-rose-600 px-3 text-white disabled:opacity-40"><PhoneOff className="h-4 w-4" /></button>
        </div>
      </section>
    </div>
  );
}
