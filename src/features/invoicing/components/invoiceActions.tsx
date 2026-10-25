import React, { useState } from 'react';
import { Copy, CreditCard, Download, Eye, Pencil, Ban, Send } from 'lucide-react';
import type { InvoiceView } from '../domain/status';
import { buildInvoiceDocument } from '../services/invoiceDocument';
import { downloadInvoicePdf } from '../services/pdf';
import { BillingError } from '../services/repository';
import { useBillingData } from '../state/BillingStore';
import { useNav, useQuickActions } from '../state/navigation';
import { ConfirmDialog, useToast, type MenuAction } from '../ui/overlays';

export function canEdit(v: InvoiceView) {
  return v.status !== 'void' && v.status !== 'paid';
}
export function canVoid(v: InvoiceView) {
  return v.status !== 'void' && !v.payments.some((p) => p.status === 'confirmed');
}
export function canRecordPayment(v: InvoiceView) {
  return ['sent', 'viewed', 'partially_paid', 'overdue'].includes(v.status) && v.totals.balanceDue > 0n;
}

/** Row/menu actions shared by tables and the invoice page. Renders its own confirm dialog. */
export function useInvoiceActions() {
  const { voidInvoice, isPending } = useBillingData();
  const { navigate } = useNav();
  const { openPaymentDialog } = useQuickActions();
  const toast = useToast();
  const [voidTarget, setVoidTarget] = useState<InvoiceView | null>(null);

  const downloadPdf = async (v: InvoiceView) => {
    try {
      const r = await downloadInvoicePdf(buildInvoiceDocument(v.invoice, v.totals));
      if (r === 'saved') toast({ tone: 'success', title: 'PDF downloaded', body: `${v.invoice.number}.pdf` });
    } catch {
      toast({ tone: 'error', title: 'PDF couldn’t be created', body: 'Try again. If it keeps failing, remove the logo or signature image and retry.' });
    }
  };

  const menuFor = (v: InvoiceView, opts: { includeView?: boolean } = {}): (MenuAction | 'separator')[] => [
    ...(opts.includeView !== false ? [{ label: 'View invoice', icon: <Eye size={15} />, onSelect: () => navigate({ name: 'invoice-view', id: v.invoice.id }) }] : []),
    { label: 'Edit', icon: <Pencil size={15} />, disabled: !canEdit(v), hint: canEdit(v) ? undefined : 'Paid and void invoices can’t be edited', onSelect: () => navigate({ name: 'invoice-edit', id: v.invoice.id }) },
    { label: v.status === 'draft' ? 'Send invoice' : 'Resend invoice', icon: <Send size={15} />, disabled: v.status === 'void', onSelect: () => navigate({ name: 'invoice-view', id: v.invoice.id }) },
    { label: 'Record payment', icon: <CreditCard size={15} />, disabled: !canRecordPayment(v), onSelect: () => openPaymentDialog({ invoiceId: v.invoice.id }) },
    { label: 'Download PDF', icon: <Download size={15} />, onSelect: () => downloadPdf(v) },
    { label: 'Duplicate', icon: <Copy size={15} />, onSelect: () => navigate({ name: 'invoice-new', duplicateOf: v.invoice.id }) },
    'separator',
    { label: 'Void invoice', icon: <Ban size={15} />, danger: true, disabled: !canVoid(v), hint: canVoid(v) ? undefined : 'Invoices with confirmed payments can’t be voided', onSelect: () => setVoidTarget(v) },
  ];

  const confirmVoid = async () => {
    if (!voidTarget) return;
    try {
      await voidInvoice(voidTarget.invoice.id);
      toast({ tone: 'success', title: `${voidTarget.invoice.number} voided`, body: 'It no longer counts toward balances.' });
      setVoidTarget(null);
    } catch (err) {
      if ((err as any)?.code === 'duplicate') return;
      toast({ tone: 'error', title: 'Invoice not voided', body: err instanceof BillingError ? err.message : 'Try again.' });
    }
  };

  const dialogs = (
    <ConfirmDialog
      open={!!voidTarget}
      onClose={() => setVoidTarget(null)}
      onConfirm={confirmVoid}
      loading={voidTarget ? isPending(`void:${voidTarget.invoice.id}`) : false}
      tone="danger"
      title={`Void ${voidTarget?.invoice.number ?? 'invoice'}?`}
      confirmLabel="Void invoice"
      body={<>The invoice stays on record for your audit trail but is removed from balances and can’t be edited or paid. This can’t be undone.</>}
    />
  );

  return { menuFor, downloadPdf, requestVoid: setVoidTarget, dialogs };
}
