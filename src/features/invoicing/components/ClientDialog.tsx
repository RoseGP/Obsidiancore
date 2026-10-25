import React, { useEffect, useMemo, useState } from 'react';
import { uid } from '../domain/factories';
import { emptyAddress, type Client } from '../domain/types';
import { hasErrors, validateClient, type FieldErrors } from '../domain/validation';
import { useBillingData } from '../state/BillingStore';
import { Dialog } from '../ui/overlays';
import { useToast } from '../ui/overlays';
import { Button, InlineAlert, Input, Select, Textarea } from '../ui/primitives';
import { BillingError } from '../services/repository';

const TAX_LABELS = [
  { value: '', label: 'None' }, { value: 'EIN', label: 'EIN' }, { value: 'VAT', label: 'VAT' },
  { value: 'GST', label: 'GST' }, { value: 'GSTIN', label: 'GSTIN' }, { value: 'ABN', label: 'ABN' },
  { value: 'TIN', label: 'TIN' }, { value: 'Tax ID', label: 'Other' },
];

const blankClient = (): Client => ({
  id: uid('cl'), name: '', company: '', email: '', phone: '', address: emptyAddress(),
  taxIdLabel: '', taxId: '', notes: '', archived: false, createdAt: '', updatedAt: '',
});

export function ClientDialog({ open, clientId, onClose, onSaved }: {
  open: boolean; clientId?: string; onClose: () => void; onSaved?: (c: Client) => void;
}) {
  const { data, saveClient, isPending } = useBillingData();
  const toast = useToast();
  const existing = useMemo(() => data.clients.find((c) => c.id === clientId), [data.clients, clientId]);
  const [form, setForm] = useState<Client>(blankClient);
  const [submitted, setSubmitted] = useState(false);
  const [serverErrors, setServerErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState('');

  useEffect(() => {
    if (open) {
      setForm(existing ? structuredClone(existing) : blankClient());
      setSubmitted(false);
      setServerErrors({});
      setFormError('');
    }
  }, [open, existing]);

  const localErrors = validateClient(form);
  const errors = submitted ? { ...localErrors, ...serverErrors } : {};
  const set = <K extends keyof Client>(k: K, v: Client[K]) => { setForm((f) => ({ ...f, [k]: v })); setServerErrors({}); };
  const setAddr = (k: keyof Client['address'], v: string) => setForm((f) => ({ ...f, address: { ...f.address, [k]: v } }));
  const saving = isPending(`client:${form.id}`);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (hasErrors(localErrors) || saving) return;
    try {
      const saved = await saveClient({ ...form, name: form.name.trim(), email: form.email.trim() });
      toast({ tone: 'success', title: existing ? 'Client updated' : 'Client added', body: saved.company || saved.name });
      onSaved?.(saved);
      onClose();
    } catch (err) {
      if (err instanceof BillingError) {
        setServerErrors(err.fieldErrors);
        setFormError(hasErrors(err.fieldErrors) ? '' : err.message);
      } else if ((err as any)?.code !== 'duplicate') setFormError('The client couldn’t be saved. Try again.');
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      width={620}
      title={existing ? 'Edit client' : 'Add client'}
      description="Details are copied onto new invoices for this client."
      footer={<>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="primary" type="submit" form="inv-client-form" loading={saving}>{existing ? 'Save changes' : 'Add client'}</Button>
      </>}
    >
      <form id="inv-client-form" noValidate onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {formError && <div className="sm:col-span-2"><InlineAlert tone="danger">{formError}</InlineAlert></div>}
        <Input label="Contact name" required value={form.name} onChange={(e) => set('name', e.target.value)} error={errors.name} autoComplete="name" data-autofocus />
        <Input label="Company" value={form.company} onChange={(e) => set('company', e.target.value)} autoComplete="organization" />
        <Input label="Email" required type="email" value={form.email} onChange={(e) => set('email', e.target.value)} error={errors.email} autoComplete="email" hint="Invoices are sent here." />
        <Input label="Phone" type="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} error={errors.phone} autoComplete="tel" />
        <Input containerClassName="sm:col-span-2" label="Billing address" placeholder="Street address" value={form.address.line1} onChange={(e) => setAddr('line1', e.target.value)} autoComplete="address-line1" />
        <Input containerClassName="sm:col-span-2" aria-label="Address line 2" placeholder="Suite, floor (optional)" value={form.address.line2} onChange={(e) => setAddr('line2', e.target.value)} autoComplete="address-line2" />
        <Input label="City" value={form.address.city} onChange={(e) => setAddr('city', e.target.value)} autoComplete="address-level2" />
        <div className="grid grid-cols-2 gap-3">
          <Input label="State / region" value={form.address.state} onChange={(e) => setAddr('state', e.target.value)} autoComplete="address-level1" />
          <Input label="Postal code" value={form.address.postalCode} onChange={(e) => setAddr('postalCode', e.target.value)} autoComplete="postal-code" />
        </div>
        <Input label="Country" value={form.address.country} onChange={(e) => setAddr('country', e.target.value)} autoComplete="country-name" />
        <div className="grid grid-cols-[110px_1fr] gap-3">
          <Select label="Tax ID type" value={form.taxIdLabel} options={TAX_LABELS} onChange={(v) => set('taxIdLabel', v)} />
          <Input label="Tax ID" value={form.taxId} onChange={(e) => set('taxId', e.target.value)} error={errors.taxId} disabled={!form.taxIdLabel} />
        </div>
        <Textarea containerClassName="sm:col-span-2" label="Internal notes" hint="Only visible to your team." value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={2} />
      </form>
    </Dialog>
  );
}
