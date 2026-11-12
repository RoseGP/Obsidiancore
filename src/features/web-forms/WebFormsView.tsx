/**
 * Website Forms tab (view id `web_forms`): separate from the Local SEO tab and independent of Google.
 * A business owner can: copy a ready-made form for their website, list the websites allowed to send it, choose where submissions go (this CRM and/or a signed webhook for any other CRM), send a
 * test, and see recent submissions with their delivery status. Talks to /api/web-forms (server-side
 * validation, spam and duplicate handling, delivery). No form contents are shown here: they live in the CRM.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Copy, Globe, Inbox, KeyRound, Plus, RefreshCw, Send, ShieldCheck, Trash2, Webhook, AlertTriangle, Code2 } from 'lucide-react';
import { Button } from '../../components/localpilot/ui/Button';
import { Badge } from '../../components/localpilot/ui/Badge';
import { Dialog } from '../../components/localpilot/ui/Dialog';
import { htmlSnippet, fetchSnippet, reactSnippet } from './snippets';
import { TestSubmissionPanel, type TestResult } from './TestSubmissionPanel';

interface Delivery { adapter: 'obsidian' | 'webhook'; status: 'delivered' | 'failed' | 'pending'; attempts: number; httpStatus?: number; detail?: string; at: string }
interface Submission { id: string; at: string; status: 'accepted' | 'duplicate' | 'spam'; reason: string | null; formName: string; originHost: string | null; deliveries: Delivery[] }
interface Config {
  formId: string; allowedOrigins: string[]; redirectUrl: string | null; destinations: { obsidian: boolean; webhook: boolean };
  webhook: { url: string; secretHint: string; updatedAt: string } | null;
  captcha: { provider: 'turnstile'; siteKey: string; secretHint: string; updatedAt: string } | null; updatedAt: string;
}

class ApiError extends Error { constructor(message: string, public status: number, public fields?: { field: string; message: string }[]) { super(message); } }
async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try { res = await fetch(`/api/web-forms${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...(init.headers || {}) } }); }
  catch { throw new ApiError('Can’t reach the server. Check your connection.', 0); }
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.success === false) throw new ApiError(body?.error || `Request failed (${res.status}).`, res.status, body?.fields);
  return body as T;
}

/** Log filter: by result, or submissions where any destination failed. */
export function filterSubs(list: Submission[], k: 'all' | 'accepted' | 'spam' | 'duplicate' | 'problems') {
  return k === 'all' ? list : k === 'problems' ? list.filter((x) => x.deliveries.some((d) => d.status === 'failed')) : list.filter((x) => x.status === k);
}

const REASON: Record<string, string> = { honeypot: 'hidden spam-trap field filled', too_fast: 'sent faster than a person can type', too_many_links: 'too many links', markup: 'contained HTML' };

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button size="xs" variant="outline" leftIcon={done ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
      onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1800); } catch { /* clipboard blocked: the text is selectable */ } }}
      aria-label={label}>{done ? 'Copied' : 'Copy'}</Button>
  );
}

const SNIPPETS = { html: { label: 'Simple HTML form', make: htmlSnippet }, js: { label: 'JavaScript (no page reload)', make: fetchSnippet }, react: { label: 'React', make: reactSnippet } } as const;

