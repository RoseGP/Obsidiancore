import React, { useMemo, useState } from 'react';
import { Ban, CheckCheck, Copy, CreditCard, Download, FileDown, MoreHorizontal, Pencil, Send } from 'lucide-react';
import { formatMoney, toMinor } from '../domain/money';
import { formatDate, formatDateTime } from '../domain/status';
import { PAYMENT_METHOD_LABELS } from '../domain/types';
import { buildInvoiceDocument } from '../services/invoiceDocument';
import { downloadReceiptPdf } from '../services/pdf';
import { BillingError } from '../services/repository';
import { useBillingData } from '../state/BillingStore';
import { useNav, useQuickActions } from '../state/navigation';
import { ScaledPaper } from '../components/InvoicePreview';
import { SendDialog } from '../components/SendDialog';
import { StripeCollectPanel } from '../components/StripeCollectPanel';
import { canEdit, canRecordPayment, canVoid, useInvoiceActions } from '../components/invoiceActions';
import { ConfirmDialog, Menu, useToast } from '../ui/overlays';
import { Badge, Button, EmptyState, InlineAlert, StatusBadge } from '../ui/primitives';

const DELIVERY_LABEL = { delivered: 'Delivered', failed: 'Failed', not_configured: 'Not sent' } as const;
const PAY_STATUS_LABEL = { confirmed: 'Confirmed', pending: 'Pending', failed: 'Failed' } as const;

function Panel({ title, children, count }: { title: string; children: React.ReactNode; count?: number }) {
  return (
    <section className="inv-card">
      <h2 className="inv-h3 flex items-center gap-2 px-4 pt-4 pb-2">{title}{count !== undefined && <span className="inv-pill">{count}</span>}</h2>
      <div className="px-4 pb-4">{children}</div>
    </section>
  );
}

