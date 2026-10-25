import React, { useEffect, useState } from 'react';
import { Paperclip } from 'lucide-react';
import type { InvoiceView } from '../domain/status';
import { hasErrors, isValidEmail, type FieldErrors } from '../domain/validation';
import { defaultEmail } from '../services/emailDelivery';
import { invoicePdfFilename } from '../services/pdf';
import { buildInvoiceDocument } from '../services/invoiceDocument';
import { BillingError, type SendResult } from '../services/repository';
import { useBillingData } from '../state/BillingStore';
import { Dialog, useToast } from '../ui/overlays';
import { Button, InlineAlert, Input, Textarea } from '../ui/primitives';

export function SendDialog({ open, view, onClose, onResult }: {
  open: boolean; view: InvoiceView | null; onClose: () => void; onResult?: (r: SendResult) => void;
}) {
  const { sendInvoice, isPending, repo } = useBillingData();
  const toast = useToast();
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [serverErrors, setServerErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState('');

  useEffect(() => {
    if (!open || !view) return;
    const d = defaultEmail(view.invoice, view.totals);
    setTo(view.invoice.billTo.email);
    setCc('');
    setSubject(d.subject);
    setMessage(d.message);
    setConfirmed(false);
    setSubmitted(false);
    setServerErrors({});
    setFormError('');
  }, [open, view?.invoice.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!view) return null;
  const sending = isPending(`send:${view.invoice.id}`);
  const ccList = cc.split(',').map((s) => s.trim()).filter(Boolean);
  const local: FieldErrors = {};
  if (!to.trim()) local.to = 'Enter the recipient’s email.';
  else if (!isValidEmail(to)) local.to = 'Enter a valid email, like name@company.com.';
  if (ccList.some((e) => !isValidEmail(e))) local.cc = 'Separate addresses with commas, and check each one.';
  if (!subject.trim()) local.subject = 'Add a subject line.';
  if (!confirmed) local.confirm = 'Confirm the recipient before sending.';
  const errors = submitted ? { ...local, ...serverErrors } : {};
  const filename = invoicePdfFilename(buildInvoiceDocument(view.invoice, view.totals));
  const changedRecipient = to.trim().toLowerCase() !== view.invoice.billTo.email.trim().toLowerCase();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (hasErrors(local) || sending) return;
    try {
      const r = await sendInvoice(view.invoice, view.totals, { to: to.trim(), cc: ccList.join(', '), subject: subject.trim(), message });
      if (r.delivery.result === 'delivered') {
        toast({ tone: 'success', title: `${view.invoice.number} sent`, body: `Emailed to ${r.delivery.to}. It stays unpaid until you record a payment.` });
      } else if (r.delivery.result === 'not_configured') {
        toast({ tone: 'warning', title: 'Invoice not emailed', body: 'Email isn’t set up. Download the PDF to send it yourself, then mark it as sent.' });
      } else {
        toast({ tone: 'error', title: 'Email failed', body: r.delivery.detail });
      }
      onResult?.(r);
      onClose();
    } catch (err) {
      if ((err as any)?.code === 'duplicate') return;
      if (err instanceof BillingError) {
        setServerErrors(err.fieldErrors);
        setFormError(hasErrors(err.fieldErrors)
          ? `${err.message} ${Object.values(err.fieldErrors).filter((_, i) => i < 3).join(' ')}`
          : err.message);
      } else setFormError('The invoice couldn’t be sent. Try again.');
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      width={580}
      dismissible={!sending}
      title={view.invoice.lifecycle === 'draft' ? `Send ${view.invoice.number}` : `Resend ${view.invoice.number}`}
      description="The PDF is attached exactly as it appears in the preview."
      footer={<>
        <Button onClick={onClose} disabled={sending}>Cancel</Button>
        <Button variant="primary" type="submit" form="inv-send-form" loading={sending}>Send invoice</Button>
      </>}
    >
      <form id="inv-send-form" noValidate onSubmit={submit} className="space-y-4">
        {!repo.emailConfigured && (
          <InlineAlert tone="warning" title="Email delivery isn’t set up">
            Sending will be logged as not delivered. Ask an admin to add SMTP settings on the server, or download the PDF and mark the invoice as sent.
          </InlineAlert>
        )}
        {formError && <InlineAlert tone="danger">{formError}</InlineAlert>}
        <Input label="To" required type="email" value={to} onChange={(e) => { setTo(e.target.value); setConfirmed(false); }} error={errors.to}
          hint={changedRecipient && isValidEmail(to) ? 'This is different from the email on the invoice.' : undefined} data-autofocus />
        <Input label="Cc" placeholder="Optional, comma separated" value={cc} onChange={(e) => setCc(e.target.value)} error={errors.cc} />
        <Input label="Subject" required value={subject} onChange={(e) => setSubject(e.target.value)} error={errors.subject} />
        <Textarea label="Message" rows={6} value={message} onChange={(e) => setMessage(e.target.value)} />
        <p className="inv-muted flex items-center gap-2 text-[12.5px]"><Paperclip size={14} aria-hidden /> {filename}</p>
        <div>
          <label className="flex cursor-pointer items-start gap-2.5 rounded-xl p-3 text-[13px]" style={{ background: 'var(--inv-surface-2)', border: `1px solid ${errors.confirm ? 'var(--inv-danger)' : 'var(--inv-border)'}` }}>
            <input type="checkbox" className="inv-check mt-0.5" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} aria-invalid={!!errors.confirm} />
            <span>I’ve checked that <b>{to.trim() || 'the recipient'}</b> is the right address for {view.invoice.billTo.company || view.invoice.billTo.name || 'this client'}.</span>
          </label>
          {errors.confirm && <p className="inv-error" role="alert">{errors.confirm}</p>}
        </div>
      </form>
    </Dialog>
  );
}
