/**
 * Dashboard dialogs: create a deal (POST /api/dashboard/deals, unchanged) and customize the layout.
 */
import React, { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Eye, EyeOff, Plus, RotateCcw, X } from 'lucide-react';
import { invalidateDashboard } from '../../lib/dashboardData';
import { Button, IconButton, cx, focusRing } from './ui';

/** Accessible modal shell: Escape closes, focus moves in and returns, background is inert to clicks. */
export function Dialog({ open, onClose, title, description, children, footer, width = 'max-w-lg' }: {
  open: boolean; onClose: () => void; title: string; description?: string; children: React.ReactNode; footer?: React.ReactNode; width?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('input, select, textarea, button:not([data-close])');
    (first || ref.current)?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); previous?.focus?.(); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px] animate-in fade-in duration-150" onClick={onClose} aria-hidden="true" />
      <div
        ref={ref}
        role="dialog" aria-modal="true" aria-labelledby="dlg-title" aria-describedby={description ? 'dlg-desc' : undefined} tabIndex={-1}
        className={cx('relative w-full max-h-[92vh] overflow-y-auto bg-[var(--surface)] border border-[var(--border)] shadow-2xl rounded-t-2xl sm:rounded-[var(--radius-panel)] animate-in slide-in-from-bottom-4 sm:zoom-in-95 duration-150', width)}
      >
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3 border-b border-[var(--border)]">
          <div>
            <h2 id="dlg-title" className="text-[15px] font-semibold text-[var(--text)]">{title}</h2>
            {description && <p id="dlg-desc" className="text-[12px] text-[var(--text-muted)] mt-0.5">{description}</p>}
          </div>
          <IconButton label="Close" data-close onClick={onClose}><X className="h-4 w-4" /></IconButton>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 px-5 pb-5">{footer}</div>}
      </div>
    </div>
  );
}

const field = 'w-full h-9 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-3 text-[13px] text-[var(--text)] placeholder:text-[var(--text-subtle)] focus:outline-none focus:border-[var(--focus-ring)] focus:ring-2 focus:ring-[var(--focus-ring)]/25 aria-[invalid=true]:border-[var(--danger)]';
const labelCls = 'block text-[12px] font-medium text-[var(--text)] mb-1';

const EMPTY = { name: '', client: '', value: '', stage: 'discovery', channelOrigin: 'email', expectedClose: '' };

export function NewDealDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (msg: string) => void }) {
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) { setErrors({}); setServerError(null); } }, [open]);

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = 'Give the deal a name.';
    if (!form.client.trim()) e.client = 'Who is the client?';
    const v = Number(form.value);
    if (form.value === '' || !Number.isFinite(v) || v < 0) e.value = 'Enter an amount of 0 or more.';
    setErrors(e);
    return !Object.keys(e).length;
  };

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!validate()) return;
    setSaving(true); setServerError(null);
    try {
      const res = await fetch('/api/dashboard/deals', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, name: form.name.trim(), client: form.client.trim(), value: Number(form.value) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'The deal couldn\'t be saved. Try again.');
      invalidateDashboard();
      onCreated(`Deal "${form.name.trim()}" added to your pipeline.`);
      setForm(EMPTY);
      onClose();
    } catch (err: any) {
      setServerError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => { setForm({ ...form, [k]: e.target.value }); if (errors[k]) setErrors({ ...errors, [k]: '' }); };
  const err = (k: string) => errors[k] ? <p id={`deal-${k}-err`} className="mt-1 text-[11px] text-[var(--danger)]">{errors[k]}</p> : null;

  return (
    <Dialog
      open={open} onClose={onClose} title="New deal" description="Adds an opportunity to your pipeline."
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" type="submit" form="new-deal-form" disabled={saving} icon={<Plus className="h-4 w-4" />}>{saving ? 'Saving…' : 'Create deal'}</Button>
      </>}
    >
      <form id="new-deal-form" onSubmit={submit} noValidate className="space-y-3.5">
        {serverError && <p role="alert" className="rounded-lg bg-[var(--danger-soft)] text-[var(--danger)] px-3 py-2 text-[12px]">{serverError}</p>}
        <div>
          <label htmlFor="deal-name" className={labelCls}>Deal name</label>
          <input id="deal-name" className={field} value={form.name} onChange={set('name')} placeholder="e.g. Website redesign" aria-invalid={!!errors.name} aria-describedby={errors.name ? 'deal-name-err' : undefined} />
          {err('name')}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="deal-client" className={labelCls}>Client</label>
            <input id="deal-client" className={field} value={form.client} onChange={set('client')} placeholder="Company or person" aria-invalid={!!errors.client} aria-describedby={errors.client ? 'deal-client-err' : undefined} />
            {err('client')}
          </div>
          <div>
            <label htmlFor="deal-value" className={labelCls}>Value (USD)</label>
            <input id="deal-value" type="number" inputMode="decimal" min="0" step="any" className={cx(field, 'tabular-nums')} value={form.value} onChange={set('value')} placeholder="0" aria-invalid={!!errors.value} aria-describedby={errors.value ? 'deal-value-err' : undefined} />
            {err('value')}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor="deal-stage" className={labelCls}>Stage</label>
            <select id="deal-stage" className={field} value={form.stage} onChange={set('stage')}>
              <option value="lead">Lead</option><option value="discovery">Discovery</option><option value="qualified">Qualified</option>
              <option value="proposal">Proposal</option><option value="negotiation">Negotiation</option><option value="won">Won</option>
            </select>
          </div>
          <div>
            <label htmlFor="deal-source" className={labelCls}>Source</label>
            <select id="deal-source" className={field} value={form.channelOrigin} onChange={set('channelOrigin')}>
              <option value="email">Email</option><option value="whatsapp">WhatsApp</option><option value="voice">Phone</option>
              <option value="linkedin">LinkedIn</option><option value="web">Website</option><option value="sms">SMS</option><option value="referral">Referral</option>
            </select>
          </div>
          <div>
            <label htmlFor="deal-close" className={labelCls}>Expected close</label>
            <input id="deal-close" type="date" className={field} value={form.expectedClose} onChange={set('expectedClose')} />
          </div>
        </div>
      </form>
    </Dialog>
  );
}