export function InvoiceViewPage({ id }: { id: string }) {
  const { viewById, markSent, isPending, reload } = useBillingData();
  const { navigate } = useNav();
  const { openPaymentDialog } = useQuickActions();
  const toast = useToast();
  const { downloadPdf, requestVoid, dialogs } = useInvoiceActions();
  const [sendOpen, setSendOpen] = useState(false);
  const [markOpen, setMarkOpen] = useState(false);
  const v = viewById.get(id);
  const doc = useMemo(() => (v ? buildInvoiceDocument(v.invoice, v.totals) : null), [v]);

  if (!v || !doc) {
    return <div className="p-6"><div className="inv-card"><EmptyState title="This invoice couldn’t be found" body="It may have been removed, or the link is out of date." action={<Button onClick={() => navigate({ name: 'invoices' })}>Back to invoices</Button>} /></div></div>;
  }
  const inv = v.invoice;
  const m = (x: bigint) => formatMoney(x, inv.currency);
  const lastDelivery = inv.deliveries[inv.deliveries.length - 1];

  // Running balance after each confirmed payment, for receipts.
  const ordered = [...v.payments].sort((a, b) => (a.date + a.createdAt).localeCompare(b.date + b.createdAt));
  let running = v.totals.total;
  const balanceAfter = new Map<string, bigint>();
  for (const p of ordered) {
    if (p.status === 'confirmed') running -= toMinor(p.amount, inv.currency) ?? 0n;
    balanceAfter.set(p.id, running < 0n ? 0n : running);
  }

  const doMarkSent = async () => {
    try {
      await markSent(inv.id);
      toast({ tone: 'success', title: `${inv.number} marked as sent`, body: 'It now counts toward your outstanding balance.' });
      setMarkOpen(false);
    } catch (err) {
      if ((err as any)?.code === 'duplicate') return;
      toast({ tone: 'error', title: 'Not marked as sent', body: err instanceof BillingError ? `${err.message} ${Object.values(err.fieldErrors).slice(0, 2).join(' ')}` : 'Try again.' });
      setMarkOpen(false);
    }
  };

  return (
    <div className="mx-auto max-w-[1400px] p-4 @3xl:p-6">
      <div className="grid grid-cols-1 gap-5 @5xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="order-2 @5xl:order-1">
          <div className="rounded-2xl p-3 @3xl:p-6" style={{ background: 'var(--inv-surface-3)' }}>
            <ScaledPaper doc={doc} />
          </div>
        </div>

        <aside className="order-1 space-y-4 @5xl:order-2" aria-label="Invoice summary and actions">
          <section className="inv-card p-4">
            <div className="flex items-center justify-between">
              <StatusBadge status={v.status} />
              <span className="inv-faint text-[12px]">{inv.kind === 'split' ? 'Split' : inv.kind === 'recurring' ? 'Recurring' : 'Standard'} invoice</span>
            </div>
            <p className="inv-muted mt-3 text-[12.5px]">{v.totals.amountPaid > 0n ? 'Balance due' : 'Amount due'}</p>
            <p className="num text-[28px] font-semibold leading-9 tracking-tight">{m(v.totals.balanceDue)}</p>
            <dl className="num mt-3 grid grid-cols-2 gap-y-2 text-[12.5px]">
              <dt className="inv-muted">Total</dt><dd className="text-right font-medium">{m(v.totals.total)}</dd>
              <dt className="inv-muted">Paid</dt><dd className="text-right font-medium">{m(v.totals.amountPaid)}</dd>
              {v.totals.pendingPayments > 0n && <><dt className="inv-muted">Pending confirmation</dt><dd className="text-right font-medium" style={{ color: 'var(--inv-warning)' }}>{m(v.totals.pendingPayments)}</dd></>}
              <dt className="inv-muted">Due</dt><dd className="text-right font-medium" style={{ color: v.status === 'overdue' ? 'var(--inv-danger)' : undefined }}>{formatDate(inv.dueDate)}{v.status === 'overdue' ? ` · ${v.daysOverdue}d late` : ''}</dd>
              <dt className="inv-muted">Client</dt><dd className="truncate text-right font-medium">{inv.billTo.company || inv.billTo.name || '—'}</dd>
            </dl>

            <div className="mt-4 grid grid-cols-2 gap-2">
              {v.status !== 'void' && v.status !== 'paid' && (
                <Button variant="primary" className="col-span-2" icon={<Send size={15} />} onClick={() => setSendOpen(true)}>
                  {inv.lifecycle === 'draft' ? 'Send invoice' : 'Resend invoice'}
                </Button>
              )}
              <Button icon={<CreditCard size={15} />} disabled={!canRecordPayment(v)} onClick={() => openPaymentDialog({ invoiceId: inv.id })}
                title={canRecordPayment(v) ? undefined : inv.lifecycle === 'draft' ? 'Send the invoice first' : 'No balance due'}>Record payment</Button>
              <Button icon={<Download size={15} />} onClick={() => downloadPdf(v)}>Download PDF</Button>
              <Button icon={<Pencil size={15} />} disabled={!canEdit(v)} onClick={() => navigate({ name: 'invoice-edit', id: inv.id })}>Edit</Button>
              <Menu label="More actions" items={[
                { label: 'Duplicate', icon: <Copy size={15} />, onSelect: () => navigate({ name: 'invoice-new', duplicateOf: inv.id }) },
                { label: 'Mark as sent', icon: <CheckCheck size={15} />, disabled: inv.lifecycle !== 'draft', hint: 'For invoices you delivered yourself', onSelect: () => setMarkOpen(true) },
                'separator',
                { label: 'Void invoice', icon: <Ban size={15} />, danger: true, disabled: !canVoid(v), onSelect: () => requestVoid(v) },
              ]} trigger={(p) => <Button {...p} icon={<MoreHorizontal size={15} />}>More</Button>} />
            </div>
            {lastDelivery && lastDelivery.result !== 'delivered' && (
              <div className="mt-3">
                <InlineAlert tone={lastDelivery.result === 'failed' ? 'danger' : 'warning'} title="Last email wasn’t delivered">
                  <span className="text-[12.5px]">{lastDelivery.detail}{inv.lifecycle === 'draft' ? ' If you sent the PDF yourself, use More → Mark as sent.' : ''}</span>
                </InlineAlert>
              </div>
            )}
          </section>

          <StripeCollectPanel billingInvoiceId={inv.id} onCrmChanged={reload} />

          <Panel title="Payments" count={v.payments.length}>
            {v.payments.length === 0 ? (
              <p className="inv-muted text-[13px]">No payments recorded yet.</p>
            ) : (
              <ul className="divide-y" style={{ borderColor: 'var(--inv-border)' }}>
                {ordered.map((p) => (
                  <li key={p.id} className="flex items-start gap-3 py-2.5" style={{ borderColor: 'var(--inv-border)' }}>
                    <div className="min-w-0 flex-1">
                      <p className="num flex items-center gap-2 text-[13px] font-semibold">{m(toMinor(p.amount, inv.currency) ?? 0n)} <Badge tone={p.status}>{PAY_STATUS_LABEL[p.status]}</Badge></p>
                      <p className="inv-muted text-[12px]">{formatDate(p.date)} · {PAYMENT_METHOD_LABELS[p.method]}{p.reference ? ` · ${p.reference}` : ''}</p>
                      {p.note && <p className="inv-faint text-[12px]">{p.note}</p>}
                    </div>
                    {p.status === 'confirmed' && (
                      <Button size="sm" variant="ghost" iconOnly icon={<FileDown size={15} />} aria-label={`Download receipt ${p.receiptNumber}`} title="Download receipt"
                        onClick={() => { downloadReceiptPdf(p, inv, balanceAfter.get(p.id) ?? 0n).catch(() => {}); }} />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Email deliveries" count={inv.deliveries.length}>
            {inv.deliveries.length === 0 ? <p className="inv-muted text-[13px]">Not emailed yet.</p> : (
              <ul className="space-y-2.5">
                {[...inv.deliveries].reverse().map((d) => (
                  <li key={d.id} className="text-[12.5px]">
                    <p className="flex items-center justify-between gap-2"><span className="truncate font-medium">{d.to}</span><Badge tone={d.result}>{DELIVERY_LABEL[d.result]}</Badge></p>
                    <p className="inv-faint">{formatDateTime(d.at)}{d.provider && d.provider !== 'none' ? ` · ${d.provider}` : ''}</p>
                    {d.result !== 'delivered' && <p className="inv-muted">{d.detail}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Activity">
            <ol className="space-y-2.5 text-[12.5px]">
              {[...inv.activity].reverse().slice(0, 8).map((a) => (
                <li key={a.id} className="flex gap-2.5">
                  <span className="mt-1.5 h-1.5 w-1.5 flex-none rounded-full" style={{ background: 'var(--inv-border-strong)' }} aria-hidden />
                  <span><span className="block">{a.message}</span><span className="inv-faint">{formatDateTime(a.at)}</span></span>
                </li>
              ))}
            </ol>
          </Panel>
        </aside>
      </div>

      <SendDialog open={sendOpen} view={v} onClose={() => setSendOpen(false)} />
      <ConfirmDialog open={markOpen} onClose={() => setMarkOpen(false)} onConfirm={doMarkSent} loading={isPending(`marksent:${inv.id}`)}
        title={`Mark ${inv.number} as sent?`} confirmLabel="Mark as sent"
        body={<>Use this if you delivered the invoice yourself, for example by downloading the PDF and emailing it. No email is sent, and the invoice stays unpaid until you record a payment.</>} />
      {dialogs}
    </div>
  );
}
