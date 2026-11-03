import React, { useEffect, useState } from 'react';
import { CheckCheck, Download } from 'lucide-react';
import type { InvoiceView } from '../domain/status';
import { downloadInvoicePdf, invoicePdfFilename } from '../services/pdf';
import { buildInvoiceDocument } from '../services/invoiceDocument';
import { BillingError } from '../services/repository';
import { useBillingData } from '../state/BillingStore';
import { Dialog, useToast } from '../ui/overlays';
import { Button, InlineAlert } from '../ui/primitives';

/**
 * Deliver an invoice to the client. The CRM doesn't send email: download the
 * PDF (or share the Stripe payment link from the invoice page), deliver it
 * yourself, then mark the invoice as sent so it counts toward your balance.
 */
export function SendDialog({ open, view, onClose, onResult }: {
  open: boolean; view: InvoiceView | null; onClose: () => void; onResult?: () => void;
}) {
  const { markSent, isPending } = useBillingData();
  const toast = useToast();
  const [downloaded, setDownloaded] = useState(false);
  const [formError, setFormError] = useState('');

  useEffect(() => { if (open) { setDownloaded(false); setFormError(''); } }, [open, view?.invoice.id]);

  if (!view) return null;
  const inv = view.invoice;
  const doc = buildInvoiceDocument(inv, view.totals);
  const filename = invoicePdfFilename(doc);
  const marking = isPending(`marksent:${inv.id}`);
  const isDraft = inv.lifecycle === 'draft';

  const download = async () => {
    try {
      if ((await downloadInvoicePdf(doc)) === 'declined') return;
      setDownloaded(true);
    } catch { setFormError('The PDF couldn’t be created. Try again.'); }
  };

  const confirm = async () => {
    if (!isDraft) { onResult?.(); onClose(); return; }
    try {
      await markSent(inv.id);
      toast({ tone: 'success', title: `${inv.number} marked as sent`, body: 'It now counts toward your outstanding balance.' });
      onResult?.();
      onClose();
    } catch (err) {
      if ((err as any)?.code === 'duplicate') return;
      setFormError(err instanceof BillingError ? err.message : 'The invoice couldn’t be marked as sent. Try again.');
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      width={520}
      dismissible={!marking}
      title={isDraft ? `Send ${inv.number}` : `Resend ${inv.number}`}
      description={`Deliver the invoice to ${inv.billTo.company || inv.billTo.name || 'your client'} yourself, then confirm.`}
      footer={<>
        <Button onClick={onClose} disabled={marking}>Cancel</Button>
        <Button variant="primary" icon={<CheckCheck size={15} />} onClick={confirm} loading={marking}>
          {isDraft ? 'Mark as sent' : 'Done'}
        </Button>
      </>}
    >
      <div className="space-y-4">
        {formError && <InlineAlert tone="danger">{formError}</InlineAlert>}
        <ol className="space-y-3 text-[13.5px]">
          <li className="rounded-xl p-3" style={{ background: 'var(--inv-surface-2)', border: '1px solid var(--inv-border)' }}>
            <p className="font-semibold">1. Download the PDF</p>
            <p className="inv-muted mt-0.5 text-[12.5px]">{filename}</p>
            <div className="mt-2"><Button size="sm" icon={<Download size={14} />} onClick={download}>{downloaded ? 'Download again' : 'Download PDF'}</Button></div>
          </li>
          <li className="rounded-xl p-3" style={{ background: 'var(--inv-surface-2)', border: '1px solid var(--inv-border)' }}>
            <p className="font-semibold">2. Send it to your client</p>
            <p className="inv-muted mt-0.5 text-[12.5px]">
              Attach it in your usual email or messaging app{inv.billTo.email ? <> (client email: <b>{inv.billTo.email}</b>)</> : null}.
              To let them pay by card, create a Stripe payment link from the invoice page and share it.
            </p>
          </li>
          <li className="rounded-xl p-3" style={{ background: 'var(--inv-surface-2)', border: '1px solid var(--inv-border)' }}>
            <p className="font-semibold">3. {isDraft ? 'Mark it as sent' : 'You’re done'}</p>
            <p className="inv-muted mt-0.5 text-[12.5px]">
              {isDraft ? 'The invoice then counts toward your outstanding balance. It stays unpaid until you record a payment.' : 'This invoice is already marked as sent.'}
            </p>
          </li>
        </ol>
      </div>
    </Dialog>
  );
}