export interface SectionPref { id: string; label: string; description: string }

export function CustomizeDialog({ open, onClose, sections, order, hidden, onChange, onReset }: {
  open: boolean; onClose: () => void; sections: SectionPref[]; order: string[]; hidden: string[];
  onChange: (order: string[], hidden: string[]) => void; onReset: () => void;
}) {
  const byId = Object.fromEntries(sections.map((s) => [s.id, s]));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d; if (j < 0 || j >= order.length) return;
    const next = [...order]; [next[i], next[j]] = [next[j], next[i]]; onChange(next, hidden);
  };
  const toggle = (id: string) => onChange(order, hidden.includes(id) ? hidden.filter((h) => h !== id) : [...hidden, id]);
  return (
    <Dialog
      open={open} onClose={onClose} title="Customize your dashboard" description="Show, hide and reorder sections. Saved for you in this browser."
      footer={<>
        <Button variant="ghost" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={onReset}>Reset to default</Button>
        <Button variant="primary" onClick={onClose}>Done</Button>
      </>}
    >
      <ul className="space-y-1.5" aria-label="Dashboard sections">
        {order.filter((id) => byId[id]).map((id, i) => {
          const s = byId[id]; const isHidden = hidden.includes(id);
          return (
            <li key={id} className={cx('flex items-center gap-3 rounded-xl border border-[var(--border)] px-3 py-2.5', isHidden && 'opacity-60')}>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-[var(--text)]">{s.label}</p>
                <p className="text-[11px] text-[var(--text-muted)] truncate">{s.description}</p>
              </div>
              <IconButton label={`Move ${s.label} up`} onClick={() => move(i, -1)} disabled={i === 0}><ArrowUp className="h-4 w-4" /></IconButton>
              <IconButton label={`Move ${s.label} down`} onClick={() => move(i, 1)} disabled={i === order.length - 1}><ArrowDown className="h-4 w-4" /></IconButton>
              <button
                type="button" role="switch" aria-checked={!isHidden} aria-label={`Show ${s.label}`} onClick={() => toggle(id)}
                className={cx('inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-control)] px-2.5 text-[12px] font-medium cursor-pointer', isHidden ? 'bg-[var(--surface-sunken)] text-[var(--text-muted)]' : 'bg-[var(--accent-soft)] text-[var(--accent-text)]', focusRing)}
              >
                {isHidden ? <EyeOff className="h-3.5 w-3.5" aria-hidden="true" /> : <Eye className="h-3.5 w-3.5" aria-hidden="true" />}
                {isHidden ? 'Hidden' : 'Shown'}
              </button>
            </li>
          );
        })}
      </ul>
    </Dialog>
  );
}
