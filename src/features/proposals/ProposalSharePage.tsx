/**
 * What the client sees when they open a proposal link (/?proposal=<token>). No account needed.
 * Every action goes to /api/proposals/share/<token>; the server computes totals and records the acceptance.
 */
import React, { useEffect, useState } from 'react';
import { Check, FileText, Loader2 } from 'lucide-react';

interface Item { id: string; title: string; description: string; quantity: number; unitPrice: number; optional: boolean; selected: boolean }
interface View {
  number: string; title: string; from: string; client: { name: string; email: string; company: string }; currency: string;
  intro: string; terms: string; validUntil: string | null; status: string; items: Item[]; totals: { total: number };
  signature: { name: string; title: string; signedAt: string } | null; expired: boolean;
}
const money = (c: number, cur: string) => { try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur }).format(c / 100); } catch { return `${(c / 100).toFixed(2)} ${cur}`; } };
const btn = 'inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500';
const input = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500';

export default function ProposalSharePage({ token }: { token: string }) {
  const base = `/api/proposals/share/${encodeURIComponent(token)}`;
  const [p, setP] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', title: '', email: '', agree: false });
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  const payment = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('payment') : null;

  const call = async (path: string, init?: RequestInit) => {
    const res = await fetch(`${base}${path}`, { ...init, headers: { 'Content-Type': 'application/json' } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) throw new Error(data.error || `Something went wrong (${res.status}).`);
    return data;
  };
  useEffect(() => { call('').then((d) => { setP(d.proposal); setForm((f) => ({ ...f, email: d.proposal.client.email, name: d.proposal.client.name })); }).catch((e) => setError(e.message)); }, [token]);

  const act = async (key: string, fn: () => Promise<any>) => {
    setBusy(key); setError(null);
    try { const d = await fn(); if (d?.proposal) setP(d.proposal); return d; }
    catch (e: any) { setError(e.message); }
    finally { setBusy(null); }
  };

  if (!p) {
    return <main className="min-h-screen bg-slate-50 flex items-center justify-center p-6 text-slate-700">{error ? <p role="alert">{error}</p> : <Loader2 className="h-5 w-5 animate-spin" aria-label="Loading" />}</main>;
  }
  const open = p.status !== 'accepted' && p.status !== 'declined' && !p.expired;

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 sm:py-12 text-slate-900">
      <article className="mx-auto max-w-3xl bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sm:p-10 space-y-6">
        <header className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Proposal {p.number} from {p.from}</p>
          <h1 className="text-2xl font-bold">{p.title}</h1>
          <p className="text-sm text-slate-600">For {p.client.name}{p.client.company ? `, ${p.client.company}` : ''}{p.validUntil ? ` · Valid until ${p.validUntil}` : ''}</p>
        </header>

        {payment === 'success' && <p role="status" className="rounded-lg bg-emerald-50 text-emerald-800 px-3 py-2 text-sm">Payment received by Stripe. Thank you.</p>}
        {p.status === 'accepted' && p.signature && <p role="status" className="rounded-lg bg-emerald-50 text-emerald-800 px-3 py-2 text-sm flex items-center gap-2"><Check className="h-4 w-4" /> Accepted by {p.signature.name}{p.signature.title ? `, ${p.signature.title}` : ''} on {new Date(p.signature.signedAt).toLocaleString()}.</p>}
        {p.status === 'declined' && <p role="status" className="rounded-lg bg-slate-100 text-slate-700 px-3 py-2 text-sm">This proposal was declined.</p>}
        {p.expired && <p role="status" className="rounded-lg bg-amber-50 text-amber-800 px-3 py-2 text-sm">This proposal has expired. Ask {p.from} for an updated one.</p>}
        {error && <p role="alert" className="rounded-lg bg-rose-50 text-rose-800 px-3 py-2 text-sm">{error}</p>}

        {p.intro && <p className="whitespace-pre-wrap text-slate-700">{p.intro}</p>}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <thead><tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-200"><th className="py-2 pr-3">Item</th><th className="py-2 pr-3 text-right">Qty</th><th className="py-2 pr-3 text-right">Price</th><th className="py-2 text-right">Amount</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {p.items.map((i) => (
                <tr key={i.id} className={i.optional && !i.selected ? 'text-slate-400' : ''}>
                  <td className="py-3 pr-3">
                    {i.optional ? (
                      <label className="flex items-start gap-2 cursor-pointer">
                        <input type="checkbox" className="mt-1 h-4 w-4 accent-indigo-600" checked={i.selected} disabled={!open || !!busy}
                          onChange={(e) => act(`item-${i.id}`, () => call(`/items/${encodeURIComponent(i.id)}`, { method: 'PATCH', body: JSON.stringify({ selected: e.target.checked }) }))} />
                        <span><span className="font-medium text-slate-900">{i.title}</span> <span className="text-xs text-indigo-700">(optional)</span>{i.description && <span className="block text-xs text-slate-500">{i.description}</span>}</span>
                      </label>
                    ) : (<><span className="font-medium">{i.title}</span>{i.description && <span className="block text-xs text-slate-500">{i.description}</span>}</>)}
                  </td>
                  <td className="py-3 pr-3 text-right tabular-nums">{i.quantity}</td>
                  <td className="py-3 pr-3 text-right tabular-nums">{money(i.unitPrice, p.currency)}</td>
                  <td className="py-3 text-right tabular-nums">{i.optional && !i.selected ? '—' : money(Math.round(i.quantity * i.unitPrice), p.currency)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr className="border-t-2 border-slate-900"><td colSpan={3} className="py-3 text-right font-semibold">Total</td><td className="py-3 text-right font-bold tabular-nums">{money(p.totals.total, p.currency)}</td></tr></tfoot>
          </table>
        </div>

        {p.terms && <section><h2 className="text-sm font-semibold text-slate-900 mb-1">Terms</h2><p className="whitespace-pre-wrap text-sm text-slate-700">{p.terms}</p></section>}

        {open && !declining && (
          <form className="rounded-xl border border-slate-200 p-4 space-y-3" onSubmit={(e) => { e.preventDefault(); act('accept', () => call('/accept', { method: 'POST', body: JSON.stringify(form) })); }}>
            <h2 className="text-base font-semibold">Accept this proposal</h2>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="text-xs font-semibold text-slate-600">Your full name<input id="sign-name" className={input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoComplete="name" required /></label>
              <label className="text-xs font-semibold text-slate-600">Title (optional)<input id="sign-title" className={input} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} autoComplete="organization-title" /></label>
              <label className="text-xs font-semibold text-slate-600">Email<input id="sign-email" type="email" className={input} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="email" required /></label>
            </div>
            <label className="flex items-start gap-2 text-sm text-slate-700 cursor-pointer">
              <input id="sign-agree" type="checkbox" className="mt-0.5 h-4 w-4 accent-indigo-600" checked={form.agree} onChange={(e) => setForm({ ...form, agree: e.target.checked })} />
              I accept this proposal, including the selected items and terms, for {money(p.totals.total, p.currency)}. Typing my name counts as my signature.
            </label>
            <div className="flex flex-wrap gap-2">
              <button type="submit" disabled={!form.agree || !!busy} className={`${btn} bg-indigo-600 text-white hover:bg-indigo-500`}>{busy === 'accept' && <Loader2 className="h-4 w-4 animate-spin" />}Accept and sign</button>
              <button type="button" onClick={() => setDeclining(true)} className={`${btn} border border-slate-300 text-slate-700 hover:bg-slate-50`}>Decline</button>
            </div>
          </form>
        )}
        {open && declining && (
          <form className="rounded-xl border border-slate-200 p-4 space-y-3" onSubmit={(e) => { e.preventDefault(); act('decline', () => call('/decline', { method: 'POST', body: JSON.stringify({ reason }) })); }}>
            <label className="block text-sm font-semibold">Anything you'd like {p.from} to know? (optional)<textarea id="decline-reason" rows={3} className={input} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
            <div className="flex gap-2"><button type="submit" disabled={!!busy} className={`${btn} bg-slate-900 text-white`}>Decline proposal</button><button type="button" onClick={() => setDeclining(false)} className={`${btn} border border-slate-300`}>Back</button></div>
          </form>
        )}

        <footer className="flex flex-wrap gap-2 pt-2">
          {p.status === 'accepted' && payment !== 'success' && (
            <button type="button" disabled={!!busy} onClick={async () => { const d = await act('pay', () => call('/checkout', { method: 'POST' })); if (d?.checkoutUrl) window.location.href = d.checkoutUrl; }} className={`${btn} bg-emerald-600 text-white hover:bg-emerald-500`}>{busy === 'pay' && <Loader2 className="h-4 w-4 animate-spin" />}Pay {money(p.totals.total, p.currency)}</button>
          )}
          <a href={`${base}/document`} target="_blank" rel="noreferrer" className={`${btn} border border-slate-300 text-slate-700 hover:bg-slate-50`}><FileText className="h-4 w-4" /> Printable version</a>
        </footer>
      </article>
    </main>
  );
}
