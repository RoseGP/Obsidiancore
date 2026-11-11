/**
 * Billing & Subscription: one page for what the organization pays for and what it bills.
 *   - Subscription: the organization's plan, its limits and plan requests (SubscriptionSettings, moved here from
 *     Settings › Organization & plan so there is one home for it).
 *   - Invoices: the latest invoices from Invoicing (billing/{orgId}), with their real status. When the billing
 *     server can't be reached nothing is listed: the browser-only prototype store is never shown as real data.
 *   - Getting paid: Stripe and Square connections stay in Proposals & Invoices › Payment providers (OAuth
 *     callbacks return there); this page links to them instead of repeating them.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, CreditCard, FileText, Loader2, ReceiptText } from 'lucide-react';
import SubscriptionSettings from '../../components/meetings/SubscriptionSettings';
import { sapi, type PolicyResponse } from '../../components/settings/securityApi';
import { connectBillingRepository } from '../invoicing/services/apiRepository';
import { buildInvoiceView, STATUS_LABELS, todayISO } from '../invoicing/domain/status';
import { formatMoney } from '../invoicing/domain/money';
import type { BillingSnapshot, InvoiceStatus } from '../invoicing/domain/types';
import type { BillingRepository } from '../invoicing/services/repository';

const card = 'rounded-2xl p-6 bg-neutral-900/40 border border-white/5 space-y-4';
const linkBtn = 'inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-white/10 text-xs font-semibold text-neutral-200 hover:bg-white/5 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500';
const TONE: Record<InvoiceStatus, string> = {
  draft: 'bg-neutral-700/40 text-neutral-300', sent: 'bg-sky-500/15 text-sky-300', viewed: 'bg-indigo-500/15 text-indigo-300',
  partially_paid: 'bg-amber-500/15 text-amber-300', paid: 'bg-emerald-500/15 text-emerald-300', overdue: 'bg-rose-500/15 text-rose-300', void: 'bg-neutral-700/40 text-neutral-400',
};

type InvoiceState =
  | { kind: 'loading' }
  | { kind: 'unavailable'; reason: string }
  | { kind: 'ready'; snapshot: BillingSnapshot };

/** Opens Proposals & Invoices on a given tab. */
function openProposals(onNavigate: (view: string) => void, subtab?: 'payment_providers') {
  try {
    const u = new URL(window.location.href);
    if (subtab) u.searchParams.set('subtab', subtab); else u.searchParams.delete('subtab');
    window.history.replaceState(null, '', u.toString());
  } catch { /* ignore */ }
  onNavigate('proposals');
}

/**
 * The latest invoices with their real status. `connect` is injectable for tests; by default it is the
 * Invoicing app's own connection, which falls back to a browser-only prototype store when the server is
 * unavailable. That store is never listed here.
 */
