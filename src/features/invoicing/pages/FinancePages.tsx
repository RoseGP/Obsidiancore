import React, { useMemo, useState } from 'react';
import { ArrowLeftRight, CreditCard, FileDown, Landmark, PiggyBank, Search } from 'lucide-react';
import { formatMoney, sumMinor, toMinor } from '../domain/money';
import { agingBuckets } from '../domain/metrics';
import { formatDate } from '../domain/status';
import { PAYMENT_METHOD_LABELS, type Payment, type PaymentMethod } from '../domain/types';
import { downloadReceiptPdf } from '../services/pdf';
import { useBillingData } from '../state/BillingStore';
import { useNav, useQuickActions } from '../state/navigation';
import { DataTable, type Column } from '../ui/data';
import { Badge, Button, EmptyState, SectionCard, Select } from '../ui/primitives';

const PAY_STATUS_LABEL = { confirmed: 'Confirmed', pending: 'Pending', failed: 'Failed' } as const;

export function TransactionsPage() {
  const { data, viewById, status } = useBillingData();
  const { navigate } = useNav();
  const { openPaymentDialog } = useQuickActions();
  const [q, setQ] = useState('');
  const [method, setMethod] = useState<'all' | PaymentMethod>('all');
  const [payStatus, setPayStatus] = useState<'all' | Payment['status']>('all');
  const currency = data.settings.defaultCurrency;

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return data.payments.filter((p) => {
      const inv = viewById.get(p.invoiceId)?.invoice;
      if (method !== 'all' && p.method !== method) return false;
      if (payStatus !== 'all' && p.status !== payStatus) return false;
      if (t && ![p.receiptNumber, p.reference, inv?.number ?? '', inv?.billTo.company ?? '', inv?.billTo.name ?? ''].some((s) => s.toLowerCase().includes(t))) return false;
      return true;
    });
  }, [data.payments, viewById, q, method, payStatus]);

  const byMethod = useMemo(() => {
    const map = new Map<PaymentMethod, bigint>();
    for (const p of data.payments) if (p.status === 'confirmed' && p.currency === currency) map.set(p.method, (map.get(p.method) ?? 0n) + (toMinor(p.amount, currency) ?? 0n));
    return [...map.entries()].sort((a, b) => (b[1] > a[1] ? 1 : -1));
  }, [data.payments, currency]);
  const totalConfirmed = sumMinor(byMethod.map(([, v]) => v));

  const balanceAfter = (p: Payment) => {
    const v = viewById.get(p.invoiceId);
    if (!v) return 0n;
    const before = v.payments.filter((x) => x.status === 'confirmed' && (x.date + x.createdAt) <= (p.date + p.createdAt));
    const b = v.totals.total - sumMinor(before.map((x) => toMinor(x.amount, v.invoice.currency) ?? 0n));
    return b < 0n ? 0n : b;
  };

  const columns: Column<Payment>[] = [
    { key: 'date', header: 'Date', sortValue: (p) => p.date, render: (p) => <span className="num">{formatDate(p.date)}</span> },
    { key: 'receipt', header: 'Receipt', sortValue: (p) => p.receiptNumber, render: (p) => <span className="font-semibold">{p.receiptNumber}</span> },
    {
      key: 'invoice', header: 'Invoice', sortValue: (p) => viewById.get(p.invoiceId)?.invoice.number ?? '',
      render: (p) => {
        const inv = viewById.get(p.invoiceId)?.invoice;
        return inv ? (
          <button type="button" className="text-left" style={{ background: 'none', border: 0, padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer' }} onClick={() => navigate({ name: 'invoice-view', id: inv.id })}>
            <span className="block font-medium" style={{ color: 'var(--inv-primary)' }}>{inv.number}</span>
            <span className="inv-faint block text-[12px]">{inv.billTo.company || inv.billTo.name}</span>
          </button>
        ) : '—';
      },
    },
    { key: 'method', header: 'Method', sortValue: (p) => PAYMENT_METHOD_LABELS[p.method], render: (p) => <span className="inv-muted">{PAYMENT_METHOD_LABELS[p.method]}{p.reference ? <span className="inv-faint block text-[12px]">{p.reference}</span> : null}</span>, hideBelow: 'lg' },
    { key: 'status', header: 'Status', sortValue: (p) => p.status, render: (p) => <Badge tone={p.status}>{PAY_STATUS_LABEL[p.status]}</Badge> },
    { key: 'amount', header: 'Amount', align: 'right', sortValue: (p) => toMinor(p.amount, p.currency) ?? 0n, render: (p) => <span className="font-semibold">{formatMoney(toMinor(p.amount, p.currency) ?? 0n, p.currency)}</span> },
    {
      key: 'receiptBtn', header: <span className="sr-only-inv">Receipt</span>, align: 'right', width: 56,
      render: (p) => {
        const inv = viewById.get(p.invoiceId)?.invoice;
        return p.status === 'confirmed' && inv
          ? <Button size="sm" variant="ghost" iconOnly icon={<FileDown size={15} />} aria-label={`Download receipt ${p.receiptNumber}`} onClick={() => { downloadReceiptPdf(p, inv, balanceAfter(p)).catch(() => {}); }} />
          : null;
      },
    },
  ];

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 p-4 @3xl:p-6">
      <div className="grid grid-cols-1 gap-4 @4xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="inv-card" aria-labelledby="inv-tx-title">
          <header className="inv-card-head flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
            <div>
              <h2 id="inv-tx-title" className="inv-h2">Payments received</h2>
              <p className="inv-muted text-[12.5px]">Only confirmed payments reduce invoice balances.</p>
            </div>
            <Button size="sm" variant="primary" icon={<CreditCard size={15} />} onClick={() => openPaymentDialog()}>Record payment</Button>
          </header>
          <div className="flex flex-wrap items-end gap-2 px-4 pt-4 pb-3 @3xl:px-5">
            <div className="relative min-w-[200px] flex-1">
              <Search size={15} className="inv-faint pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" aria-hidden />
              <input type="search" aria-label="Search payments" placeholder="Search receipt, reference, invoice, client" className="inv-input inv-input-sm" style={{ paddingLeft: 32, height: 34 }} value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <Select inputSize="sm" aria-label="Method" containerClassName="w-[160px]" value={method} onChange={(v) => setMethod(v as any)} options={[{ value: 'all', label: 'All methods' }, ...Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => ({ value, label }))]} />
            <Select inputSize="sm" aria-label="Status" containerClassName="w-[150px]" value={payStatus} onChange={(v) => setPayStatus(v as any)} options={[{ value: 'all', label: 'All statuses' }, { value: 'confirmed', label: 'Confirmed' }, { value: 'pending', label: 'Pending' }, { value: 'failed', label: 'Failed' }]} />
          </div>
          <DataTable caption="Payments" rows={rows} columns={columns} getRowId={(p) => p.id} initialSort={{ key: 'date', dir: 'desc' }} loading={status === 'loading'}
            resetKey={`${q}|${method}|${payStatus}`}
            renderMobileRow={(p) => (
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{p.receiptNumber} <span className="inv-muted font-normal">· {viewById.get(p.invoiceId)?.invoice.number}</span></p>
                  <p className="inv-muted text-[12.5px]">{formatDate(p.date)} · {PAYMENT_METHOD_LABELS[p.method]}</p>
                </div>
                <div className="flex flex-col items-end gap-1"><span className="num font-semibold">{formatMoney(toMinor(p.amount, p.currency) ?? 0n, p.currency)}</span><Badge tone={p.status}>{PAY_STATUS_LABEL[p.status]}</Badge></div>
              </div>
            )}
            empty={<EmptyState icon={<ArrowLeftRight size={18} />} title={data.payments.length ? 'No payments match these filters' : 'No payments yet'} body={data.payments.length ? undefined : 'Payments you record against invoices appear here.'} />} />
        </section>

        <SectionCard id="inv-methods" title="By payment method" description={`Confirmed, all time, ${currency}`}>
          {byMethod.length === 0 ? <p className="inv-muted text-[13px]">No confirmed payments yet.</p> : (
            <ul className="space-y-3">
              {byMethod.map(([mth, amt]) => {
                const pct = totalConfirmed > 0n ? Number((amt * 1000n) / totalConfirmed) / 10 : 0;
                return (
                  <li key={mth}>
                    <div className="flex justify-between text-[13px]"><span>{PAYMENT_METHOD_LABELS[mth]}</span><span className="num font-semibold">{formatMoney(amt, currency)}</span></div>
                    <div className="mt-1.5 h-1.5 rounded-full" style={{ background: 'var(--inv-surface-3)' }} role="img" aria-label={`${pct}% of confirmed payments`}>
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'var(--inv-primary)' }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>
      </div>
    </div>
  );
}

export function WalletPage({ onOpenPaymentProviders }: { onOpenPaymentProviders?: () => void }) {
  const { data } = useBillingData();
  const { navigate } = useNav();
  return (
    <div className="mx-auto max-w-[1000px] space-y-5 p-4 @3xl:p-6">
      <SectionCard id="inv-wallet-methods" title="How clients pay you" description="Shown as payment instructions on every new invoice.">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 flex-none items-center justify-center rounded-lg" style={{ background: 'var(--inv-surface-2)', border: '1px solid var(--inv-border)' }}><Landmark size={18} aria-hidden /></span>
          <pre className="min-w-0 flex-1 whitespace-pre-wrap text-[13px]" style={{ font: 'inherit' }}>{data.settings.paymentInstructions || 'No payment instructions yet.'}</pre>
          <Button size="sm" onClick={() => navigate({ name: 'settings' })}>Edit</Button>
        </div>
      </SectionCard>
      <SectionCard id="inv-wallet-online" title="Online card payments" description="Let clients pay invoices by card through a connected provider.">
        <p className="inv-muted text-[13px]">Card payments are processed by your payment provider, never stored here. An invoice is only marked paid after the provider confirms the charge.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="primary" icon={<CreditCard size={15} />} onClick={() => navigate({ name: 'stripe' })}>Stripe account</Button>
          {onOpenPaymentProviders && <Button onClick={onOpenPaymentProviders}>Other providers (Square)</Button>}
        </div>
      </SectionCard>
    </div>
  );
}

export function BudgetingPage() {
  const { navigate } = useNav();
  return (
    <div className="mx-auto max-w-[900px] p-4 @3xl:p-6">
      <div className="inv-card">
        <EmptyState icon={<PiggyBank size={18} />} title="Budgeting isn’t part of this prototype yet"
          body="Budgets need expense data, which this workspace doesn’t track. Revenue and receivables are in Reports."
          action={<Button onClick={() => navigate({ name: 'reports' })}>Open reports</Button>} />
      </div>
    </div>
  );
}

export function ReportsPage() {
  const { views, data, today } = useBillingData();
  const currency = data.settings.defaultCurrency;
  const buckets = useMemo(() => agingBuckets(views, today, currency), [views, today, currency]);
  const maxBucket = buckets.reduce((a, b) => (b.amount > a ? b.amount : a), 0n);
  const totalOpen = sumMinor(buckets.map((b) => b.amount));

  const byClient = useMemo(() => {
    const map = new Map<string, { name: string; billed: bigint; paid: bigint; open: bigint }>();
    for (const v of views) {
      if (v.status === 'draft' || v.status === 'void' || v.invoice.currency !== currency) continue;
      const key = v.invoice.clientId ?? v.invoice.billTo.email;
      const e = map.get(key) ?? { name: v.invoice.billTo.company || v.invoice.billTo.name, billed: 0n, paid: 0n, open: 0n };
      e.billed += v.totals.total; e.paid += v.totals.amountPaid; e.open += v.totals.balanceDue;
      map.set(key, e);
    }
    return [...map.values()].sort((a, b) => (b.billed > a.billed ? 1 : -1));
  }, [views, currency]);

  const totals = byClient.reduce((a, c) => ({ billed: a.billed + c.billed, paid: a.paid + c.paid }), { billed: 0n, paid: 0n });
  const rate = totals.billed > 0n ? Number((totals.paid * 1000n) / totals.billed) / 10 : 0;
  const m = (v: bigint) => formatMoney(v, currency);

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 p-4 @3xl:p-6">
      <div className="grid grid-cols-1 gap-4 @4xl:grid-cols-2">
        <SectionCard id="inv-aging" title="Receivables aging" description={`${m(totalOpen)} outstanding, grouped by days past due`}>
          <ul className="space-y-3">
            {buckets.map((b, i) => {
              const w = maxBucket > 0n ? Number((b.amount * 1000n) / maxBucket) / 10 : 0;
              return (
                <li key={b.label}>
                  <div className="flex justify-between text-[13px]"><span>{b.label} <span className="inv-faint">· {b.count}</span></span><span className="num font-semibold">{m(b.amount)}</span></div>
                  <div className="mt-1.5 h-2 rounded-full" style={{ background: 'var(--inv-surface-3)' }}>
                    <div className="h-full rounded-full" style={{ width: `${w}%`, background: i === 0 ? 'var(--inv-primary)' : i <= 1 ? 'var(--inv-warning)' : 'var(--inv-danger)' }} />
                  </div>
                </li>
              );
            })}
          </ul>
        </SectionCard>
        <SectionCard id="inv-collect" title="Collection rate" description="Share of everything invoiced that has been paid, all time">
          <p className="num text-[40px] font-semibold leading-none tracking-tight">{rate.toFixed(1)}%</p>
          <p className="inv-muted mt-2 text-[13px]">{m(totals.paid)} collected of {m(totals.billed)} invoiced</p>
          <div className="mt-4 h-2 rounded-full" style={{ background: 'var(--inv-surface-3)' }}><div className="h-full rounded-full" style={{ width: `${rate}%`, background: 'var(--inv-success)' }} /></div>
        </SectionCard>
      </div>
      <SectionCard id="inv-by-client" title="Revenue by client" bodyClassName="p-0">
        {byClient.length === 0 ? <EmptyState title="No invoiced revenue yet" /> : (
          <div className="overflow-x-auto">
            <table className="inv-table">
              <caption className="sr-only-inv">Revenue by client</caption>
              <thead><tr><th scope="col">Client</th><th scope="col" style={{ textAlign: 'right' }}>Invoiced</th><th scope="col" style={{ textAlign: 'right' }}>Paid</th><th scope="col" style={{ textAlign: 'right' }}>Outstanding</th></tr></thead>
              <tbody>
                {byClient.map((c) => (
                  <tr key={c.name}>
                    <td className="font-medium">{c.name}</td>
                    <td className="num" style={{ textAlign: 'right' }}>{m(c.billed)}</td>
                    <td className="num" style={{ textAlign: 'right' }}>{m(c.paid)}</td>
                    <td className="num font-semibold" style={{ textAlign: 'right' }}>{m(c.open)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