export const WebFormsView: React.FC<{ /** Opens Sales Pipeline (leads), where received submissions land. */ onOpenLeads?: () => void }> = ({ onOpenLeads }) => {
  const [state, setState] = useState<'loading' | 'ready' | 'forbidden' | 'error'>('loading');
  const [error, setError] = useState('');
  const [config, setConfig] = useState<Config | null>(null);
  const [endpoint, setEndpoint] = useState('');
  const [appUrlConfigured, setAppUrlConfigured] = useState(true);
  const [subs, setSubs] = useState<Submission[] | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [originInput, setOriginInput] = useState('');
  const [webhookInput, setWebhookInput] = useState('');
  const [redirectInput, setRedirectInput] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [snippet, setSnippet] = useState<keyof typeof SNIPPETS>('html');
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [logFilter, setLogFilter] = useState<'all' | 'accepted' | 'spam' | 'duplicate' | 'problems'>('all');
  const [refreshing, setRefreshing] = useState(false);
  const refreshLog = useCallback(async () => {
    setRefreshing(true);
    try { setSubs((await api<{ submissions: Submission[] }>('/submissions')).submissions); }
    catch (e) { setNotice({ tone: 'error', text: (e as Error).message }); }
    finally { setRefreshing(false); }
  }, []);
  const [siteKeyInput, setSiteKeyInput] = useState('');
  const [secretKeyInput, setSecretKeyInput] = useState('');

  const load = useCallback(async () => {
    try {
      const c = await api<{ config: Config; endpoint: string; appUrlConfigured: boolean }>('/config');
      setConfig(c.config); setEndpoint(c.endpoint); setAppUrlConfigured(c.appUrlConfigured);
      setWebhookInput(c.config.webhook?.url || ''); setRedirectInput(c.config.redirectUrl || ''); setSiteKeyInput(c.config.captcha?.siteKey || '');
      const s = await api<{ submissions: Submission[] }>('/submissions');
      setSubs(s.submissions); setState('ready');
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) setState('forbidden');
      else { setError((e as Error).message); setState('error'); }
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const save = async (label: string, patch: Record<string, unknown>, ok: string) => {
    setBusy(label); setNotice(null);
    try {
      const r = await api<{ config: Config; endpoint: string; webhookSecret?: string }>('/config', { method: 'PUT', body: JSON.stringify(patch) });
      setConfig(r.config); setEndpoint(r.endpoint);
      if (r.webhookSecret) setSecret(r.webhookSecret);
      setNotice({ tone: 'ok', text: ok });
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) { setReadOnly(true); setNotice({ tone: 'error', text: 'Only owners and admins can change these settings.' }); }
      else setNotice({ tone: 'error', text: (e as Error).message });
    } finally { setBusy(null); }
  };

  const post = async <T,>(label: string, path: string): Promise<T | null> => {
    setBusy(label); setNotice(null);
    try { return await api<T>(path, { method: 'POST' }); }
    catch (e) { setNotice({ tone: 'error', text: e instanceof ApiError && e.status === 403 ? 'Only owners and admins can do this.' : (e as Error).message }); return null; }
    finally { setBusy(null); }
  };

  const stats = useMemo(() => {
    const s = subs || [];
    return { accepted: s.filter((x) => x.status === 'accepted').length, spam: s.filter((x) => x.status === 'spam').length, failed: s.filter((x) => x.deliveries.some((d) => d.status === 'failed')).length };
  }, [subs]);

  if (state === 'loading') return <div className="space-y-3" role="status" aria-label="Loading website forms"><div className="h-8 w-64 rounded bg-slate-100 animate-pulse" /><div className="h-40 rounded-xl bg-slate-100 animate-pulse" /><div className="h-40 rounded-xl bg-slate-100 animate-pulse" /></div>;
  if (state === 'forbidden') return (
    <div className="rounded-xl border border-slate-200 bg-white p-8 text-center"><ShieldCheck className="mx-auto h-8 w-8 text-slate-400" />
      <h1 className="mt-3 text-base font-semibold text-slate-900">Website forms are managed by your organization's admins</h1>
      <p className="mt-1 text-sm text-slate-500">Ask an owner or admin for access to Settings to see or change them.</p></div>
  );
  if (state === 'error' || !config) return (
    <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-800"><p className="font-semibold">Website forms couldn't load.</p><p className="mt-1">{error}</p>
      <Button className="mt-3" size="sm" variant="outline" onClick={() => { setState('loading'); void load(); }}>Try again</Button></div>
  );

  const origins = config.allowedOrigins;
  return (
    <div className="space-y-6 animate-in fade-in duration-200" id="localpilot-forms-view">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">Website forms</h1>
          <p className="text-sm text-slate-500 max-w-2xl">When someone fills in the contact form on your website, it's checked, spam is filtered out, and the message arrives in your CRM as a lead, ready to follow up.</p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge variant="success" size="sm">{stats.accepted} received</Badge>
          <Badge variant="neutral" size="sm">{stats.spam} spam blocked</Badge>
          {stats.failed > 0 && <Badge variant="danger" size="sm">{stats.failed} delivery problem{stats.failed === 1 ? '' : 's'}</Badge>}
        </div>
      </div>

      {notice && <p role={notice.tone === 'error' ? 'alert' : 'status'} className={`rounded-lg px-3 py-2 text-sm ${notice.tone === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'}`}>{notice.text}</p>}
      {readOnly && <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">You can view these settings; only owners and admins can change them.</p>}
      {!appUrlConfigured && <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800"><AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />The server's public address (APP_URL) isn't set, so this form address points to localhost. Set APP_URL before putting the form on a live website.</p>}

      {/* Step 1: the form */}
      <section aria-labelledby="wf-step1" className="bg-white rounded-xl border border-slate-200 p-5 shadow-2xs space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 id="wf-step1" className="text-sm font-semibold text-slate-900 flex items-center gap-2"><Code2 className="h-4 w-4 text-slate-500" />1. Add the form to your website</h2>
            <p className="text-xs text-slate-500">Paste this where you want the form (or send it to whoever manages your website). Style it to match your site.</p>
          </div>
          <div role="tablist" aria-label="Form code type" className="flex flex-wrap rounded-lg border border-slate-200 p-0.5 text-xs">
            {(Object.keys(SNIPPETS) as (keyof typeof SNIPPETS)[]).map((k) => (
              <button key={k} role="tab" aria-selected={snippet === k} onClick={() => setSnippet(k)} className={`rounded-md px-2.5 py-1 font-medium ${snippet === k ? 'bg-slate-900 text-white' : 'text-slate-600 hover:text-slate-900'}`}>{SNIPPETS[k].label}</button>
            ))}
          </div>
        </div>
        <div className="relative">
          <pre className="max-h-72 overflow-auto rounded-lg bg-slate-900 p-4 text-[12px] leading-relaxed text-slate-100" tabIndex={0} aria-label="Form code"><code>{SNIPPETS[snippet].make(endpoint, config.captcha?.siteKey ?? null)}</code></pre>
          <div className="absolute right-2 top-2"><CopyButton text={SNIPPETS[snippet].make(endpoint, config.captcha?.siteKey ?? null)} label="Copy form code" /></div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
          <span>Form address:</span><code className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-900 break-all">{endpoint}</code><CopyButton text={endpoint} label="Copy form address" />
        </div>
        <p className="text-xs text-slate-500">Accepted fields: name and email (required), phone, company, message, formName, pageUrl, consent, marketingOptIn and utm_source/utm_medium/utm_campaign. Anything else is ignored.</p>
      </section>

      {/* Step 2: allowed websites + thank-you page */}
      <section aria-labelledby="wf-step2" className="bg-white rounded-xl border border-slate-200 p-5 shadow-2xs space-y-4">
        <div>
          <h2 id="wf-step2" className="text-sm font-semibold text-slate-900 flex items-center gap-2"><Globe className="h-4 w-4 text-slate-500" />2. Choose which websites can use it</h2>
          <p className="text-xs text-slate-500">Browsers will only send the form from these addresses. {origins.length ? '' : 'Right now any website can send it; add yours to lock it down.'}</p>
        </div>
        <ul className="flex flex-wrap gap-2">
          {origins.map((o) => (
            <li key={o} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 py-1 pl-3 pr-1 text-xs text-slate-800">{o}
              <button type="button" disabled={readOnly || !!busy} onClick={() => save('origins', { allowedOrigins: origins.filter((x) => x !== o) }, `Removed ${o}.`)} aria-label={`Remove ${o}`} className="rounded-full p-1 text-slate-500 hover:bg-slate-200 hover:text-slate-900 disabled:opacity-40"><Trash2 className="h-3 w-3" /></button></li>
          ))}
          {!origins.length && <li className="text-xs text-amber-700">No websites added yet.</li>}
        </ul>
        <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); if (originInput.trim()) void save('origins', { allowedOrigins: [...origins, originInput.trim()] }, 'Website added.').then(() => setOriginInput('')); }}>
          <label htmlFor="wf-origin" className="sr-only">Website address</label>
          <input id="wf-origin" value={originInput} onChange={(e) => setOriginInput(e.target.value)} placeholder="https://www.yourbusiness.com" disabled={readOnly} className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400" />
          <Button type="submit" size="sm" variant="outline" disabled={readOnly || !originInput.trim()} isLoading={busy === 'origins'} leftIcon={<Plus className="h-3.5 w-3.5" />}>Add website</Button>
        </form>
        <form className="space-y-1.5" onSubmit={(e) => { e.preventDefault(); void save('redirect', { redirectUrl: redirectInput.trim() || null }, redirectInput.trim() ? 'Thank-you page saved.' : 'Thank-you page removed.'); }}>
          <label htmlFor="wf-redirect" className="block text-xs font-medium text-slate-700">Thank-you page (optional, for the simple HTML form)</label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input id="wf-redirect" value={redirectInput} onChange={(e) => setRedirectInput(e.target.value)} placeholder="https://www.yourbusiness.com/thank-you" disabled={readOnly} className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400" />
            <Button type="submit" size="sm" variant="outline" disabled={readOnly} isLoading={busy === 'redirect'}>Save</Button>
          </div>
          <p className="text-xs text-slate-500">Without one, visitors see a simple confirmation page.</p>
        </form>
      </section>

      {/* Spam protection: Cloudflare Turnstile (optional) */}
      <section aria-labelledby="wf-captcha" className="bg-white rounded-xl border border-slate-200 p-5 shadow-2xs space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 id="wf-captcha" className="text-sm font-semibold text-slate-900 flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-slate-500" />Extra spam protection (optional)</h2>
            <p className="text-xs text-slate-500 max-w-2xl">Every form already has a hidden spam trap, speed and link checks, and limits per visitor. If spam still gets through, turn on Cloudflare Turnstile: a free "verify you are human" check that's usually invisible to real people.</p>
          </div>
          {config.captcha ? <Badge variant="success" size="sm">Turnstile on</Badge> : <Badge variant="neutral" size="sm">Off</Badge>}
        </div>
        <ol className="list-decimal pl-5 text-xs text-slate-600 space-y-0.5">
          <li>In Cloudflare, open <span className="font-medium">Turnstile → Add widget</span>, enter your website's domain and choose <span className="font-medium">Managed</span>.</li>
          <li>Paste the site key and secret key below and save. The secret key stays encrypted on this server.</li>
          <li>Copy the form code again from step 1: it now includes the check.</li>
        </ol>
        <form className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]" onSubmit={(e) => {
          e.preventDefault();
          void save('captcha', { turnstile: { siteKey: siteKeyInput.trim(), ...(secretKeyInput.trim() ? { secretKey: secretKeyInput.trim() } : {}) } }, 'Turnstile is on. Copy the updated form code to your website.').then(() => setSecretKeyInput(''));
        }}>
          <div>
            <label htmlFor="wf-sitekey" className="block text-xs font-medium text-slate-700">Site key</label>
            <input id="wf-sitekey" value={siteKeyInput} onChange={(e) => setSiteKeyInput(e.target.value)} placeholder="0x4AAAAAAA…" disabled={readOnly} autoComplete="off" spellCheck={false} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400" />
          </div>
          <div>
            <label htmlFor="wf-secretkey" className="block text-xs font-medium text-slate-700">Secret key {config.captcha && <span className="font-normal text-slate-500">(saved {config.captcha.secretHint}; leave empty to keep)</span>}</label>
            <input id="wf-secretkey" type="password" value={secretKeyInput} onChange={(e) => setSecretKeyInput(e.target.value)} placeholder={config.captcha ? '••••••••' : '0x4AAAAAAA…'} disabled={readOnly} autoComplete="new-password" spellCheck={false} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400" />
          </div>
          <div className="flex items-end gap-2">
            <Button type="submit" size="sm" variant="outline" disabled={readOnly || !siteKeyInput.trim() || (!config.captcha && !secretKeyInput.trim())} isLoading={busy === 'captcha'}>Save</Button>
            {config.captcha && <Button type="button" size="sm" variant="ghost" disabled={readOnly} isLoading={busy === 'captcha-off'} onClick={() => save('captcha-off', { turnstile: null }, 'Turnstile is off. Remove the check from your form code.')}>Turn off</Button>}
          </div>
        </form>
        {config.captcha && <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800"><AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />While Turnstile is on, forms without the check are refused. Update the code on your website now.</p>}
      </section>

      {/* Step 3: destinations */}
      <section aria-labelledby="wf-step3" className="bg-white rounded-xl border border-slate-200 p-5 shadow-2xs space-y-4">
        <div>
          <h2 id="wf-step3" className="text-sm font-semibold text-slate-900 flex items-center gap-2"><Inbox className="h-4 w-4 text-slate-500" />3. Choose where submissions go</h2>
          <p className="text-xs text-slate-500">At least one must stay on.</p>
        </div>
        <label className="flex items-start gap-3 rounded-lg border border-slate-200 p-3">
          <input type="checkbox" className="mt-1" checked={config.destinations.obsidian} disabled={readOnly || !!busy} onChange={(e) => save('dest', { destinations: { obsidian: e.target.checked } }, e.target.checked ? 'Submissions will create leads in this CRM.' : 'This CRM will no longer receive submissions.')} />
          <span><span className="block text-sm font-medium text-slate-900">This CRM (Sales Pipeline → Leads)</span>
            <span className="block text-xs text-slate-500">Creates a lead with a follow-up task, or adds to the existing lead if the same email or phone already exists.</span></span>
        </label>

        <div className="rounded-lg border border-slate-200 p-3 space-y-3">
          <label className="flex items-start gap-3">
            <input type="checkbox" className="mt-1" checked={config.destinations.webhook} disabled={readOnly || !!busy || !config.webhook} onChange={(e) => save('dest', { destinations: { webhook: e.target.checked } }, e.target.checked ? 'Webhook delivery is on.' : 'Webhook delivery is off.')} />
            <span><span className="block text-sm font-medium text-slate-900 flex items-center gap-1.5"><Webhook className="h-3.5 w-3.5" />Another CRM or tool (webhook)</span>
              <span className="block text-xs text-slate-500">Sends each submission as signed JSON to a URL you choose: a Zapier, Make or n8n "catch hook", or your CRM's inbound webhook. {config.webhook ? '' : 'Add the URL first.'}</span></span>
          </label>
          <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); void save('webhook', { webhookUrl: webhookInput.trim() || null }, webhookInput.trim() ? 'Webhook URL saved.' : 'Webhook removed.'); }}>
            <label htmlFor="wf-webhook" className="sr-only">Webhook URL</label>
            <input id="wf-webhook" value={webhookInput} onChange={(e) => setWebhookInput(e.target.value)} placeholder="https://hooks.example.com/…" disabled={readOnly} className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400" />
            {/* With no webhook saved there's nothing to remove: the button only saves, and needs a URL. */}
            <Button type="submit" size="sm" variant="outline" disabled={readOnly || (!config.webhook && !webhookInput.trim())} isLoading={busy === 'webhook'}>{webhookInput.trim() || !config.webhook ? 'Save URL' : 'Remove webhook'}</Button>
          </form>
          {config.webhook && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
              <KeyRound className="h-3.5 w-3.5" /> Signing secret <code className="rounded bg-slate-100 px-1.5 py-0.5">{config.webhook.secretHint}</code>
              <Button size="xs" variant="ghost" disabled={readOnly} isLoading={busy === 'rotate'} onClick={async () => { const r = await post<{ webhookSecret: string; config: Config }>('rotate', '/webhook/rotate-secret'); if (r) { setSecret(r.webhookSecret); setConfig(r.config); } }}>New secret</Button>
              <Button size="xs" variant="outline" disabled={readOnly} isLoading={busy === 'test'} leftIcon={<Send className="h-3 w-3" />} onClick={async () => {
                const r = await post<{ result: { ok: boolean; message: string } }>('test', '/webhook/test');
                if (r) setNotice({ tone: r.result.ok ? 'ok' : 'error', text: r.result.ok ? `Test sent: ${r.result.message}` : `Test failed: ${r.result.message}` });
              }}>Send test</Button>
            </div>
          )}
          {secret && (
            <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 space-y-2">
              <p className="font-semibold">Copy your signing secret now. It won't be shown again.</p>
              <div className="flex flex-wrap items-center gap-2"><code className="break-all rounded bg-white px-2 py-1 text-slate-900">{secret}</code><CopyButton text={secret} label="Copy signing secret" /></div>
              <p>Your receiving system uses it to check the X-Obsidian-Signature header (instructions in docs/local-seo/WEB_FORMS.md).</p>
              <Button size="xs" variant="ghost" onClick={() => setSecret(null)}>I've saved it</Button>
            </div>
          )}
        </div>
      </section>

      <TestSubmissionPanel disabled={readOnly} onOpenLeads={onOpenLeads} onSent={() => { void refreshLog(); }}
        send={(body) => api<{ result: TestResult }>('/try', { method: 'POST', body: JSON.stringify(body) })} />

      {/* Log */}
      <section aria-labelledby="wf-log" className="bg-white rounded-xl border border-slate-200 p-5 shadow-2xs space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 id="wf-log" className="text-sm font-semibold text-slate-900">Recent submissions</h2>
            <p className="text-xs text-slate-500">Delivery status for the last 30 days. Names and messages aren't kept here; open the lead in your CRM to see them.</p>
          </div>
          <Button size="xs" variant="outline" isLoading={refreshing} leftIcon={<RefreshCw className="h-3 w-3" />} onClick={() => { void refreshLog(); }}>Refresh</Button>
        </div>
        {!!subs?.length && (
          <div role="group" aria-label="Show submissions" className="flex flex-wrap gap-1 text-xs">
            {([['all', 'All'], ['accepted', 'Received'], ['spam', 'Spam'], ['duplicate', 'Duplicates'], ['problems', 'Delivery problems']] as const).map(([k, label]) => (
              <button key={k} type="button" aria-pressed={logFilter === k} onClick={() => setLogFilter(k)}
                className={`rounded-full border px-2.5 py-1 font-medium ${logFilter === k ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-600 hover:text-slate-900'}`}>
                {label} ({filterSubs(subs, k).length})
              </button>
            ))}
          </div>
        )}
        {!subs?.length ? (
          <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">No submissions yet. Once the form is on your website (or you send a test above), they'll appear here.</div>
        ) : !filterSubs(subs, logFilter).length ? (
          <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">Nothing here for this filter.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-xs">
              <caption className="sr-only">Recent website form submissions</caption>
              <thead><tr className="text-slate-500"><th className="py-2 font-medium">When</th><th className="py-2 font-medium">Form</th><th className="py-2 font-medium">Website</th><th className="py-2 font-medium">Result</th><th className="py-2 font-medium">Delivery</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {filterSubs(subs, logFilter).map((s) => (
                  <tr key={s.id} className="align-top">
                    <td className="py-2 text-slate-700 whitespace-nowrap">{new Date(s.at).toLocaleString()}</td>
                    <td className="py-2 text-slate-900">{s.formName}</td>
                    <td className="py-2 text-slate-600">{s.originHost || '—'}</td>
                    <td className="py-2">{s.status === 'accepted' ? <Badge size="xs" variant="success">Received</Badge> : s.status === 'duplicate' ? <Badge size="xs" variant="neutral">Duplicate (ignored)</Badge> : <span title={s.reason ? REASON[s.reason] : undefined}><Badge size="xs" variant="warning">Spam blocked</Badge></span>}</td>
                    <td className="py-2 space-y-1">{s.deliveries.length ? s.deliveries.map((d) => (
                      <div key={d.adapter} className="flex flex-wrap items-center gap-1.5">
                        <Badge size="xs" variant={d.status === 'delivered' ? 'success' : d.status === 'failed' ? 'danger' : 'info'}>{d.adapter === 'obsidian' ? 'CRM' : 'Webhook'}: {d.status}</Badge>
                        {d.detail && <span className="text-slate-500">{d.detail}{d.attempts > 1 ? ` (${d.attempts} tries)` : ''}</span>}
                      </div>
                    )) : <span className="text-slate-400">{s.status === 'spam' && s.reason ? REASON[s.reason] : 'Not sent'}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Advanced */}
      <details className="rounded-xl border border-slate-200 bg-white p-5">
        <summary className="cursor-pointer text-sm font-semibold text-slate-900">Advanced</summary>
        <div className="mt-3 space-y-2 text-xs text-slate-600">
          <p>If your form is being abused, create a new form address. The old address stops working immediately, so update your website right after.</p>
          <Button size="sm" variant="danger" disabled={readOnly} onClick={() => setConfirmRotate(true)}>Create a new form address…</Button>
          <p className="pt-2">Setup details, the webhook payload and Cloudflare notes: docs/local-seo/WEB_FORMS.md.</p>
        </div>
      </details>

      <Dialog isOpen={confirmRotate} onClose={() => setConfirmRotate(false)} title="Create a new form address?" size="sm"
        description="Forms on your website that use the current address will stop working until you paste the new code."
        footer={<>
          <Button variant="ghost" onClick={() => setConfirmRotate(false)}>Keep current address</Button>
          <Button variant="danger" isLoading={busy === 'rotate-id'} onClick={async () => { const r = await post<{ config: Config; endpoint: string }>('rotate-id', '/form-id/rotate'); setConfirmRotate(false); if (r) { setConfig(r.config); setEndpoint(r.endpoint); setNotice({ tone: 'ok', text: 'New form address created. Update the form code on your website.' }); } }}>Create new address</Button>
        </>}>
        <p className="text-sm text-slate-600">Current address: <code className="break-all">{endpoint}</code></p>
      </Dialog>
    </div>
  );
};
