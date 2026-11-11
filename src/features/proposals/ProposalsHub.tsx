/**
 * Proposals for the team: list, edit line items and terms, send a secure link to the client, follow its status.
 * Everything is stored on the server (/api/proposals), per organization.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Copy, ExternalLink, FileText, Link2, Loader2, Plus, Send, Trash2, X } from 'lucide-react';
import type { CRMContact } from '../../types';

interface Item { id?: string; title: string; description: string; quantity: number; unitPrice: number; optional: boolean; selected?: boolean }
interface Proposal {
  id: string; number: string; title: string; client: { name: string; email: string; company: string }; contactId: string | null;
  currency: string; intro: string; terms: string; validUntil: string | null; items: Item[];
  status: 'draft' | 'sent' | 'viewed' | 'accepted' | 'declined'; shared: boolean; updatedAt: string;
  sentAt: string | null; viewedAt: string | null; decidedAt: string | null; declineReason: string | null;
  signature: { name: string; title: string; email: string; signedAt: string; contentHash: string } | null;
  totals: { required: number; options: number; total: number };
}
type Draft = Omit<Proposal, 'id' | 'number' | 'status' | 'shared' | 'updatedAt' | 'sentAt' | 'viewedAt' | 'decidedAt' | 'declineReason' | 'signature' | 'totals'> & { id?: string };

const blank = (): Draft => ({
  title: '', client: { name: '', email: '', company: '' }, contactId: null, currency: 'USD', intro: '', terms: '', validUntil: null,
  items: [{ title: '', description: '', quantity: 1, unitPrice: 0, optional: false }],
});
const STATUS: Record<Proposal['status'], { label: string; cls: string }> = {
  draft: { label: 'Draft', cls: 'bg-slate-100 text-slate-700' },
  sent: { label: 'Sent', cls: 'bg-sky-50 text-sky-700' },
  viewed: { label: 'Viewed', cls: 'bg-indigo-50 text-indigo-700' },
  accepted: { label: 'Accepted', cls: 'bg-emerald-50 text-emerald-700' },
  declined: { label: 'Declined', cls: 'bg-rose-50 text-rose-700' },
};
const money = (cents: number, currency: string) => { try { return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(cents / 100); } catch { return `${(cents / 100).toFixed(2)} ${currency}`; } };
const input = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500';
const btn = 'inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500';

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`/api/proposals${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) throw new Error(data.error || `Request failed (${res.status}).`);
  return data;
}

export default function ProposalsHub({ contacts = [] }: { contacts?: CRMContact[] }) {
  const [list, setList] = useState<Proposal[] | null>(null);
  const [current, setCurrent] = useState<Proposal | null>(null);
  const [draft, setDraft] = useState<Draft>(blank);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(() => api('').then((d) => setList(d.proposals)).catch((e) => { setList([]); setMsg({ ok: false, text: e.message }); }), []);
  useEffect(() => { load(); }, [load]);

  const open = (p: Proposal | null) => {
    setCurrent(p); setLink(null); setMsg(null);
    setDraft(p ? { id: p.id, title: p.title, client: p.client, contactId: p.contactId, currency: p.currency, intro: p.intro, terms: p.terms, validUntil: p.validUntil, items: p.items } : blank());
  };
  const locked = current?.status === 'accepted' || current?.status === 'declined';
  const total = useMemo(() => draft.items.reduce((t, i) => t + (!i.optional || i.selected ? Math.round((i.quantity || 0) * (i.unitPrice || 0)) : 0), 0), [draft.items]);

  const setItem = (idx: number, patch: Partial<Item>) => setDraft((d) => ({ ...d, items: d.items.map((it, i) => (i === idx ? { ...it, ...patch } : it)) }));
  const pickContact = (id: string) => {
    const c = contacts.find((x) => x.id === id);
    setDraft((d) => ({ ...d, contactId: c ? c.id : null, client: c ? { name: c.name, email: c.email || '', company: c.company || '' } : d.client }));
  };

  const save = async (): Promise<Proposal | null> => {
    setBusy('save'); setMsg(null);
    try {
      const payload = { ...draft, items: draft.items.map(({ id, title, description, quantity, unitPrice, optional }) => ({ ...(id ? { id } : {}), title, description, quantity: Number(quantity) || 1, unitPrice: Math.round(unitPrice), optional })) };
      const d = draft.id ? await api(`/${encodeURIComponent(draft.id)}`, { method: 'PUT', body: JSON.stringify(payload) }) : await api('', { method: 'POST', body: JSON.stringify(payload) });
      setCurrent(d.proposal); setDraft((x) => ({ ...x, id: d.proposal.id, items: d.proposal.items }));
      setMsg({ ok: true, text: 'Saved.' }); load();
      return d.proposal;
    } catch (e: any) { setMsg({ ok: false, text: e.message }); return null; }
    finally { setBusy(null); }
  };

  const share = async () => {
    const saved = locked ? current : await save();
    if (!saved) return;
    setBusy('share');
    try {
      const d = await api(`/${encodeURIComponent(saved.id)}/share`, { method: 'POST' });
      setCurrent(d.proposal); setLink(d.url); setCopied(false);
      setMsg({ ok: true, text: d.note });
      load();
    } catch (e: any) { setMsg({ ok: false, text: e.message }); }
    finally { setBusy(null); }
  };

  const withdraw = async () => {
    if (!current) return;
    setBusy('withdraw');
    try { const d = await api(`/${encodeURIComponent(current.id)}/share`, { method: 'DELETE' }); setCurrent(d.proposal); setLink(null); setMsg({ ok: true, text: 'Link withdrawn: the client can no longer open it.' }); load(); }
    catch (e: any) { setMsg({ ok: false, text: e.message }); } finally { setBusy(null); }
  };

  const remove = async () => {
    if (!current) return;
    setBusy('delete');
    try { await api(`/${encodeURIComponent(current.id)}`, { method: 'DELETE' }); open(null); setMsg({ ok: true, text: 'Proposal deleted.' }); load(); }
    catch (e: any) { setMsg({ ok: false, text: e.message }); } finally { setBusy(null); }
  };

  const viewDocument = async () => {
    if (!current) return;
    try {
      const res = await fetch(`/api/proposals/${encodeURIComponent(current.id)}/document`);
      if (!res.ok) throw new Error(`The document couldn't be opened (${res.status}).`);
      const url = URL.createObjectURL(new Blob([await res.text()], { type: 'text/html' }));
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e: any) { setMsg({ ok: false, text: e.message }); }
  };

  const copy = async () => { if (!link) return; try { await navigator.clipboard.writeText(link); setCopied(true); } catch { setCopied(false); } };

  return (
    <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]" id="proposals-hub">
      {/* List */}
      <aside className="bg-white rounded-2xl border border-slate-200 p-3 space-y-2 h-fit">
        <button type="button" onClick={() => open(null)} className={`${btn} w-full bg-slate-900 text-white hover:bg-black`}><Plus className="h-4 w-4" /> New proposal</button>
        {list === null ? <p className="text-sm text-slate-500 p-2">Loading…</p> : list.length === 0 ? (
          <p className="text-sm text-slate-500 p-2">No proposals yet. Create one, then send the client a secure link to review and accept it.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {list.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => open(p)} className={`w-full text-left px-2 py-2.5 rounded-lg cursor-pointer hover:bg-slate-50 ${current?.id === p.id ? 'bg-slate-50' : ''}`}>
                  <span className="flex items-center justify-between gap-2"><span className="text-sm font-semibold text-slate-900 truncate">{p.title}</span><span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${STATUS[p.status].cls}`}>{STATUS[p.status].label}</span></span>
                  <span className="flex items-center justify-between text-xs text-slate-500"><span className="truncate">{p.number} · {p.client.name}</span><span className="tabular-nums">{money(p.totals.total, p.currency)}</span></span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      {/* Editor */}
      <section className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-6 space-y-5 min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold text-slate-900">{current ? `${current.number} · ${current.title}` : 'New proposal'}</h2>
            {current && <p className="text-xs text-slate-500">
              <span className={`font-semibold px-2 py-0.5 rounded-full ${STATUS[current.status].cls}`}>{STATUS[current.status].label}</span>
              {current.viewedAt && ` · Viewed ${new Date(current.viewedAt).toLocaleString()}`}
              {current.signature && ` · Accepted by ${current.signature.name} on ${new Date(current.signature.signedAt).toLocaleString()}`}
              {current.status === 'declined' && ` · Declined${current.declineReason ? `: “${current.declineReason}”` : ''}`}
            </p>}
          </div>
          {current && (
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={viewDocument} className={`${btn} border border-slate-200 text-slate-700 hover:bg-slate-50`}><FileText className="h-4 w-4" /> Document</button>
              {current.shared && !locked && <button type="button" onClick={withdraw} disabled={!!busy} className={`${btn} border border-slate-200 text-slate-700 hover:bg-slate-50`}><X className="h-4 w-4" /> Withdraw link</button>}
              <button type="button" onClick={remove} disabled={!!busy} className={`${btn} border border-rose-200 text-rose-700 hover:bg-rose-50`}><Trash2 className="h-4 w-4" /> Delete</button>
            </div>
          )}
        </div>

        {msg && <p role={msg.ok ? 'status' : 'alert'} className={`rounded-lg px-3 py-2 text-sm ${msg.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'}`}>{msg.text}</p>}
        {link && (
          <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3 flex flex-wrap items-center gap-2">
            <Link2 className="h-4 w-4 text-indigo-600" />
            <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Client link" className={`${input} flex-1 min-w-0 font-mono text-xs`} />
            <button type="button" onClick={copy} className={`${btn} bg-indigo-600 text-white hover:bg-indigo-500`}>{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{copied ? 'Copied' : 'Copy'}</button>
            <a href={link} target="_blank" rel="noreferrer" className={`${btn} border border-indigo-200 text-indigo-700 hover:bg-white`}><ExternalLink className="h-4 w-4" /> Preview</a>
          </div>
        )}

        <fieldset disabled={locked} className="space-y-5 disabled:opacity-70">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold text-slate-600 sm:col-span-2">Title<input id="prop-title" className={input} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="e.g. Website redesign" /></label>
            {contacts.length > 0 && (
              <label className="text-xs font-semibold text-slate-600 sm:col-span-2">From your contacts
                <select id="prop-contact" className={input} value={draft.contactId ?? ''} onChange={(e) => pickContact(e.target.value)}>
                  <option value="">Choose a contact (optional)</option>
                  {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}{c.company ? ` · ${c.company}` : ''}</option>)}
                </select>
              </label>
            )}
            <label className="text-xs font-semibold text-slate-600">Client name<input id="prop-client-name" className={input} value={draft.client.name} onChange={(e) => setDraft({ ...draft, client: { ...draft.client, name: e.target.value } })} /></label>
            <label className="text-xs font-semibold text-slate-600">Client email<input id="prop-client-email" type="email" className={input} value={draft.client.email} onChange={(e) => setDraft({ ...draft, client: { ...draft.client, email: e.target.value } })} /></label>
            <label className="text-xs font-semibold text-slate-600">Company<input id="prop-client-company" className={input} value={draft.client.company} onChange={(e) => setDraft({ ...draft, client: { ...draft.client, company: e.target.value } })} /></label>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs font-semibold text-slate-600">Currency<input id="prop-currency" className={input} maxLength={3} value={draft.currency} onChange={(e) => setDraft({ ...draft, currency: e.target.value.toUpperCase() })} /></label>
              <label className="text-xs font-semibold text-slate-600">Valid until<input id="prop-valid" type="date" className={input} value={draft.validUntil ?? ''} onChange={(e) => setDraft({ ...draft, validUntil: e.target.value || null })} /></label>
            </div>
            <label className="text-xs font-semibold text-slate-600 sm:col-span-2">Introduction<textarea id="prop-intro" rows={3} className={input} value={draft.intro} onChange={(e) => setDraft({ ...draft, intro: e.target.value })} placeholder="A short note to the client" /></label>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold text-slate-600">Line items</p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead><tr className="text-left text-[11px] uppercase tracking-wide text-slate-500"><th className="py-1.5 pr-2">Item</th><th className="py-1.5 pr-2 w-20">Qty</th><th className="py-1.5 pr-2 w-32">Unit price</th><th className="py-1.5 pr-2 w-20">Optional</th><th className="py-1.5 w-28 text-right">Amount</th><th className="w-8" /></tr></thead>
                <tbody className="align-top">
                  {draft.items.map((it, idx) => (
                    <tr key={idx} className="border-t border-slate-100">
                      <td className="py-2 pr-2 space-y-1">
                        <input aria-label={`Item ${idx + 1} title`} className={input} value={it.title} onChange={(e) => setItem(idx, { title: e.target.value })} placeholder="What you'll deliver" />
                        <input aria-label={`Item ${idx + 1} description`} className={`${input} text-xs`} value={it.description} onChange={(e) => setItem(idx, { description: e.target.value })} placeholder="Details (optional)" />
                      </td>
                      <td className="py-2 pr-2"><input aria-label={`Item ${idx + 1} quantity`} type="number" min={0} step="any" className={input} value={it.quantity} onChange={(e) => setItem(idx, { quantity: Number(e.target.value) })} /></td>
                      <td className="py-2 pr-2"><input aria-label={`Item ${idx + 1} unit price`} type="number" min={0} step="0.01" className={input} value={it.unitPrice / 100} onChange={(e) => setItem(idx, { unitPrice: Math.round(Number(e.target.value) * 100) })} /></td>
                      <td className="py-2 pr-2 text-center"><input aria-label={`Item ${idx + 1} optional`} type="checkbox" className="mt-3 h-4 w-4 accent-indigo-600" checked={it.optional} onChange={(e) => setItem(idx, { optional: e.target.checked })} /></td>
                      <td className="py-2 text-right tabular-nums pt-4">{money(Math.round((it.quantity || 0) * it.unitPrice), draft.currency)}</td>
                      <td className="py-2 text-right"><button type="button" aria-label={`Remove item ${idx + 1}`} disabled={draft.items.length === 1} onClick={() => setDraft({ ...draft, items: draft.items.filter((_, i) => i !== idx) })} className="mt-2 p-1.5 rounded text-slate-400 hover:text-rose-600 cursor-pointer disabled:opacity-30"><Trash2 className="h-4 w-4" /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button type="button" onClick={() => setDraft({ ...draft, items: [...draft.items, { title: '', description: '', quantity: 1, unitPrice: 0, optional: false }] })} className={`${btn} border border-slate-200 text-slate-700 hover:bg-slate-50`}><Plus className="h-4 w-4" /> Add item</button>
              <p className="text-sm text-slate-700">Total (excluding unchosen options): <b className="tabular-nums">{money(total, draft.currency)}</b></p>
            </div>
          </div>

          <label className="block text-xs font-semibold text-slate-600">Terms<textarea id="prop-terms" rows={4} className={input} value={draft.terms} onChange={(e) => setDraft({ ...draft, terms: e.target.value })} placeholder="Payment schedule, timeline, what's included" /></label>
        </fieldset>

        <div className="flex flex-wrap gap-2 justify-end">
          {!locked && <button type="button" onClick={save} disabled={!!busy} className={`${btn} border border-slate-200 text-slate-800 hover:bg-slate-50`}>{busy === 'save' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Save draft</button>}
          {!locked && <button type="button" onClick={share} disabled={!!busy} className={`${btn} bg-indigo-600 text-white hover:bg-indigo-500`}>{busy === 'share' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}{current?.shared ? 'Create a new client link' : 'Save and get client link'}</button>}
        </div>
        <p className="text-xs text-slate-500">The client opens the link without an account, chooses any optional items, and accepts with their typed name (recorded with the date, their browser and a fingerprint of exactly what they accepted). No email is sent automatically: send the link yourself.</p>
      </section>
    </div>
  );
}