export function InvoicesSummaryCard({ onNavigate, connect = connectBillingRepository }: { onNavigate: (view: string) => void; connect?: () => Promise<Pick<BillingRepository, 'mode' | 'modeReason' | 'load'>> }) {
  const [inv, setInv] = useState<InvoiceState>({ kind: 'loading' });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const repo = await connect();
        if (repo.mode !== 'remote') { if (!cancelled) setInv({ kind: 'unavailable', reason: repo.modeReason }); return; }
        const snapshot = await repo.load();
        if (!cancelled) setInv({ kind: 'ready', snapshot });
      } catch {
        if (!cancelled) setInv({ kind: 'unavailable', reason: 'Invoices couldn’t be loaded. Try again in a moment.' });
      }
    })();
    return () => { cancelled = true; };
  }, [connect]);

  const rows = useMemo(() => {
    if (inv.kind !== 'ready') return [];
    const today = todayISO();
    const clients = new Map(inv.snapshot.clients.map((c: any) => [c.id, c.name || c.company || 'Client']));
    return inv.snapshot.invoices
      .map((i) => ({ i, v: buildInvoiceView(i, inv.snapshot.payments, today) }))
      .sort((a, b) => String(b.i.issueDate).localeCompare(String(a.i.issueDate)))
      .map(({ i, v }) => ({ id: i.id, number: i.number, client: (i.clientId && clients.get(i.clientId)) || 'No client', due: i.dueDate, status: v.status, total: formatMoney(v.totals.total, i.currency), balance: v.totals.balanceDue, currency: i.currency }));
  }, [inv]);
  const summary = useMemo(() => {
    const open = rows.filter((r) => r.status !== 'paid' && r.status !== 'void' && r.status !== 'draft');
    const currencies = [...new Set(open.map((r) => r.currency))];
    const due = currencies.length === 1 ? formatMoney(open.reduce((s, r) => s + r.balance, 0n), currencies[0]) : null;
    return { open: open.length, overdue: rows.filter((r) => r.status === 'overdue').length, due, mixed: currencies.length > 1 };
  }, [rows]);

  return (
    <section className={card} aria-labelledby="billing-invoices">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/5 pb-3">
          <div>
            <h3 id="billing-invoices" className="flex items-center gap-2 text-base font-bold text-white"><ReceiptText size={16} className="text-indigo-400" />Invoices</h3>
            <p className="text-xs text-neutral-400 mt-0.5">The latest invoices from Invoicing, with their current status.</p>
          </div>
          <button type="button" className={linkBtn} onClick={() => openProposals(onNavigate)}><FileText size={14} />Open invoicing<ArrowRight size={14} /></button>
        </div>
        {inv.kind === 'loading' && <p className="flex items-center gap-2 text-xs text-neutral-400"><Loader2 size={14} className="animate-spin" />Loading invoices…</p>}
        {inv.kind === 'unavailable' && <p className="text-xs text-neutral-400">{inv.reason} Invoices appear here once the billing server is available.</p>}
        {inv.kind === 'ready' && (rows.length === 0 ? (
          <p className="text-xs text-neutral-400">No invoices yet. Create one in Invoicing.</p>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="rounded-xl bg-neutral-950/40 border border-white/5 p-3"><p className="text-[11px] text-neutral-500">Open invoices</p><p className="text-lg font-bold text-white tabular-nums">{summary.open}</p></div>
              <div className="rounded-xl bg-neutral-950/40 border border-white/5 p-3"><p className="text-[11px] text-neutral-500">Overdue</p><p className={`text-lg font-bold tabular-nums ${summary.overdue ? 'text-rose-300' : 'text-white'}`}>{summary.overdue}</p></div>
              <div className="rounded-xl bg-neutral-950/40 border border-white/5 p-3"><p className="text-[11px] text-neutral-500">Still to be paid</p><p className="text-lg font-bold text-white tabular-nums">{summary.due ?? (summary.mixed ? 'Several currencies' : '—')}</p></div>
            </div>
            <ul className="divide-y divide-white/5 rounded-xl border border-white/5">
              {rows.slice(0, 8).map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-xs">
                  <span className="min-w-0"><span className="font-semibold text-white">{r.number || 'Draft'}</span> <span className="text-neutral-400">· {r.client} · due {r.due}</span></span>
                  <span className="flex items-center gap-2"><span className="font-semibold text-neutral-200 tabular-nums">{r.total}</span><span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONE[r.status]}`}>{STATUS_LABELS[r.status]}</span></span>
                </li>
              ))}
            </ul>
            {rows.length > 8 && <p className="text-[11px] text-neutral-500">Showing the 8 most recent of {rows.length}. Open invoicing for the rest.</p>}
          </>
        ))}
      </section>

  );
}

export default function BillingSubscriptionView({ onNavigate }: { onNavigate: (view: string) => void }) {
  const [role, setRole] = useState<string | undefined>();
  useEffect(() => { sapi<PolicyResponse>('/api/security/policy').then((r) => setRole(r.me.role)).catch(() => setRole(undefined)); }, []);
  const isAdmin = role === 'OWNER' || role === 'ADMIN';

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6" id="billing-subscription">
      <div className="border-b border-white/5 pb-4">
        <h2 className="font-sans font-bold text-xl text-white tracking-tight">Billing &amp; Subscription</h2>
        <p className="text-xs text-neutral-400 mt-0.5">Your organization’s plan, the invoices you send, and how you get paid.</p>
      </div>

      <SubscriptionSettings isAdmin={isAdmin} />

      <InvoicesSummaryCard onNavigate={onNavigate} />

      <section className={card} aria-labelledby="billing-getting-paid">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 id="billing-getting-paid" className="flex items-center gap-2 text-base font-bold text-white"><CreditCard size={16} className="text-emerald-400" />Getting paid</h3>
            <p className="text-xs text-neutral-400 mt-0.5">Connect Stripe or Square so customers can pay invoices online. Invoices are marked paid when the provider confirms the payment.</p>
          </div>
          <button type="button" className={linkBtn} onClick={() => openProposals(onNavigate, 'payment_providers')}>Payment providers<ArrowRight size={14} /></button>
        </div>
      </section>
    </div>
  );
}
