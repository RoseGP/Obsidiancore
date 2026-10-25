import React, { useEffect, useMemo, useState } from 'react';
import { formatMoney, minorToDecimalString, toMinor } from '../domain/money';
import { isReceivable } from '../domain/status';
import { PAYMENT_METHOD_LABELS, type PaymentMethod, type PaymentStatus } from '../domain/types';
import { hasErrors, validatePayment, type FieldErrors } from '../domain/validation';
import { useBillingData } from '../state/BillingStore';
import { BillingError } from '../services/repository';
import { Dialog, useToast } from '../ui/overlays';
import { Button, DateField, EmptyState, InlineAlert, Input, Select, Textarea } from '../ui/primitives';
import { Receipt } from 'lucide-react';

export function PaymentDialog({ open, invoiceId, onClose }: { open: boolean; invoiceId?: string; onClose: () => void }) {
  const { views, viewById, today, recordPayment, isPending } = useBillingData();
  const toast = useToast();
  const openInvoices = useMemo(
    () => views.filter((v) => isReceivable(v.status) && v.totals.balanceDue > 0n)
      .sort((a, b) => a.invoice.dueDate.localeCompare(b.invoice.dueDate)),
    [views],
  );

  const [selectedId, setSelectedId] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today);
  const [method, setMethod] = useState<PaymentMethod>('bank_transfer');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [status, setStatus] = useState<PaymentStatus>('confirmed');
  const [submitted, setSubmitted] = useState(false);
  const [serverErrors, setServerErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState('');

  const view = selectedId ? viewById.get(selectedId) : undefined;

  useEffect(() => {
    if (!open) return;
    const initial = invoiceId ?? openInvoices[0]?.invoice.id ?? '';
    setSelectedId(initial);
    setDate(today);
    setMethod('bank_transfer');
    setReference('');
    setNote('');
    setStatus('confirmed');
    setSubmitted(false);
    setServerErrors({});
    setFormError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, invoiceId]);

  useEffect(() => {
    if (view) setAmount(minorToDecimalString(view.totals.balanceDue, view.invoice.currency));
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const currency = view?.invoice.currency ?? 'USD';
  const localErrors = view
    ? validatePayment({ amount, date, method, currency }, { balanceDue: view.totals.balanceDue, issueDate: view.invoice.issueDate, today })
    : { invoice: 'Choose an invoice.' };
  const errors = submitted ? { ...localErrors, ...serverErrors } : {};
  const minor = toMinor(amount, currency);
  const after = view && minor !== null && minor > 0n ? view.totals.balanceDue - minor : null;
  const saving = isPending(`pay:${selectedId}`);
  const preselectedNotPayable = invoiceId && view && !(isReceivable(view.status) && view.totals.balanceDue > 0n);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (!view || hasErrors(localErrors) || saving) return;
    try {
      const r = await recordPayment({
        invoiceId: view.invoice.id, amount, currency: view.invoice.currency, date, method,
        reference: reference.trim(), note: note.trim(), status,
      });
      toast({
        tone: 'success',
        title: status === 'confirmed' ? 'Payment recorded' : 'Pending payment recorded',
        body: status === 'confirmed'
          ? `${formatMoney(toMinor(r.payment.amount, currency)!, currency)} applied to ${view.invoice.number}.`
          : 'The balance will update once you confirm the funds arrived.',
      });
      onClose();
    } catch (err) {
      if (err instanceof BillingError) { setServerErrors(err.fieldErrors); setFormError(hasErrors(err.fieldErrors) ? '' : err.message); }
      else if ((err as any)?.code !== 'duplicate') setFormError('The payment couldn’t be recorded. Try again.');
    }
  };

  const nothingToPay = openInvoices.length === 0 && !invoiceId;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      width={520}
      title="Record payment"
      description="Record money you’ve received outside the app, like a bank transfer or check."
      footer={nothingToPay ? <Button onClick={onClose}>Close</Button> : <>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="primary" type="submit" form="inv-pay-form" loading={saving} disabled={!!preselectedNotPayable}>Record payment</Button>
      </>}
    >
      {nothingToPay ? (
        <EmptyState icon={<Receipt size={18} />} title="No invoices are waiting for payment" body="Payments can be recorded once an invoice has been sent and has a balance due." />
      ) : (
        <form id="inv-pay-form" noValidate onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {formError && <div className="sm:col-span-2"><InlineAlert tone="danger">{formError}</InlineAlert></div>}
          {preselectedNotPayable && (
            <div className="sm:col-span-2">
              <InlineAlert tone="warning">
                {view!.status === 'draft' ? 'Send this invoice (or mark it sent) before recording payments.'
                  : view!.status === 'void' ? 'This invoice is void.' : 'This invoice has no balance due.'}
              </InlineAlert>
            </div>
          )}
          <Select
            containerClassName="sm:col-span-2"
            label="Invoice"
            required
            value={selectedId}
            disabled={!!invoiceId}
            error={errors.invoice}
            onChange={setSelectedId}
            options={(invoiceId && view && !openInvoices.some((v) => v.invoice.id === invoiceId) ? [view, ...openInvoices] : openInvoices).map((v) => ({
              value: v.invoice.id,
              label: `${v.invoice.number} · ${v.invoice.billTo.company || v.invoice.billTo.name} · ${formatMoney(v.totals.balanceDue, v.invoice.currency)} due`,
            }))}
          />
          <Input label="Amount received" required inputMode="decimal" prefix={currency} value={amount} onChange={(e) => { setAmount(e.target.value); setServerErrors({}); }} error={errors.amount}
            hint={after !== null && after >= 0n ? `Balance after: ${formatMoney(after, currency)}` : undefined} />
          <DateField label="Payment date" required value={date} max={today} onChange={setDate} error={errors.date} />
          <Select label="Method" required value={method} onChange={(v) => setMethod(v as PaymentMethod)}
            options={Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => ({ value, label }))} error={errors.method} />
          <Input label="Reference" placeholder="Transaction ID or check no." value={reference} onChange={(e) => setReference(e.target.value)} />
          <fieldset className="sm:col-span-2">
            <legend className="inv-label">Has the money arrived?</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {([
                ['confirmed', 'Yes, confirmed', 'I’ve seen the funds in our account. The balance updates now.'],
                ['pending', 'Not yet', 'Record it as pending. The balance stays the same until confirmed.'],
              ] as const).map(([v, title, body]) => (
                <label key={v} className="flex cursor-pointer gap-2.5 rounded-xl border p-3 text-[13px]" style={{ borderColor: status === v ? 'var(--inv-primary)' : 'var(--inv-border-strong)', background: status === v ? 'var(--inv-primary-tint)' : 'var(--inv-surface)' }}>
                  <input type="radio" name="pay-status" value={v} checked={status === v} onChange={() => setStatus(v)} style={{ accentColor: 'var(--inv-primary)', marginTop: 3 }} />
                  <span><span className="block font-semibold">{title}</span><span className="inv-muted text-[12px]">{body}</span></span>
                </label>
              ))}
            </div>
          </fieldset>
          <Textarea containerClassName="sm:col-span-2" label="Note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </form>
      )}
    </Dialog>
  );
}
