import React, { useEffect, useState } from 'react';
import { ImagePlus, RotateCcw } from 'lucide-react';
import { CURRENCIES, RATE_SCALE, parseScaled } from '../domain/money';
import type { BusinessSettings } from '../domain/types';
import { isValidEmail } from '../domain/validation';
import { useBillingData } from '../state/BillingStore';
import { useNav } from '../state/navigation';
import { ConfirmDialog, useToast } from '../ui/overlays';
import { Button, InlineAlert, Input, SectionCard, Select, Textarea } from '../ui/primitives';

export function SettingsPage() {
  const { data, repo, saveSettings, isPending, resetPrototype } = useBillingData();
  const { setLeaveGuard } = useNav();
  const toast = useToast();
  const [form, setForm] = useState<BusinessSettings>(() => structuredClone(data.settings));
  const [submitted, setSubmitted] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const dirty = JSON.stringify(form) !== JSON.stringify(data.settings);

  useEffect(() => { setLeaveGuard(() => dirty); return () => setLeaveGuard(null); }, [dirty, setLeaveGuard]);

  const errors: Record<string, string> = {};
  if (!form.issuer.name.trim()) errors.name = 'Enter your business name.';
  if (form.issuer.email && !isValidEmail(form.issuer.email)) errors.email = 'Enter a valid email.';
  if (!/^[A-Za-z0-9\-_/.]{0,12}$/.test(form.invoicePrefix)) errors.prefix = 'Up to 12 letters, digits, and - _ / .';
  if (!Number.isInteger(form.defaultTermsDays) || form.defaultTermsDays < 0 || form.defaultTermsDays > 365) errors.terms = 'Enter 0–365 days.';
  const rate = form.defaultTaxRate.trim() ? parseScaled(form.defaultTaxRate, RATE_SCALE) : 0n;
  if (rate === null || rate < 0n || rate > 100000n) errors.tax = 'Enter a rate between 0 and 100.';
  const shown = submitted ? errors : {};
  const issuer = (p: Partial<BusinessSettings['issuer']>) => setForm((f) => ({ ...f, issuer: { ...f.issuer, ...p } }));
  const addr = (k: keyof BusinessSettings['issuer']['address'], v: string) => setForm((f) => ({ ...f, issuer: { ...f.issuer, address: { ...f.issuer.address, [k]: v } } }));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (Object.keys(errors).length) return;
    try {
      await saveSettings(form);
      toast({ tone: 'success', title: 'Settings saved', body: 'New invoices will use these details.' });
    } catch (err: any) {
      if (err?.code !== 'duplicate') toast({ tone: 'error', title: 'Settings not saved', body: err?.message });
    }
  };

  return (
    <form noValidate onSubmit={save} className="mx-auto max-w-[880px] space-y-5 p-4 @3xl:p-6">
      <SectionCard id="set-biz" title="Business details" description="Appears in the From section of new invoices.">
        <div className="grid grid-cols-1 gap-3 @xl:grid-cols-2">
          <Input label="Business name" required value={form.issuer.name} onChange={(e) => issuer({ name: e.target.value })} error={shown.name} />
          <Input label="Billing email" type="email" value={form.issuer.email} onChange={(e) => issuer({ email: e.target.value })} error={shown.email} />
          <Input label="Phone" value={form.issuer.phone} onChange={(e) => issuer({ phone: e.target.value })} />
          <Input label="Website" value={form.issuer.website} onChange={(e) => issuer({ website: e.target.value })} />
          <Input containerClassName="@xl:col-span-2" label="Street address" value={form.issuer.address.line1} onChange={(e) => addr('line1', e.target.value)} />
          <Input containerClassName="@xl:col-span-2" aria-label="Address line 2" placeholder="Suite, floor" value={form.issuer.address.line2} onChange={(e) => addr('line2', e.target.value)} />
          <Input label="City" value={form.issuer.address.city} onChange={(e) => addr('city', e.target.value)} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="State" value={form.issuer.address.state} onChange={(e) => addr('state', e.target.value)} />
            <Input label="Postal code" value={form.issuer.address.postalCode} onChange={(e) => addr('postalCode', e.target.value)} />
          </div>
          <Input label="Country" value={form.issuer.address.country} onChange={(e) => addr('country', e.target.value)} />
          <div className="grid grid-cols-[110px_1fr] gap-3">
            <Input label="Tax ID type" value={form.issuer.taxIdLabel} onChange={(e) => issuer({ taxIdLabel: e.target.value })} />
            <Input label="Tax ID" value={form.issuer.taxId} onChange={(e) => issuer({ taxId: e.target.value })} />
          </div>
          <div className="@xl:col-span-2 flex items-center gap-3">
            {form.issuer.logoDataUrl && <img src={form.issuer.logoDataUrl} alt="Current logo" className="h-12 w-12 rounded-lg object-contain" style={{ border: '1px solid var(--inv-border)' }} />}
            <label className="inv-btn inv-btn-secondary inv-btn-sm" style={{ cursor: 'pointer' }}>
              <ImagePlus size={14} /> {form.issuer.logoDataUrl ? 'Replace logo' : 'Upload logo'}
              <input type="file" accept="image/png,image/jpeg" className="sr-only-inv" onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                if (f.size > 600 * 1024 || !['image/png', 'image/jpeg'].includes(f.type)) { toast({ tone: 'error', title: 'Logo not added', body: 'Use a PNG or JPG under 600 KB.' }); return; }
                const r = new FileReader();
                r.onload = () => issuer({ logoDataUrl: String(r.result) });
                r.readAsDataURL(f);
              }} />
            </label>
            {form.issuer.logoDataUrl && <Button size="sm" variant="ghost" onClick={() => issuer({ logoDataUrl: '' })}>Remove</Button>}
            <span className="inv-faint text-[12px]">PNG or JPG, under 600 KB.</span>
          </div>
        </div>
      </SectionCard>

      <SectionCard id="set-defaults" title="Invoice defaults">
        <div className="grid grid-cols-1 gap-3 @xl:grid-cols-2">
          <Input label="Number prefix" value={form.invoicePrefix} onChange={(e) => setForm({ ...form, invoicePrefix: e.target.value })} error={shown.prefix} hint={`Next number looks like ${form.invoicePrefix}1043`} />
          <Select label="Default currency" value={form.defaultCurrency} onChange={(v) => setForm({ ...form, defaultCurrency: v as any })} options={CURRENCIES.map((c) => ({ value: c.code, label: `${c.code} · ${c.name}` }))} />
          <Input label="Payment terms" suffix="days" inputMode="numeric" value={String(form.defaultTermsDays)} onChange={(e) => setForm({ ...form, defaultTermsDays: e.target.value === '' ? NaN : Number(e.target.value) })} error={shown.terms} />
          <Input label="Default tax rate" suffix="%" inputMode="decimal" value={form.defaultTaxRate} onChange={(e) => setForm({ ...form, defaultTaxRate: e.target.value })} error={shown.tax} />
          <Textarea containerClassName="@xl:col-span-2" label="Payment instructions" rows={3} value={form.paymentInstructions} onChange={(e) => setForm({ ...form, paymentInstructions: e.target.value })} />
          <Textarea containerClassName="@xl:col-span-2" label="Default notes" rows={2} value={form.defaultNotes} onChange={(e) => setForm({ ...form, defaultNotes: e.target.value })} />
          <Input label="Signer name" value={form.signature.name} onChange={(e) => setForm({ ...form, signature: { ...form.signature, name: e.target.value } })} />
          <Input label="Signer title" value={form.signature.title} onChange={(e) => setForm({ ...form, signature: { ...form.signature, title: e.target.value } })} />
        </div>
      </SectionCard>

      <SectionCard id="set-data" title="Data and delivery">
        <div className="space-y-3">
          {repo.mode === 'local' ? (
            <InlineAlert tone="warning" title="Prototype mode">
              {repo.modeReason} Connect the billing server to store invoices securely.
            </InlineAlert>
          ) : (
            <InlineAlert tone="success" title="Connected to the billing server">Invoices, clients, payments and settings are saved to your workspace.</InlineAlert>
          )}
          {repo.resetPrototypeData && (
            <Button size="sm" icon={<RotateCcw size={14} />} onClick={() => setResetOpen(true)}>Reset sample data</Button>
          )}
        </div>
      </SectionCard>

      <div className="sticky bottom-0 -mx-1 flex items-center justify-end gap-2 rounded-xl px-1 py-3" style={{ background: 'var(--inv-bg)' }}>
        {dirty && <span className="inv-muted mr-auto text-[12.5px]">Unsaved changes</span>}
        <Button disabled={!dirty || isPending('settings')} onClick={() => { setForm(structuredClone(data.settings)); setSubmitted(false); }}>Discard</Button>
        <Button variant="primary" type="submit" loading={isPending('settings')} disabled={!dirty}>Save settings</Button>
      </div>

      <ConfirmDialog open={resetOpen} onClose={() => setResetOpen(false)} tone="danger" confirmLabel="Reset data" loading={isPending('reset')}
        title="Reset sample data?" body="All invoices, clients and payments in this browser are replaced with the original sample data."
        onConfirm={async () => { await resetPrototype(); setResetOpen(false); setForm(structuredClone(data.settings)); toast({ tone: 'success', title: 'Sample data restored' }); }} />
    </form>
  );
}
