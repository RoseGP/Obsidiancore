import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Copy, Download, ImagePlus, MoreHorizontal, Plus, Save, Send, Trash2, X } from 'lucide-react';
import { calculateInvoice, calculateInstallments } from '../domain/calc';
import { CURRENCIES, formatMoney, formatRate } from '../domain/money';
import {
  billToFromClient, createInvoice, defaultInstallments, defaultRecurring, duplicateInvoice, emptyBillTo, newFee, uid,
} from '../domain/factories';
import { addDays, buildInvoiceView, daysBetween, isValidISODate } from '../domain/status';
import type { Address, Client, Invoice, InvoiceKind } from '../domain/types';
import { hasErrors, validateInvoice } from '../domain/validation';
import { buildInvoiceDocument } from '../services/invoiceDocument';
import { downloadInvoicePdf } from '../services/pdf';
import { BillingError } from '../services/repository';
import { useBillingData } from '../state/BillingStore';
import { useNav, useQuickActions, type Route } from '../state/navigation';
import { ScaledPaper } from '../components/InvoicePreview';
import { SendDialog } from '../components/SendDialog';
import { ItemsEditor } from '../components/editor/ItemsEditor';
import { ClientPicker } from '../components/editor/ClientPicker';
import { Menu, useToast } from '../ui/overlays';
import {
  Button, DateField, EmptyState, InlineAlert, Input, SegmentedControl, Select, Textarea, cx, focusInPane,
} from '../ui/primitives';

const KIND_HELP: Record<InvoiceKind, string> = {
  standard: 'One invoice, paid in full by the due date.',
  split: 'One invoice paid in installments, like a deposit and a final payment.',
  recurring: 'Bill the same items on a schedule. This invoice is the first in the series.',
};

const TERMS = [
  { label: 'On receipt', days: 0 }, { label: 'Net 15', days: 15 }, { label: 'Net 30', days: 30 }, { label: 'Net 60', days: 60 },
];

async function readImage(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg'].includes(file.type)) throw new Error('Use a PNG or JPG image.');
  if (file.size > 600 * 1024) throw new Error('Use an image under 600 KB.');
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('The image couldn’t be read.'));
    r.readAsDataURL(file);
  });
}

function Section({ title, description, children, actions, id }: { title: string; description?: string; children: React.ReactNode; actions?: React.ReactNode; id: string }) {
  return (
    <section aria-labelledby={id} className="inv-card">
      <header className="flex items-start justify-between gap-3 px-5 pt-4 pb-3">
        <div>
          <h2 id={id} className="inv-h3">{title}</h2>
          {description && <p className="inv-muted text-[12.5px]">{description}</p>}
        </div>
        {actions}
      </header>
      <div className="px-5 pb-5">{children}</div>
    </section>
  );
}

function AddressFields({ value, onChange, prefix, errors, onBlur }: {
  value: Address; onChange: (a: Address) => void; prefix: string; errors: Record<string, string>; onBlur: (k: string) => void;
}) {
  const set = (k: keyof Address) => (e: React.ChangeEvent<HTMLInputElement>) => onChange({ ...value, [k]: e.target.value });
  return (
    <div className="grid grid-cols-1 gap-3 @lg:grid-cols-2">
      <Input containerClassName="@lg:col-span-2" inputSize="sm" label="Street address" value={value.line1} onChange={set('line1')} onBlur={() => onBlur(`${prefix}.address.line1`)} error={errors[`${prefix}.address.line1`]} />
      <Input containerClassName="@lg:col-span-2" inputSize="sm" aria-label="Address line 2" placeholder="Suite, floor (optional)" value={value.line2} onChange={set('line2')} />
      <Input inputSize="sm" label="City" value={value.city} onChange={set('city')} />
      <div className="grid grid-cols-2 gap-3">
        <Input inputSize="sm" label="State" value={value.state} onChange={set('state')} />
        <Input inputSize="sm" label="Postal code" value={value.postalCode} onChange={set('postalCode')} />
      </div>
      <Input containerClassName="@lg:col-span-2" inputSize="sm" label="Country" value={value.country} onChange={set('country')} />
    </div>
  );
}

