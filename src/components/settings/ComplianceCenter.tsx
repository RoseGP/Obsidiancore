/**
 * Settings › Privacy & compliance (organization owners and admins; enforced by /api/compliance and
 * /api/admin/audit-log). Sections: data requests, consent, retention, access reviews, incidents, audit log,
 * and a short description of the controls in place.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Download, Loader2, RefreshCw } from 'lucide-react';
import { sapi } from './securityApi';

const card = 'rounded-2xl p-5 bg-neutral-900/40 border border-white/5 space-y-4';
const input = 'w-full text-xs bg-neutral-950/80 border border-white/10 rounded-xl p-2.5 text-white outline-none focus-visible:ring-2 focus-visible:ring-indigo-500';
const btn = 'px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs disabled:opacity-50 disabled:cursor-not-allowed';
const ghost = 'px-3 py-1.5 rounded-lg border border-white/10 text-neutral-200 hover:bg-white/5 font-semibold text-xs disabled:opacity-50';
const th = 'py-2 pr-3 text-left font-semibold text-neutral-400';
const td = 'py-2 pr-3 align-top text-neutral-200';
const fmt = (v?: string | null) => (v ? new Date(v).toLocaleString() : '—');

type Section = 'requests' | 'consent' | 'retention' | 'reviews' | 'incidents' | 'audit' | 'docs';
const SECTIONS: Array<{ id: Section; label: string }> = [
  { id: 'requests', label: 'Data requests' }, { id: 'consent', label: 'Consent' }, { id: 'retention', label: 'Retention' },
  { id: 'reviews', label: 'Access reviews' }, { id: 'incidents', label: 'Incidents' }, { id: 'audit', label: 'Audit log' }, { id: 'docs', label: 'Controls' },
];

function useLoad<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => { try { setData(await sapi<T>(path)); setError(null); } catch (e: any) { setError(e.status === 403 ? 'Only organization owners and admins can open this.' : e.message); } }, [path]);
  useEffect(() => { void load(); }, [load]);
  return { data, error, load };
}

function Status({ error, ok }: { error?: string | null; ok?: string | null }) {
  if (error) return <p role="alert" className="text-xs text-rose-300">{error}</p>;
  if (ok) return <p role="status" className="text-xs text-emerald-300">{ok}</p>;
  return null;
}

function saveJson(name: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------- Data requests ----------------
function Requests() {
  const { data, error, load } = useLoad<{ requests: any[] }>('/api/compliance/requests');
  const [form, setForm] = useState({ type: 'access', subjectEmail: '', details: '', field: 'name', value: '' });
  const [msg, setMsg] = useState<{ error?: string; ok?: string }>({});
  const [preview, setPreview] = useState<Record<string, any>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const create = async (e: React.FormEvent) => {
    e.preventDefault(); setMsg({});
    try {
      const body: any = { type: form.type, subjectEmail: form.subjectEmail, details: form.details };
      if (form.type === 'correction') body.corrections = { [form.field]: form.value };
      await sapi('/api/compliance/requests', { method: 'POST', body: JSON.stringify(body) });
      setForm({ ...form, subjectEmail: '', details: '', value: '' }); setMsg({ ok: 'Request logged. Review the preview, then approve it.' }); void load();
    } catch (err: any) { setMsg({ error: err.message }); }
  };
  const act = async (id: string, what: 'preview' | 'approve' | 'reject' | 'execute', type?: string) => {
    if (what === 'execute' && type === 'deletion' && !window.confirm('Remove this person’s personal data from every record? This can’t be undone. Business records (deals, invoice amounts) are kept without their details.')) return;
    if (what === 'reject' && !window.confirm('Reject this request?')) return;
    setBusy(id + what); setMsg({});
    try {
      if (what === 'preview') { const r = await sapi<any>(`/api/compliance/requests/${id}/preview`); setPreview((p) => ({ ...p, [id]: r.preview })); }
      else {
        const r = await sapi<any>(`/api/compliance/requests/${id}/${what}`, { method: 'POST', body: '{}' });
        if (r.bundle) saveJson(`data-export-${id}.json`, r.bundle);
        setMsg({ ok: what === 'execute' ? (r.bundle ? 'Export downloaded. Send it to the person through a secure channel.' : 'Done.') : `Request ${what === 'approve' ? 'approved' : 'rejected'}.` });
        void load();
      }
    } catch (err: any) { setMsg({ error: err.message }); }
    finally { setBusy(null); }
  };

  return (
    <div className="space-y-4">
      <form onSubmit={create} className={card}>
        <h4 className="text-sm font-bold text-white">Log a request</h4>
        <p className="text-xs text-neutral-400">When someone asks to see, take a copy of, correct or delete their data. Verify who they are first. Target: answer within 30 days (GDPR; CCPA allows 45).</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="text-xs text-neutral-300">Type
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className={`${input} mt-1`}>
              <option value="access">See their data (access)</option><option value="export">Copy of their data (portability)</option>
              <option value="correction">Correct their data</option><option value="deletion">Delete their data</option>
            </select>
          </label>
          <label className="text-xs text-neutral-300 sm:col-span-2">Their email address
            <input type="email" required value={form.subjectEmail} onChange={(e) => setForm({ ...form, subjectEmail: e.target.value })} className={`${input} mt-1`} />
          </label>
        </div>
        {form.type === 'correction' && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="text-xs text-neutral-300">Field
              <select value={form.field} onChange={(e) => setForm({ ...form, field: e.target.value })} className={`${input} mt-1`}>
                {['name', 'email', 'phone', 'company', 'title'].map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </label>
            <label className="text-xs text-neutral-300 sm:col-span-2">Correct value
              <input required value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} className={`${input} mt-1`} />
            </label>
          </div>
        )}
        <label className="text-xs text-neutral-300 block">Notes (how it was received, identity check)
          <textarea value={form.details} onChange={(e) => setForm({ ...form, details: e.target.value })} rows={2} className={`${input} mt-1`} />
        </label>
        <div className="flex justify-end"><button type="submit" className={btn}>Log request</button></div>
        <Status error={msg.error} ok={msg.ok} />
      </form>

      <div className={card}>
        <div className="flex items-center justify-between"><h4 className="text-sm font-bold text-white">Requests</h4><button type="button" onClick={() => void load()} className={ghost} aria-label="Refresh"><RefreshCw size={13} /></button></div>
        {error && <Status error={error} />}
        {!data && !error && <p className="text-xs text-neutral-400">Loading…</p>}
        {data && !data.requests.length && <p className="text-xs text-neutral-400">No requests yet.</p>}
        <ul className="space-y-3">
          {data?.requests.map((r) => (
            <li key={r.id} className="p-3 rounded-xl bg-neutral-950/40 border border-white/5 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="text-white font-semibold capitalize">{r.type} · {r.subjectEmail}</span>
                <span className="text-neutral-400">{r.status} · logged {fmt(r.requestedAt)} · due {fmt(r.dueBy)}</span>
              </div>
              {preview[r.id] && (
                <p className="text-[11px] text-neutral-300">
                  {preview[r.id].fields ? `Will change ${preview[r.id].fields.join(', ')} on ${preview[r.id].leads} lead(s) and ${preview[r.id].contacts} contact(s).`
                    : `Found: ${Object.entries(preview[r.id].counts || {}).filter(([, n]) => Number(n) > 0).map(([k, n]) => `${n} ${k}`).join(', ') || 'nothing'}.`}
                </p>
              )}
              {r.result?.counts && r.status === 'completed' && <p className="text-[11px] text-emerald-300">Completed {fmt(r.completedAt)}.</p>}
              <div className="flex flex-wrap gap-2">
                {r.status !== 'completed' && r.status !== 'rejected' && <button type="button" className={ghost} disabled={!!busy} onClick={() => act(r.id, 'preview')}>{busy === r.id + 'preview' ? <Loader2 size={12} className="animate-spin" /> : 'Preview'}</button>}
                {r.status === 'requested' && <><button type="button" className={ghost} disabled={!!busy} onClick={() => act(r.id, 'approve')}>Approve</button><button type="button" className={ghost} disabled={!!busy} onClick={() => act(r.id, 'reject')}>Reject</button></>}
                {(r.status === 'approved' || (r.status === 'completed' && (r.type === 'access' || r.type === 'export'))) && (
                  <button type="button" className={btn} disabled={!!busy} onClick={() => act(r.id, 'execute', r.type)}>
                    {r.type === 'deletion' ? 'Delete their data' : r.type === 'correction' ? 'Apply correction' : <span className="inline-flex items-center gap-1"><Download size={12} /> Download their data</span>}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ---------------- Consent ----------------
function Consent() {
  const [email, setEmail] = useState('');
  const [q, setQ] = useState('');
  const { data, error, load } = useLoad<{ consents: any[]; current?: Record<string, string>; purposes: string[] }>(`/api/compliance/consents${q ? `?email=${encodeURIComponent(q)}` : ''}`);
  const [form, setForm] = useState({ email: '', purpose: 'marketing_email', status: 'granted', source: 'manual' });
  const [msg, setMsg] = useState<{ error?: string; ok?: string }>({});
  const record = async (e: React.FormEvent) => {
    e.preventDefault(); setMsg({});
    try { await sapi('/api/compliance/consents', { method: 'POST', body: JSON.stringify(form) }); setMsg({ ok: 'Recorded.' }); void load(); }
    catch (err: any) { setMsg({ error: err.message }); }
  };
  return (
    <div className="space-y-4">
      <form onSubmit={record} className={card}>
        <h4 className="text-sm font-bold text-white">Record consent</h4>
        <p className="text-xs text-neutral-400">Website forms record consent automatically when they send it. Use this for consent given by phone, email or in person.</p>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <input aria-label="Email" type="email" required placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={`${input} sm:col-span-2`} />
          <select aria-label="Purpose" value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} className={input}>
            {(data?.purposes || ['marketing_email', 'sms', 'phone_calls', 'analytics', 'data_processing', 'meeting_recording', 'other']).map((p) => <option key={p} value={p}>{p.replace(/_/g, ' ')}</option>)}
          </select>
          <select aria-label="Status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className={input}>
            <option value="granted">Granted</option><option value="withdrawn">Withdrawn</option>
          </select>
        </div>
        <input aria-label="Source" placeholder="Source (e.g. phone call 12 May)" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} className={input} />
        <div className="flex justify-end"><button type="submit" className={btn}>Record</button></div>
        <Status error={msg.error} ok={msg.ok} />
      </form>
      <div className={card}>
        <form onSubmit={(e) => { e.preventDefault(); setQ(email.trim()); }} className="flex gap-2">
          <input aria-label="Look up an email" type="email" placeholder="Look up an email" value={email} onChange={(e) => setEmail(e.target.value)} className={input} />
          <button type="submit" className={ghost}>Look up</button>
          {q && <button type="button" className={ghost} onClick={() => { setQ(''); setEmail(''); }}>All</button>}
        </form>
        {error && <Status error={error} />}
        {data?.current && <p className="text-xs text-neutral-200">Current: {Object.entries(data.current).map(([p, s]) => `${p.replace(/_/g, ' ')} ${s}`).join(' · ') || 'no consent recorded'}</p>}
        <div className="overflow-x-auto"><table className="w-full min-w-[520px] text-xs">
          <thead><tr><th className={th}>When</th><th className={th}>Email</th><th className={th}>Purpose</th><th className={th}>Status</th><th className={th}>Source</th></tr></thead>
          <tbody>{data?.consents.map((c) => <tr key={c.id} className="border-t border-white/5"><td className={td}>{fmt(c.at)}</td><td className={td}>{c.email || '(removed)'}</td><td className={td}>{c.purpose.replace(/_/g, ' ')}</td><td className={td}>{c.status}</td><td className={td}>{c.source}</td></tr>)}</tbody>
        </table></div>
        {data && !data.consents.length && <p className="text-xs text-neutral-400">No consent records{q ? ' for this email' : ''}.</p>}
      </div>
    </div>
  );
}

// ---------------- Retention ----------------
function Retention() {
  const { data, error, load } = useLoad<{ types: any[]; policies: Record<string, any>; lastRun: any }>('/api/compliance/retention');
  const [draft, setDraft] = useState<Record<string, any>>({});
  const [run, setRun] = useState<any>(null);
  const [msg, setMsg] = useState<{ error?: string; ok?: string }>({});
  useEffect(() => { if (data) setDraft(data.policies || {}); }, [data]);
  if (error) return <div className={card}><Status error={error} /></div>;
  if (!data) return <div className={card}><p className="text-xs text-neutral-400">Loading…</p></div>;
  const save = async () => {
    setMsg({});
    try { await sapi('/api/compliance/retention', { method: 'PUT', body: JSON.stringify({ policies: draft }) }); setMsg({ ok: 'Saved.' }); void load(); }
    catch (e: any) { setMsg({ error: e.message }); }
  };
  const go = async (apply: boolean) => {
    if (apply && !window.confirm('Apply the retention rules now? Matching records are archived or have their personal details removed.')) return;
    setMsg({});
    try { const r = await sapi<any>('/api/compliance/retention/run', { method: 'POST', body: JSON.stringify({ apply }) }); setRun(r.run); setMsg({ ok: apply ? 'Applied.' : 'Preview ready (nothing changed).' }); }
    catch (e: any) { setMsg({ error: e.message }); }
  };
  return (
    <div className={card}>
      <h4 className="text-sm font-bold text-white">How long data is kept</h4>
      <p className="text-xs text-neutral-400">Nothing is deleted: “archive” marks records as archived, “anonymize” removes personal details and keeps the record. Rules only run automatically if you tick “Apply automatically”; otherwise the daily check just counts what would change.</p>
      <div className="space-y-2">
        {data.types.map((t) => {
          const p = draft[t.id] || { enabled: false, days: Math.max(t.minDays, 365), action: t.actions[0], autoApply: false };
          const set = (patch: any) => setDraft({ ...draft, [t.id]: { ...p, ...patch } });
          return (
            <div key={t.id} className="grid grid-cols-2 sm:grid-cols-5 gap-2 items-center p-2.5 rounded-xl bg-neutral-950/40 border border-white/5 text-xs">
              <label className="col-span-2 flex items-center gap-2 text-neutral-200"><input type="checkbox" checked={!!p.enabled} onChange={(e) => set({ enabled: e.target.checked })} /> {t.label}</label>
              <label className="flex items-center gap-1 text-neutral-400">after <input type="number" min={t.minDays} value={p.days} onChange={(e) => set({ days: Number(e.target.value) })} className={`${input} w-20 p-1.5`} /> days</label>
              <select aria-label={`${t.label} action`} value={p.action} onChange={(e) => set({ action: e.target.value })} className={`${input} p-1.5`}>{t.actions.map((a: string) => <option key={a} value={a}>{a}</option>)}</select>
              <label className="flex items-center gap-2 text-neutral-400"><input type="checkbox" checked={!!p.autoApply} onChange={(e) => set({ autoApply: e.target.checked })} /> Apply automatically</label>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={() => go(false)} className={ghost}>Preview</button>
        <button type="button" onClick={() => go(true)} className={ghost}>Apply now</button>
        <button type="button" onClick={save} className={btn}>Save rules</button>
      </div>
      <Status error={msg.error} ok={msg.ok} />
      {(run || data.lastRun) && (
        <div className="text-xs text-neutral-300 space-y-1">
          <p className="text-neutral-400">{run ? 'This run' : 'Last check'}: {fmt((run || data.lastRun).at)}</p>
          {(run || data.lastRun).results.map((r: any) => <p key={r.type}>{r.label}: {r.matched} past the limit{r.applied ? `, ${r.applied} ${r.action}d` : ''}</p>)}
        </div>
      )}
    </div>
  );
}

// ---------------- Access reviews ----------------
function Reviews() {
  const { data, error, load } = useLoad<{ members: any[]; reviews: any[] }>('/api/compliance/access-reviews');
  const [notes, setNotes] = useState('');
  const [msg, setMsg] = useState<{ error?: string; ok?: string }>({});
  const complete = async () => {
    setMsg({});
    try { await sapi('/api/compliance/access-reviews', { method: 'POST', body: JSON.stringify({ notes }) }); setNotes(''); setMsg({ ok: 'Review recorded.' }); void load(); }
    catch (e: any) { setMsg({ error: e.message }); }
  };
  if (error) return <div className={card}><Status error={error} /></div>;
  return (
    <div className={card}>
      <h4 className="text-sm font-bold text-white">Who has access</h4>
      <p className="text-xs text-neutral-400">Check that everyone still needs their access and role (SOC 2 suggests every quarter). Change roles or remove people in Organization & plan.</p>
      <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-xs">
        <thead><tr><th className={th}>Member</th><th className={th}>Role</th><th className={th}>Last active</th><th className={th}>Two-step at last sign-in</th></tr></thead>
        <tbody>{data?.members.map((m) => <tr key={m.userId} className="border-t border-white/5"><td className={td}>{m.name || m.email || m.userId}<div className="text-neutral-500">{m.email}</div></td><td className={td}>{m.role}</td><td className={td}>{fmt(m.lastActiveAt)}</td><td className={td}>{m.lastSignInMfa === null ? 'Not seen yet' : m.lastSignInMfa ? 'Yes' : 'No'}</td></tr>)}</tbody>
      </table></div>
      <textarea aria-label="Review notes" placeholder="Notes (what you checked, changes made)" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={input} />
      <div className="flex justify-end"><button type="button" onClick={complete} className={btn}>Mark review complete</button></div>
      <Status error={msg.error} ok={msg.ok} />
      {!!data?.reviews.length && <div className="text-xs text-neutral-300 space-y-1">{data.reviews.slice(0, 5).map((r) => <p key={r.id}>{fmt(r.completedAt)} · {r.members.length} members{r.notes ? ` · ${r.notes}` : ''}</p>)}</div>}
    </div>
  );
}

// ---------------- Incidents ----------------
function Incidents() {
  const { data, error, load } = useLoad<{ incidents: any[] }>('/api/compliance/incidents');
  const [form, setForm] = useState({ title: '', severity: 'medium', description: '', personalDataInvolved: false });
  const [msg, setMsg] = useState<{ error?: string; ok?: string }>({});
  const create = async (e: React.FormEvent) => {
    e.preventDefault(); setMsg({});
    try { await sapi('/api/compliance/incidents', { method: 'POST', body: JSON.stringify(form) }); setForm({ title: '', severity: 'medium', description: '', personalDataInvolved: false }); setMsg({ ok: 'Incident recorded.' }); void load(); }
    catch (err: any) { setMsg({ error: err.message }); }
  };
  const setStatus = async (id: string, status: string) => {
    try { await sapi(`/api/compliance/incidents/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }); void load(); }
    catch (err: any) { setMsg({ error: err.message }); }
  };
  return (
    <div className="space-y-4">
      <form onSubmit={create} className={card}>
        <h4 className="text-sm font-bold text-white">Record a security incident</h4>
        <p className="text-xs text-neutral-400">If personal data is involved, GDPR requires telling the supervisory authority within 72 hours. See docs/compliance/INCIDENT_RESPONSE.md.</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <input aria-label="Title" required placeholder="What happened" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className={`${input} sm:col-span-2`} />
          <select aria-label="Severity" value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })} className={input}>{['low', 'medium', 'high', 'critical'].map((s) => <option key={s} value={s}>{s}</option>)}</select>
        </div>
        <textarea aria-label="Details" placeholder="Details" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={input} />
        <label className="flex items-center gap-2 text-xs text-neutral-300"><input type="checkbox" checked={form.personalDataInvolved} onChange={(e) => setForm({ ...form, personalDataInvolved: e.target.checked })} /> Personal data involved</label>
        <div className="flex justify-end"><button type="submit" className={btn}>Record incident</button></div>
        <Status error={msg.error} ok={msg.ok} />
      </form>
      <div className={card}>
        {error && <Status error={error} />}
        {data && !data.incidents.length && <p className="text-xs text-neutral-400">No incidents recorded.</p>}
        <ul className="space-y-2">{data?.incidents.map((i) => (
          <li key={i.id} className="p-3 rounded-xl bg-neutral-950/40 border border-white/5 text-xs flex flex-wrap items-center justify-between gap-2">
            <span className="text-white"><strong>{i.title}</strong> <span className="text-neutral-400">· {i.severity} · detected {fmt(i.detectedAt)}{i.personalDataInvolved ? ' · personal data' : ''}</span></span>
            <select aria-label={`Status of ${i.title}`} value={i.status} onChange={(e) => setStatus(i.id, e.target.value)} className={`${input} w-auto p-1.5`}>{['open', 'investigating', 'contained', 'resolved', 'closed'].map((s) => <option key={s} value={s}>{s}</option>)}</select>
          </li>
        ))}</ul>
      </div>
    </div>
  );
}

// ---------------- Audit log ----------------
function Audit() {
  const [action, setAction] = useState('');
  const [entries, setEntries] = useState<any[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async (before?: string) => {
    try {
      const qs = new URLSearchParams({ limit: '50', ...(action ? { action } : {}), ...(before ? { before } : {}) });
      const r = await sapi<any>(`/api/admin/audit-log?${qs}`);
      setEntries((cur) => (before && cur ? [...cur, ...r.entries] : r.entries)); setNext(r.nextBefore); setError(null);
    } catch (e: any) { setError(e.status === 403 ? 'Only organization owners and admins can read the audit log.' : e.message); }
  }, [action]);
  useEffect(() => { void load(); }, [load]);
  const download = async () => {
    try {
      const res = await fetch(`/api/admin/audit-log?format=csv${action ? `&action=${encodeURIComponent(action)}` : ''}`);
      if (!res.ok) throw new Error('The download failed.');
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a'); a.href = url; a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e: any) { setError(e.message); }
  };
  return (
    <div className={card}>
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <h4 className="text-sm font-bold text-white">Audit log</h4>
        <div className="flex gap-2">
          <input aria-label="Filter by action" placeholder="Action, e.g. member.role_changed" value={action} onChange={(e) => setAction(e.target.value.trim())} className={`${input} w-56 p-2`} />
          <button type="button" onClick={download} className={ghost}><span className="inline-flex items-center gap-1"><Download size={12} /> CSV</span></button>
        </div>
      </div>
      <p className="text-xs text-neutral-400">Security-relevant actions in this organization. Entries can’t be edited or deleted. Secrets and message text are never recorded.</p>
      {error && <Status error={error} />}
      <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-xs">
        <thead><tr><th className={th}>When</th><th className={th}>Who</th><th className={th}>Action</th><th className={th}>What</th><th className={th}>Details</th></tr></thead>
        <tbody>{entries?.map((e) => (
          <tr key={e.id} className="border-t border-white/5">
            <td className={td}>{fmt(e.at)}</td><td className={td}>{e.actorEmail || e.actorId}</td><td className={`${td} font-mono`}>{e.action}</td>
            <td className={td}>{e.target?.type}{e.target?.label ? `: ${e.target.label}` : ''}</td>
            <td className={`${td} text-neutral-400`}>{Object.entries(e.meta || {}).map(([k, v]) => `${k}: ${v}`).join(', ')}</td>
          </tr>
        ))}</tbody>
      </table></div>
      {entries && !entries.length && <p className="text-xs text-neutral-400">No entries{action ? ' for this action' : ''}.</p>}
      {next && <button type="button" onClick={() => load(next)} className={ghost}>Load older</button>}
    </div>
  );
}

function Controls() {
  const rows = [
    ['Access control', 'Roles with a server-checked permission table; guests see only meetings they’re invited to.'],
    ['Two-step sign-in', 'Authenticator-app codes through Firebase; admins can require it for everyone.'],
    ['Sessions', 'Sign out on all devices; optional maximum session age and sign-out after inactivity.'],
    ['Audit log', 'Append-only record of role, member, key, export, deletion, privacy and policy changes.'],
    ['Encryption', 'HTTPS in transit; Firestore encrypts data at rest; connected-account tokens are encrypted again by the app.'],
    ['Privacy rights', 'Access, portability, correction and deletion requests with approval and a preview.'],
    ['Consent', 'Recorded per purpose, from forms or manually; kept as proof even after deletion (hashed).'],
    ['Retention', 'Rules per data type: archive or anonymize after a set time; never silent deletion.'],
    ['Incidents', 'Register with severity, status and notification dates.'],
  ];
  return (
    <div className={card}>
      <h4 className="text-sm font-bold text-white">Controls in place</h4>
      <p className="text-xs text-neutral-400">These help you meet GDPR, CCPA/CPRA and SOC 2 requirements; they don’t make you compliant on their own, and this app makes no HIPAA claim. Full details are in docs/compliance/ in the code repository.</p>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3">{rows.map(([k, v]) => <div key={k} className="p-3 rounded-xl bg-neutral-950/40 border border-white/5"><dt className="text-xs font-semibold text-white">{k}</dt><dd className="text-xs text-neutral-400 mt-0.5">{v}</dd></div>)}</dl>
    </div>
  );
}

export default function ComplianceCenter() {
  const [section, setSection] = useState<Section>('requests');
  return (
    <div className="space-y-4">
      <div className="border-b border-white/5 pb-3">
        <h3 className="text-base font-bold text-white">Privacy & compliance</h3>
        <p className="text-xs text-neutral-400 mt-0.5">Data requests, consent, retention, access reviews, incidents and the audit log. Owners and admins only.</p>
      </div>
      <div className="flex gap-1.5 overflow-x-auto" role="tablist" aria-label="Privacy and compliance sections">
        {SECTIONS.map((s) => (
          <button key={s.id} type="button" role="tab" aria-selected={section === s.id} onClick={() => setSection(s.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap ${section === s.id ? 'bg-indigo-600 text-white' : 'bg-white/5 text-neutral-300 hover:bg-white/10'}`}>{s.label}</button>
        ))}
      </div>
      {section === 'requests' && <Requests />}
      {section === 'consent' && <Consent />}
      {section === 'retention' && <Retention />}
      {section === 'reviews' && <Reviews />}
      {section === 'incidents' && <Incidents />}
      {section === 'audit' && <Audit />}
      {section === 'docs' && <Controls />}
    </div>
  );
}
