/**
 * Edit a location's regular opening hours (Google Business Profile, Business Information API `regularHours`).
 * Two steps: edit, then confirm a plain-language summary of what changes, because Google shows hours to every
 * customer. One opening period per day here (split shifts can be set in Google). Closing before opening means
 * the business closes after midnight.
 */
import React, { useMemo, useState } from 'react';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';

const DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'] as const;
const LABEL: Record<string, string> = { MONDAY: 'Monday', TUESDAY: 'Tuesday', WEDNESDAY: 'Wednesday', THURSDAY: 'Thursday', FRIDAY: 'Friday', SATURDAY: 'Saturday', SUNDAY: 'Sunday' };
type Row = { open: boolean; from: string; to: string; extra: number };
type Period = { day: string; open: string; close: string };

const describe = (r: Row) => (!r.open ? 'Closed' : r.from === '00:00' && r.to === '24:00' ? 'Open 24 hours' : `${r.from}–${r.to}${r.to <= r.from ? ' (closes after midnight)' : ''}`);

export function HoursEditor({ isOpen, onClose, current, locationName, onSave }: {
  isOpen: boolean; onClose: () => void; current: Period[]; locationName: string;
  onSave: (hours: Period[]) => Promise<void>;
}) {
  const initial = useMemo(() => Object.fromEntries(DAYS.map((d) => {
    const ps = current.filter((p) => p.day === d);
    return [d, ps.length ? { open: true, from: ps[0].open, to: ps[0].close === '00:00' && ps[0].open === '00:00' ? '24:00' : ps[0].close, extra: ps.length - 1 } : { open: false, from: '09:00', to: '17:00', extra: 0 }];
  })) as Record<string, Row>, [current]);
  const [rows, setRows] = useState<Record<string, Row>>(initial);
  const [step, setStep] = useState<'edit' | 'confirm'>('edit');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  React.useEffect(() => { if (isOpen) { setRows(initial); setStep('edit'); setError(''); } }, [isOpen, initial]);

  const invalid = DAYS.filter((d) => rows[d].open && (rows[d].from === rows[d].to || !/^\d{2}:\d{2}$/.test(rows[d].from) || !/^\d{2}:\d{2}$/.test(rows[d].to)));
  const changes = DAYS.filter((d) => describe(rows[d]) !== describe(initial[d]));
  const dropsSplit = DAYS.filter((d) => initial[d].extra > 0 && changes.includes(d));
  const set = (d: string, patch: Partial<Row>) => setRows((r) => ({ ...r, [d]: { ...r[d], ...patch } }));

  const save = async () => {
    setSaving(true); setError('');
    try {
      // Days you didn't change keep exactly what Google has (including split shifts).
      await onSave(DAYS.flatMap((d) => (!changes.includes(d) ? current.filter((p) => p.day === d)
        : rows[d].open ? [{ day: d, open: rows[d].from, close: rows[d].to }] : [])));
      onClose();
    } catch (e: any) { setError(e?.message || 'Google didn’t accept the change. Try again.'); setStep('edit'); }
    finally { setSaving(false); }
  };

  return (
    <Dialog isOpen={isOpen} onClose={saving ? () => {} : onClose} size="md" title={step === 'edit' ? 'Edit opening hours' : 'Confirm the new hours'}
      description={step === 'edit' ? `Regular hours for ${locationName}, as customers see them on Google.` : 'Customers will see these hours on Google Search and Maps. Google may review the change first.'}
      footer={step === 'edit' ? (
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => setStep('confirm')} disabled={!changes.length || invalid.length > 0}>Review changes</Button>
        </>
      ) : (
        <>
          <Button variant="ghost" onClick={() => setStep('edit')} disabled={saving}>Back</Button>
          <Button onClick={save} isLoading={saving}>Save to Google</Button>
        </>
      )}>
      {step === 'edit' ? (
        <div className="space-y-2">
          {DAYS.map((d) => {
            const r = rows[d];
            const id = `hours-${d.toLowerCase()}`;
            return (
              <fieldset key={d} className="grid grid-cols-[110px_1fr] items-center gap-3 rounded-lg border border-slate-200 px-3 py-2">
                <legend className="sr-only">{LABEL[d]}</legend>
                <label htmlFor={`${id}-open`} className="flex items-center gap-2 text-sm font-medium text-slate-800">
                  <input id={`${id}-open`} type="checkbox" checked={r.open} onChange={(e) => set(d, { open: e.target.checked })} />
                  {LABEL[d]}
                </label>
                {r.open ? (
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <label className="sr-only" htmlFor={`${id}-from`}>{LABEL[d]} opens</label>
                    <input id={`${id}-from`} type="time" value={r.from} onChange={(e) => set(d, { from: e.target.value })} className="rounded-md border border-slate-300 bg-white px-2 py-1 text-slate-900" />
                    <span className="text-slate-500">to</span>
                    <label className="sr-only" htmlFor={`${id}-to`}>{LABEL[d]} closes</label>
                    <input id={`${id}-to`} type="time" value={r.to === '24:00' ? '00:00' : r.to} onChange={(e) => set(d, { to: e.target.value === '00:00' && r.from === '00:00' ? '24:00' : e.target.value })} className="rounded-md border border-slate-300 bg-white px-2 py-1 text-slate-900" />
                    {r.to <= r.from && r.to !== '24:00' && r.from !== r.to && <span className="text-xs text-slate-500">closes after midnight</span>}
                    {r.from === r.to && <span role="alert" className="text-xs text-rose-600">Opening and closing times can’t be the same.</span>}
                    {r.extra > 0 && <span className="text-xs text-amber-700">Has {r.extra + 1} periods in Google; saving here keeps one.</span>}
                  </div>
                ) : <span className="text-sm text-slate-500">Closed</span>}
              </fieldset>
            );
          })}
          {error && <p role="alert" className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}
          <p className="text-xs text-slate-500">Holiday hours and split shifts can be set in Google Business Profile.</p>
        </div>
      ) : (
        <div className="space-y-3">
          <ul className="space-y-1 text-sm">
            {changes.map((d) => (
              <li key={d} className="flex flex-wrap gap-2">
                <span className="w-24 font-medium text-slate-800">{LABEL[d]}</span>
                <span className="text-slate-500 line-through">{describe(initial[d])}</span>
                <span aria-hidden="true">→</span>
                <span className="font-semibold text-slate-900">{describe(rows[d])}</span>
              </li>
            ))}
          </ul>
          {dropsSplit.length > 0 && <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">{dropsSplit.map((d) => LABEL[d]).join(', ')} currently {dropsSplit.length === 1 ? 'has' : 'have'} more than one opening period; saving keeps one.</p>}
        </div>
      )}
    </Dialog>
  );
}