export function InvoiceEditorPage({ route }: { route: Extract<Route, { name: 'invoice-new' | 'invoice-edit' }> }) {
  const { data, viewById, saveInvoice, isPending, today } = useBillingData();
  const { navigate, setLeaveGuard } = useNav();
  const { openClientDialog } = useQuickActions();
  const toast = useToast();

  const editingId = route.name === 'invoice-edit' ? route.id : null;
  const existingView = editingId ? viewById.get(editingId) : undefined;

  const initial = useMemo<Invoice | null>(() => {
    const numbers = data.invoices.map((i) => i.number);
    if (editingId) return existingView ? structuredClone(existingView.invoice) : null;
    if (route.name === 'invoice-new' && route.duplicateOf) {
      const src = viewById.get(route.duplicateOf);
      if (src) return duplicateInvoice(src.invoice, data.settings, numbers);
    }
    const inv = createInvoice(data.settings, numbers, (route.name === 'invoice-new' && route.kind) || 'standard');
    const cid = route.name === 'invoice-new' ? route.clientId : undefined;
    const c = cid ? data.clients.find((x) => x.id === cid) : undefined;
    if (c) { inv.clientId = c.id; inv.billTo = billToFromClient(c); }
    return inv;
    // Initialise once per route; later store updates must not wipe in-progress edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(route)]);

  const [draft, setDraft] = useState<Invoice | null>(initial);
  const [baseline, setBaseline] = useState(() => JSON.stringify(initial));
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [attempt, setAttempt] = useState<'none' | 'draft' | 'send'>('none');
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [mobilePane, setMobilePane] = useState<'edit' | 'preview'>('edit');
  const [split, setSplit] = useState(52);
  const [zoom, setZoom] = useState<'fit' | number>('fit');
  const [editIssuer, setEditIssuer] = useState(false);
  const [editBillTo, setEditBillTo] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDraft(initial);
    setBaseline(JSON.stringify(initial));
    setTouched(new Set());
    setAttempt('none');
    setServerErrors({});
    setFormError('');
  }, [initial]);

  const dirty = draft !== null && JSON.stringify(draft) !== baseline;

  // Warn before leaving with unsaved changes (in-app navigation and tab close).
  useEffect(() => {
    setLeaveGuard(() => dirty);
    const onUnload = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', onUnload);
    return () => { window.removeEventListener('beforeunload', onUnload); setLeaveGuard(null); };
  }, [dirty, setLeaveGuard]);

  const payments = useMemo(() => (draft ? data.payments.filter((p) => p.invoiceId === draft.id) : []), [data.payments, draft?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const totals = useMemo(() => (draft ? calculateInvoice(draft, payments) : null), [draft, payments]);
  const doc = useMemo(() => (draft && totals ? buildInvoiceDocument(draft, totals) : null), [draft, totals]);
  const takenNumbers = useMemo(() => data.invoices.filter((i) => i.id !== draft?.id).map((i) => i.number), [data.invoices, draft?.id]);
  const sendErrors = useMemo(() => (draft ? validateInvoice(draft, { takenNumbers, mode: 'send' }) : {}), [draft, takenNumbers]);
  const draftErrors = useMemo(() => (draft ? validateInvoice(draft, { takenNumbers, mode: draft.lifecycle === 'draft' ? 'draft' : 'send' }) : {}), [draft, takenNumbers]);

  const shown: Record<string, string> = useMemo(() => {
    const base = attempt === 'send' ? sendErrors : attempt === 'draft' ? draftErrors : {};
    const out: Record<string, string> = { ...base };
    for (const k of touched) if (sendErrors[k]) out[k] = sendErrors[k];
    return { ...out, ...serverErrors };
  }, [attempt, sendErrors, draftErrors, touched, serverErrors]);

  const touch = useCallback((k: string) => setTouched((t) => (t.has(k) ? t : new Set(t).add(k))), []);
  const patch = useCallback((p: Partial<Invoice>) => { setDraft((d) => (d ? { ...d, ...p } : d)); setServerErrors({}); }, []);

  const saving = draft ? isPending(`save:${draft.id}`) : false;

  const persist = async (mode: 'draft' | 'send'): Promise<Invoice | null> => {
    if (!draft) return null;
    setAttempt(mode);
    setFormError('');
    const errs = mode === 'send' ? sendErrors : draftErrors;
    if (hasErrors(errs)) {
      setFormError(mode === 'send' ? 'Some details needed to send this invoice are missing.' : 'Fix the highlighted fields before saving.');
      requestAnimationFrame(() => focusInPane(document.querySelector('.inv [aria-invalid="true"]') as HTMLElement | null));
      setMobilePane('edit');
      return null;
    }
    try {
      const saved = await saveInvoice(draft);
      setDraft(saved);
      setBaseline(JSON.stringify(saved));
      if (!editingId) {
        // Keep the URL-equivalent route in sync so further saves edit this invoice.
        setLeaveGuard(null);
        navigate({ name: 'invoice-edit', id: saved.id });
      }
      return saved;
    } catch (err) {
      if ((err as any)?.code === 'duplicate') return null;
      if (err instanceof BillingError) {
        setServerErrors(err.fieldErrors);
        setFormError(err.message);
      } else setFormError('The invoice couldn’t be saved. Check your connection and try again.');
      return null;
    }
  };

  const onSaveDraft = async () => {
    const saved = await persist('draft');
    if (saved) toast({ tone: 'success', title: saved.lifecycle === 'draft' ? 'Draft saved' : 'Changes saved', body: saved.number });
  };

  const onSend = async () => {
    let saved: Invoice | null = draft;
    if (dirty || !editingId) saved = await persist('send');
    else {
      setAttempt('send');
      if (hasErrors(sendErrors)) { setFormError('Some details needed to send this invoice are missing.'); saved = null; }
    }
    if (saved) setSendOpen(true);
  };

  const onDownload = async () => {
    if (!doc) return;
    try {
      if ((await downloadInvoicePdf(doc)) === 'declined') return;
      toast({ tone: 'success', title: 'PDF downloaded', body: dirty ? 'Includes unsaved changes. Save to keep them.' : undefined });
    } catch {
      toast({ tone: 'error', title: 'PDF couldn’t be created', body: 'Try again, or remove the logo or signature image.' });
    }
  };

  // Cmd/Ctrl+S saves.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); void onSaveDraft(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  // ---- Splitter
  const startDrag = (e: React.PointerEvent) => {
    const grid = gridRef.current;
    if (!grid) return;
    e.preventDefault();
    const rect = grid.getBoundingClientRect();
    const move = (ev: PointerEvent) => setSplit(Math.min(68, Math.max(36, ((ev.clientX - rect.left) / rect.width) * 100)));
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  if (!draft || !totals || !doc) {
    return (
      <div className="p-6">
        <div className="inv-card">
          <EmptyState title="This invoice couldn’t be found" body="It may have been removed, or the link is out of date." action={<Button onClick={() => navigate({ name: 'invoices' })}>Back to invoices</Button>} />
        </div>
      </div>
    );
  }

  const existingStatus = existingView?.status;
  if (existingStatus === 'paid' || existingStatus === 'void') {
    return (
      <div className="p-6">
        <div className="inv-card">
          <EmptyState title={`${draft.number} can’t be edited`} body={existingStatus === 'paid' ? 'Paid invoices are locked to keep your records accurate. Duplicate it to bill again.' : 'Void invoices are kept for your records and can’t be changed.'}
            action={<div className="flex gap-2"><Button onClick={() => navigate({ name: 'invoice-view', id: draft.id })}>View invoice</Button><Button variant="primary" onClick={() => navigate({ name: 'invoice-new', duplicateOf: draft.id })}>Duplicate</Button></div>} />
        </div>
      </div>
    );
  }

  const setKind = (kind: InvoiceKind) => patch({
    kind,
    installments: kind === 'split' && draft.installments.length < 2 ? defaultInstallments(draft.issueDate, draft.dueDate) : draft.installments,
    recurring: kind === 'recurring' ? (draft.recurring ?? defaultRecurring(draft.issueDate, data.settings.defaultTermsDays)) : draft.recurring,
  });

  const selectClient = (c: Client) => { patch({ clientId: c.id, billTo: billToFromClient(c) }); setEditBillTo(false); touch('billTo.name'); };
  const termsDays = isValidISODate(draft.issueDate) && isValidISODate(draft.dueDate) ? daysBetween(draft.issueDate, draft.dueDate) : null;
  const installmentResults = draft.kind === 'split' ? calculateInstallments(totals.total, draft.installments) : [];
  const installmentSum = draft.installments.reduce((a, i) => a + (Number(i.percent) || 0), 0);
  const isSent = draft.lifecycle !== 'draft';
  const m = (v: bigint) => formatMoney(v, draft.currency);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Action bar */}
      <div className="flex flex-none flex-wrap items-center gap-2 px-4 py-3 @3xl:px-6" style={{ background: 'var(--inv-surface)', borderBottom: '1px solid var(--inv-border)' }}>
        <Button variant="ghost" size="sm" icon={<ArrowLeft size={15} />} onClick={() => navigate(editingId ? { name: 'invoice-view', id: editingId } : { name: 'invoices' })}>
          {editingId ? 'Back to invoice' : 'Invoices'}
        </Button>
        <span className="inv-faint hidden text-[12.5px] @xl:inline" aria-live="polite">
          {saving ? 'Saving…' : dirty ? 'Unsaved changes' : editingId ? 'All changes saved' : 'New draft'}
        </span>
        <div className="flex-1" />
        <Button size="sm" icon={<Download size={15} />} onClick={onDownload} className="hidden @xl:inline-flex">Download PDF</Button>
        <Button size="sm" icon={<Save size={15} />} onClick={onSaveDraft} loading={saving && attempt === 'draft'} disabled={saving}>
          {isSent ? 'Save changes' : 'Save draft'}
        </Button>
        <Button size="sm" variant="primary" icon={<Send size={15} />} onClick={onSend} loading={saving && attempt === 'send'} disabled={saving}>
          {isSent ? 'Save & resend' : 'Send invoice'}
        </Button>
        <Menu label="More invoice actions" items={[
          { label: 'Download PDF', icon: <Download size={15} />, onSelect: onDownload },
          { label: 'Duplicate', icon: <Copy size={15} />, disabled: !editingId, hint: editingId ? undefined : 'Save first', onSelect: () => navigate({ name: 'invoice-new', duplicateOf: draft.id }) },
        ]} trigger={(p) => <Button {...p} size="sm" iconOnly icon={<MoreHorizontal size={16} />} aria-label="More invoice actions" />} />
      </div>

      {/* Small screens: dedicated edit / preview views */}
      <div className="flex flex-none justify-center px-4 py-2.5 @5xl:hidden" style={{ borderBottom: '1px solid var(--inv-border)', background: 'var(--inv-surface-2)' }}>
        <SegmentedControl<"edit" | "preview"> label="Editor view" value={mobilePane} onChange={setMobilePane} options={[{ value: 'edit', label: 'Edit' }, { value: 'preview', label: 'Preview' }]} />
      </div>

      <div
        ref={gridRef}
        className="grid min-h-0 flex-1 grid-cols-1 @5xl:grid-cols-[minmax(0,var(--split))_10px_minmax(0,1fr)]"
        style={{ ['--split' as any]: `${split}%` }}
      >
        {/* ---------- Editor ---------- */}
        <div className={cx('min-h-0 overflow-y-auto @5xl:block', mobilePane !== 'edit' && 'hidden')}>
          <form noValidate onSubmit={(e) => { e.preventDefault(); void onSaveDraft(); }} className="mx-auto max-w-[760px] space-y-4 p-4 @3xl:p-6">
            <div className="space-y-2">
              <SegmentedControl<InvoiceKind> label="Invoice type" value={draft.kind} onChange={setKind}
                options={[{ value: 'standard', label: 'Standard' }, { value: 'split', label: 'Split' }, { value: 'recurring', label: 'Recurring' }]} />
              <p className="inv-muted text-[12.5px]">{KIND_HELP[draft.kind]}</p>
            </div>

            {formError && (
              <InlineAlert tone="danger" title={formError}>
                {Object.keys(shown).length > 0 && <span className="inv-muted text-[12.5px]">{Object.keys(shown).length} field{Object.keys(shown).length === 1 ? '' : 's'} need attention.</span>}
              </InlineAlert>
            )}
            {isSent && (
              <InlineAlert tone="info">
                This invoice was already sent. Saving won’t email the client again; use “Save &amp; resend” to send the updated version.
              </InlineAlert>
            )}
            {shown.total && <InlineAlert tone="danger">{shown.total}</InlineAlert>}

            <Section id="sec-details" title="Invoice details">
              <div className="grid grid-cols-1 gap-3 @lg:grid-cols-2">
                <Input label="Invoice number" required value={draft.number} onChange={(e) => patch({ number: e.target.value })} onBlur={() => touch('number')} error={shown.number} />
                <Select label="Currency" value={draft.currency} onChange={(v) => patch({ currency: v as any })}
                  disabled={payments.length > 0} hint={payments.length > 0 ? 'Locked because payments are recorded.' : undefined}
                  options={CURRENCIES.map((c) => ({ value: c.code, label: `${c.code} · ${c.name}` }))} />
                <DateField label="Issue date" required value={draft.issueDate}
                  onChange={(v) => patch({ issueDate: v, dueDate: termsDays !== null && isValidISODate(v) ? addDays(v, termsDays) : draft.dueDate })}
                  onBlur={() => touch('issueDate')} error={shown.issueDate} />
                <DateField label="Due date" required value={draft.dueDate} min={draft.issueDate} onChange={(v) => patch({ dueDate: v })} onBlur={() => touch('dueDate')} error={shown.dueDate}
                  hint={termsDays !== null && termsDays >= 0 ? (termsDays === 0 ? 'Due on receipt' : `${termsDays} days after issue`) : undefined} />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-1.5" role="group" aria-label="Payment terms">
                <span className="inv-faint mr-1 text-[12px]">Terms</span>
                {TERMS.map((t) => (
                  <button key={t.days} type="button" onClick={() => isValidISODate(draft.issueDate) && patch({ dueDate: addDays(draft.issueDate, t.days) })}
                    aria-pressed={termsDays === t.days}
                    className="rounded-full px-2.5 py-1 text-[12px] font-medium"
                    style={{ border: '1px solid var(--inv-border-strong)', background: termsDays === t.days ? 'var(--inv-primary-tint)' : 'var(--inv-surface)', color: termsDays === t.days ? 'var(--inv-primary-ink)' : 'var(--inv-muted)', cursor: 'pointer' }}>
                    {t.label}
                  </button>
                ))}
              </div>
            </Section>

            <Section id="sec-from" title="From" description="Your business details on this invoice."
              actions={<Button size="sm" variant="ghost" onClick={() => setEditIssuer((v) => !v)}>{editIssuer ? 'Done' : 'Edit'}</Button>}>
              {!editIssuer ? (
                <div className="flex items-start gap-3 text-[13px]">
                  {draft.issuer.logoDataUrl
                    ? <img src={draft.issuer.logoDataUrl} alt="Business logo" className="h-10 w-10 rounded-lg object-contain" style={{ border: '1px solid var(--inv-border)' }} />
                    : <span className="flex h-10 w-10 flex-none items-center justify-center rounded-lg font-semibold text-white" style={{ background: 'var(--inv-primary)' }} aria-hidden>{draft.issuer.name.charAt(0) || 'B'}</span>}
                  <div className="min-w-0">
                    <p className={cx('font-semibold', !draft.issuer.name && 'inv-faint')}>{draft.issuer.name || 'Add your business name'}</p>
                    <p className="inv-muted">{[draft.issuer.email, draft.issuer.phone].filter(Boolean).join(' · ')}</p>
                    <p className="inv-muted">{[draft.issuer.address.line1, draft.issuer.address.city, draft.issuer.address.country].filter(Boolean).join(', ')}</p>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 @lg:grid-cols-2">
                  <Input inputSize="sm" label="Business name" required value={draft.issuer.name} onChange={(e) => patch({ issuer: { ...draft.issuer, name: e.target.value } })} onBlur={() => touch('issuer.name')} error={shown['issuer.name']} />
                  <Input inputSize="sm" label="Email" type="email" value={draft.issuer.email} onChange={(e) => patch({ issuer: { ...draft.issuer, email: e.target.value } })} onBlur={() => touch('issuer.email')} error={shown['issuer.email']} />
                  <Input inputSize="sm" label="Phone" value={draft.issuer.phone} onChange={(e) => patch({ issuer: { ...draft.issuer, phone: e.target.value } })} />
                  <Input inputSize="sm" label="Website" value={draft.issuer.website} onChange={(e) => patch({ issuer: { ...draft.issuer, website: e.target.value } })} />
                  <div className="@lg:col-span-2">
                    <AddressFields value={draft.issuer.address} onChange={(a) => patch({ issuer: { ...draft.issuer, address: a } })} prefix="issuer" errors={shown} onBlur={touch} />
                  </div>
                  <Input inputSize="sm" label={`${draft.issuer.taxIdLabel || 'Tax ID'}`} value={draft.issuer.taxId} onChange={(e) => patch({ issuer: { ...draft.issuer, taxId: e.target.value } })} />
                  <div>
                    <span className="inv-label">Logo</span>
                    <div className="flex items-center gap-2">
                      <label className="inv-btn inv-btn-secondary inv-btn-sm" style={{ cursor: 'pointer' }}>
                        <ImagePlus size={14} /> {draft.issuer.logoDataUrl ? 'Replace' : 'Upload'}
                        <input type="file" accept="image/png,image/jpeg" className="sr-only-inv" onChange={async (e) => {
                          const f = e.target.files?.[0];
                          e.target.value = '';
                          if (!f) return;
                          try { patch({ issuer: { ...draft.issuer, logoDataUrl: await readImage(f) } }); } catch (err: any) { toast({ tone: 'error', title: 'Logo not added', body: err.message }); }
                        }} />
                      </label>
                      {draft.issuer.logoDataUrl && <Button size="sm" variant="ghost" onClick={() => patch({ issuer: { ...draft.issuer, logoDataUrl: '' } })}>Remove</Button>}
                    </div>
                  </div>
                  <p className="inv-faint @lg:col-span-2 text-[12px]">Changes here apply to this invoice only. Update defaults in Settings.</p>
                </div>
              )}
            </Section>

            <Section id="sec-billto" title="Bill to"
              actions={draft.clientId || draft.billTo.name ? <Button size="sm" variant="ghost" onClick={() => setEditBillTo((v) => !v)}>{editBillTo ? 'Done' : 'Edit details'}</Button> : undefined}>
              <ClientPicker
                clients={data.clients}
                selectedId={draft.clientId}
                onSelect={selectClient}
                onClear={() => patch({ clientId: null, billTo: emptyBillTo() })}
                onCreate={() => openClientDialog({ onCreated: selectClient })}
                error={!draft.clientId && !editBillTo ? shown['billTo.name'] : undefined}
              />
              {(draft.clientId || draft.billTo.name) && !editBillTo && (
                <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1.5 text-[12.5px] @lg:grid-cols-2">
                  <div><dt className="inv-faint">Email</dt><dd style={{ color: shown['billTo.email'] ? 'var(--inv-danger)' : undefined }}>{draft.billTo.email || '—'}</dd></div>
                  <div><dt className="inv-faint">Phone</dt><dd>{draft.billTo.phone || '—'}</dd></div>
                  <div className="@lg:col-span-2"><dt className="inv-faint">Billing address</dt><dd style={{ color: shown['billTo.address.line1'] ? 'var(--inv-danger)' : undefined }}>{[draft.billTo.address.line1, draft.billTo.address.city, draft.billTo.address.postalCode, draft.billTo.address.country].filter(Boolean).join(', ') || 'Missing'}</dd></div>
                  {draft.billTo.taxId && <div><dt className="inv-faint">{draft.billTo.taxIdLabel || 'Tax ID'}</dt><dd>{draft.billTo.taxId}</dd></div>}
                  {(shown['billTo.email'] || shown['billTo.address.line1']) && <p className="inv-error @lg:col-span-2">Some billing details are missing. Choose “Edit details” to add them.</p>}
                </dl>
              )}
              {editBillTo && (
                <div className="mt-4 grid grid-cols-1 gap-3 @lg:grid-cols-2">
                  <Input inputSize="sm" label="Contact name" required value={draft.billTo.name} onChange={(e) => patch({ billTo: { ...draft.billTo, name: e.target.value } })} onBlur={() => touch('billTo.name')} error={shown['billTo.name']} />
                  <Input inputSize="sm" label="Company" value={draft.billTo.company} onChange={(e) => patch({ billTo: { ...draft.billTo, company: e.target.value } })} />
                  <Input inputSize="sm" label="Email" type="email" required value={draft.billTo.email} onChange={(e) => patch({ billTo: { ...draft.billTo, email: e.target.value } })} onBlur={() => touch('billTo.email')} error={shown['billTo.email']} />
                  <Input inputSize="sm" label="Phone" value={draft.billTo.phone} onChange={(e) => patch({ billTo: { ...draft.billTo, phone: e.target.value } })} />
                  <div className="@lg:col-span-2">
                    <AddressFields value={draft.billTo.address} onChange={(a) => patch({ billTo: { ...draft.billTo, address: a } })} prefix="billTo" errors={shown} onBlur={touch} />
                  </div>
                  <Input inputSize="sm" label={draft.billTo.taxIdLabel || 'Tax ID'} value={draft.billTo.taxId} onChange={(e) => patch({ billTo: { ...draft.billTo, taxId: e.target.value, taxIdLabel: draft.billTo.taxIdLabel || 'Tax ID' } })} />
                  <p className="inv-faint @lg:col-span-2 text-[12px]">Edits apply to this invoice only. The client record isn’t changed.</p>
                </div>
              )}
            </Section>

            <Section id="sec-items" title="Items and services" description="Prices exclude tax. Tax is calculated per line.">
              <ItemsEditor items={draft.items} onChange={(items) => patch({ items })} totals={totals} currency={draft.currency}
                errors={shown} onBlurField={touch} defaultTaxRate={data.settings.defaultTaxRate} listError={shown.items} />
            </Section>

            <Section id="sec-adjust" title="Discount and fees" description="Discounts apply before tax. Fees are added after tax.">
              <div className="grid grid-cols-1 gap-3 @lg:grid-cols-[150px_1fr]">
                <Select inputSize="sm" label="Discount type" value={draft.discount.type} onChange={(v) => patch({ discount: { type: v as any, value: '' } })}
                  options={[{ value: 'percent', label: 'Percentage' }, { value: 'fixed', label: 'Fixed amount' }]} />
                <Input inputSize="sm" label="Discount" inputMode="decimal" placeholder="None"
                  prefix={draft.discount.type === 'fixed' ? draft.currency : undefined} suffix={draft.discount.type === 'percent' ? '%' : undefined}
                  value={draft.discount.value} onChange={(e) => patch({ discount: { ...draft.discount, value: e.target.value } })}
                  onBlur={() => touch('discount.value')} error={shown['discount.value']}
                  hint={totals.discount > 0n ? `−${m(totals.discount)} off the subtotal` : undefined} />
              </div>
              <div className="mt-4 space-y-2">
                {draft.fees.map((f) => (
                  <div key={f.id} className="grid grid-cols-[1fr_140px_auto] items-start gap-2">
                    <Input inputSize="sm" aria-label="Fee name" placeholder="e.g. Shipping" value={f.label} onChange={(e) => patch({ fees: draft.fees.map((x) => (x.id === f.id ? { ...x, label: e.target.value } : x)) })} onBlur={() => touch(`fees.${f.id}.label`)} error={shown[`fees.${f.id}.label`]} />
                    <Input inputSize="sm" aria-label="Fee amount" inputMode="decimal" prefix={draft.currency} className="text-right" value={f.amount} onChange={(e) => patch({ fees: draft.fees.map((x) => (x.id === f.id ? { ...x, amount: e.target.value } : x)) })} onBlur={() => touch(`fees.${f.id}.amount`)} error={shown[`fees.${f.id}.amount`]} />
                    <Button size="sm" variant="ghost" iconOnly icon={<X size={14} />} aria-label="Remove fee" onClick={() => patch({ fees: draft.fees.filter((x) => x.id !== f.id) })} />
                  </div>
                ))}
                <Button size="sm" variant="ghost" icon={<Plus size={14} />} onClick={() => patch({ fees: [...draft.fees, newFee()] })}>Add fee</Button>
              </div>
            </Section>

            {draft.kind === 'split' && (
              <Section id="sec-split" title="Payment schedule" description="Shares of the grand total. Amounts are rounded so they add up exactly.">
                <div className="space-y-2">
                  {draft.installments.map((ins, i) => (
                    <div key={ins.id} className="grid grid-cols-[minmax(0,1fr)_96px] items-start gap-2 @2xl:grid-cols-[minmax(0,1fr)_84px_150px_minmax(0,130px)]">
                      <Input inputSize="sm" aria-label={`Installment ${i + 1} name`} value={ins.label} onChange={(e) => patch({ installments: draft.installments.map((x) => (x.id === ins.id ? { ...x, label: e.target.value } : x)) })} />
                      <Input inputSize="sm" aria-label={`Installment ${i + 1} share`} suffix="%" inputMode="decimal" className="text-right" value={ins.percent} onChange={(e) => patch({ installments: draft.installments.map((x) => (x.id === ins.id ? { ...x, percent: e.target.value } : x)) })} error={shown[`installments.${ins.id}.percent`]} />
                      <DateField inputSize="sm" aria-label={`Installment ${i + 1} due date`} value={ins.dueDate} onChange={(v) => patch({ installments: draft.installments.map((x) => (x.id === ins.id ? { ...x, dueDate: v } : x)) })} error={shown[`installments.${ins.id}.dueDate`]} />
                      <div className="flex items-center justify-end gap-1">
                      <span className="num text-right text-[13px] font-semibold">{m(installmentResults[i]?.amount ?? 0n)}</span>
                      <Button size="sm" variant="ghost" iconOnly icon={<Trash2 size={14} />} aria-label={`Remove installment ${i + 1}`} disabled={draft.installments.length <= 2} onClick={() => patch({ installments: draft.installments.filter((x) => x.id !== ins.id) })} />
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <Button size="sm" variant="ghost" icon={<Plus size={14} />} onClick={() => patch({ installments: [...draft.installments, { id: uid('ins'), label: `Installment ${draft.installments.length + 1}`, percent: '', dueDate: draft.dueDate }] })}>Add installment</Button>
                  <span className="num text-[12.5px]" style={{ color: Math.abs(installmentSum - 100) < 0.0005 ? 'var(--inv-success)' : 'var(--inv-warning)' }}>{formatRate(BigInt(Math.round(installmentSum * 1000)))}% of 100%</span>
                </div>
                {shown.installments && <p className="inv-error" role="alert">{shown.installments}</p>}
              </Section>
            )}

            {draft.kind === 'recurring' && draft.recurring && (
              <Section id="sec-recur" title="Schedule" description="Future invoices copy these items and are saved as drafts for review.">
                <div className="grid grid-cols-1 gap-3 @lg:grid-cols-2">
                  <Select inputSize="sm" label="Repeats" value={draft.recurring.frequency} onChange={(v) => patch({ recurring: { ...draft.recurring!, frequency: v as any } })}
                    options={[{ value: 'weekly', label: 'Weekly' }, { value: 'monthly', label: 'Monthly' }, { value: 'quarterly', label: 'Quarterly' }, { value: 'yearly', label: 'Yearly' }]} />
                  <DateField inputSize="sm" label="Starts" value={draft.recurring.startDate} onChange={(v) => patch({ recurring: { ...draft.recurring!, startDate: v } })} error={shown['recurring.startDate']} />
                  <Select inputSize="sm" label="Ends" value={draft.recurring.endType} onChange={(v) => patch({ recurring: { ...draft.recurring!, endType: v as any } })}
                    options={[{ value: 'never', label: 'Never' }, { value: 'after', label: 'After a number of invoices' }, { value: 'on', label: 'On a date' }]} />
                  {draft.recurring.endType === 'after' && <Input inputSize="sm" label="Number of invoices" inputMode="numeric" value={draft.recurring.occurrences} onChange={(e) => patch({ recurring: { ...draft.recurring!, occurrences: e.target.value } })} error={shown['recurring.occurrences']} />}
                  {draft.recurring.endType === 'on' && <DateField inputSize="sm" label="End date" value={draft.recurring.endDate} onChange={(v) => patch({ recurring: { ...draft.recurring!, endDate: v } })} error={shown['recurring.endDate']} />}
                  <Input inputSize="sm" label="Each invoice is due after" suffix="days" inputMode="numeric" value={draft.recurring.dueInDays} onChange={(e) => patch({ recurring: { ...draft.recurring!, dueInDays: e.target.value } })} error={shown['recurring.dueInDays']} />
                </div>
                <p className="inv-faint mt-3 text-[12px]">Generating future invoices needs the billing server’s scheduler. Nothing is sent automatically.</p>
              </Section>
            )}

            <Section id="sec-notes" title="Payment and notes">
              <div className="space-y-3">
                <Textarea label="Payment instructions" rows={3} value={draft.paymentInstructions} onChange={(e) => patch({ paymentInstructions: e.target.value })} hint="Bank details or how to pay. Shown on the invoice." />
                <Textarea label="Notes" rows={2} value={draft.notes} onChange={(e) => patch({ notes: e.target.value })} />
                <label className="flex cursor-pointer items-center gap-2.5 pt-1 text-[13px] font-medium">
                  <input type="checkbox" className="inv-check" checked={draft.signature.enabled} onChange={(e) => patch({ signature: { ...draft.signature, enabled: e.target.checked } })} />
                  Add a signature
                </label>
                {draft.signature.enabled && (
                  <div className="grid grid-cols-1 gap-3 @lg:grid-cols-2">
                    <Input inputSize="sm" label="Signer name" value={draft.signature.name} onChange={(e) => patch({ signature: { ...draft.signature, name: e.target.value } })} onBlur={() => touch('signature.name')} error={shown['signature.name']} />
                    <Input inputSize="sm" label="Title" value={draft.signature.title} onChange={(e) => patch({ signature: { ...draft.signature, title: e.target.value } })} />
                    <div className="@lg:col-span-2 flex items-center gap-2">
                      <label className="inv-btn inv-btn-secondary inv-btn-sm" style={{ cursor: 'pointer' }}>
                        <ImagePlus size={14} /> {draft.signature.imageDataUrl ? 'Replace signature image' : 'Upload signature image'}
                        <input type="file" accept="image/png,image/jpeg" className="sr-only-inv" onChange={async (e) => {
                          const f = e.target.files?.[0];
                          e.target.value = '';
                          if (!f) return;
                          try { patch({ signature: { ...draft.signature, imageDataUrl: await readImage(f) } }); } catch (err: any) { toast({ tone: 'error', title: 'Signature not added', body: err.message }); }
                        }} />
                      </label>
                      {draft.signature.imageDataUrl ? <Button size="sm" variant="ghost" onClick={() => patch({ signature: { ...draft.signature, imageDataUrl: '' } })}>Use typed name</Button>
                        : <span className="inv-faint text-[12px]">Without an image, the name is shown in script.</span>}
                    </div>
                  </div>
                )}
              </div>
            </Section>

            <section aria-labelledby="sec-totals" className="inv-card p-5">
              <h2 id="sec-totals" className="inv-h3 mb-3">Summary</h2>
              <dl className="num space-y-1.5 text-[13px]">
                <div className="flex justify-between"><dt className="inv-muted">Subtotal</dt><dd>{m(totals.subtotal)}</dd></div>
                <div className="flex justify-between"><dt className="inv-muted">Discount{totals.discountRate !== null && totals.discount > 0n ? ` (${formatRate(totals.discountRate)}%)` : ''}</dt><dd>{totals.discount > 0n ? `−${m(totals.discount)}` : m(0n)}</dd></div>
                <div className="flex justify-between"><dt className="inv-muted">Tax</dt><dd>{m(totals.tax)}</dd></div>
                {totals.fees.map((f) => <div key={f.id} className="flex justify-between"><dt className="inv-muted">{f.label || 'Fee'}</dt><dd>{m(f.amount)}</dd></div>)}
                <div className="flex justify-between pt-2 text-[14px] font-semibold" style={{ borderTop: '1px solid var(--inv-border)' }}><dt>Grand total</dt><dd>{m(totals.total)}</dd></div>
                <div className="flex justify-between"><dt className="inv-muted">Amount paid</dt><dd>{totals.amountPaid > 0n ? `−${m(totals.amountPaid)}` : m(0n)}</dd></div>
                <div className="flex justify-between rounded-lg px-3 py-2 text-[14px] font-semibold" style={{ background: 'var(--inv-primary-tint)', color: 'var(--inv-primary-ink)' }}><dt>Balance due</dt><dd>{m(totals.balanceDue)}</dd></div>
              </dl>
            </section>
          </form>
        </div>

        {/* ---------- Splitter ---------- */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize editor and preview"
          aria-valuemin={36} aria-valuemax={68} aria-valuenow={Math.round(split)}
          tabIndex={0}
          onPointerDown={startDrag}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') setSplit((s) => Math.max(36, s - 2));
            if (e.key === 'ArrowRight') setSplit((s) => Math.min(68, s + 2));
          }}
          className="group relative hidden cursor-col-resize @5xl:block"
          style={{ background: 'var(--inv-surface-2)', borderLeft: '1px solid var(--inv-border)', borderRight: '1px solid var(--inv-border)' }}
        >
          <span className="absolute left-1/2 top-1/2 h-10 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ background: 'var(--inv-border-strong)' }} aria-hidden />
        </div>

        {/* ---------- Preview ---------- */}
        <div className={cx('min-h-0 overflow-y-auto @5xl:block', mobilePane !== 'preview' && 'hidden')} style={{ background: 'var(--inv-surface-3)' }}>
          <div className="sticky top-0 z-10 flex items-center justify-between gap-2 px-4 py-2" style={{ background: 'var(--inv-surface-3)' }}>
            <span className="inv-muted text-[12.5px] font-medium">Live preview <span className="inv-faint">· matches the PDF</span></span>
            <div className="flex items-center gap-1">
              <Select inputSize="sm" aria-label="Preview zoom" value={String(zoom)} onChange={(v) => setZoom(v === 'fit' ? 'fit' : Number(v))} containerClassName="w-[96px]"
                options={[{ value: 'fit', label: 'Fit' }, { value: '0.75', label: '75%' }, { value: '1', label: '100%' }]} />
              <Button size="sm" variant="ghost" iconOnly icon={<Download size={15} />} aria-label="Download PDF" onClick={onDownload} />
            </div>
          </div>
          <div className="px-4 pb-8 @3xl:px-8" aria-live="off">
            <ScaledPaper doc={doc} zoom={zoom} />
          </div>
        </div>
      </div>

      <SendDialog open={sendOpen} view={sendOpen ? buildInvoiceView(draft, data.payments, today) : null} onClose={() => setSendOpen(false)}
        onResult={() => navigate({ name: 'invoice-view', id: draft.id })} />
    </div>
  );
}
