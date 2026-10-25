import React, { useState } from 'react';
import { ArrowDown, ArrowUp, Copy, GripVertical, Plus, Trash2 } from 'lucide-react';
import type { InvoiceTotals } from '../../domain/calc';
import { currencyInfo, formatMoney } from '../../domain/money';
import { newLineItem, uid } from '../../domain/factories';
import type { LineItem } from '../../domain/types';
import { Button, Input, Textarea, cx, focusInPane } from '../../ui/primitives';

const TAX_PRESETS = ['0', '5', '7.5', '8.625', '10', '15', '20'];

export function ItemsEditor({ items, onChange, totals, currency, errors, onBlurField, defaultTaxRate, listError }: {
  items: LineItem[];
  onChange: (items: LineItem[]) => void;
  totals: InvoiceTotals;
  currency: string;
  errors: Record<string, string>;
  onBlurField: (key: string) => void;
  defaultTaxRate: string;
  listError?: string;
}) {
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const [announce, setAnnounce] = useState('');
  const decimals = currencyInfo(currency).decimals;

  const update = (id: string, patch: Partial<LineItem>) => onChange(items.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length || from === to) return;
    const next = [...items];
    const [it] = next.splice(from, 1);
    next.splice(to, 0, it);
    onChange(next);
    setAnnounce(`${it.name || 'Item'} moved to position ${to + 1} of ${items.length}`);
  };
  const duplicate = (idx: number) => {
    const next = [...items];
    next.splice(idx + 1, 0, { ...items[idx], id: uid('li') });
    onChange(next);
    setAnnounce('Item duplicated');
  };
  const remove = (idx: number) => {
    onChange(items.filter((_, i) => i !== idx));
    setAnnounce('Item removed');
  };
  const add = () => {
    const item = newLineItem(defaultTaxRate);
    onChange([...items, item]);
    requestAnimationFrame(() => focusInPane(document.getElementById(`inv-item-name-${item.id}`)));
  };

  return (
    <div className="space-y-3">
      <span className="sr-only-inv" aria-live="polite">{announce}</span>
      <datalist id="inv-tax-presets">{TAX_PRESETS.map((t) => <option key={t} value={t} />)}</datalist>
      {listError && <p className="inv-error" role="alert">{listError}</p>}
      {items.map((it, idx) => {
        const line = totals.lines[idx];
        const p = `items.${it.id}`;
        return (
          <div
            key={it.id}
            onDragOver={(e) => { if (dragIdx !== null) { e.preventDefault(); setOverIdx(idx); } }}
            onDrop={(e) => { e.preventDefault(); if (dragIdx !== null) move(dragIdx, idx); setDragIdx(null); setOverIdx(null); }}
            className={cx('rounded-xl p-3.5 transition-shadow', dragIdx === idx && 'opacity-50')}
            style={{
              border: `1px solid ${overIdx === idx && dragIdx !== idx ? 'var(--inv-primary)' : 'var(--inv-border)'}`,
              background: 'var(--inv-surface)',
            }}
          >
            <div className="mb-2.5 flex items-center gap-1">
              <span
                draggable
                onDragStart={(e) => { setDragIdx(idx); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', it.id); }}
                onDragEnd={() => { setDragIdx(null); setOverIdx(null); }}
                className="inv-faint flex h-7 w-6 cursor-grab items-center justify-center"
                title="Drag to reorder"
                aria-hidden
              >
                <GripVertical size={15} />
              </span>
              <span className="inv-muted flex-1 text-[12.5px] font-semibold">Item {idx + 1}</span>
              <Button size="sm" variant="ghost" iconOnly icon={<ArrowUp size={14} />} aria-label={`Move item ${idx + 1} up`} disabled={idx === 0} onClick={() => move(idx, idx - 1)} />
              <Button size="sm" variant="ghost" iconOnly icon={<ArrowDown size={14} />} aria-label={`Move item ${idx + 1} down`} disabled={idx === items.length - 1} onClick={() => move(idx, idx + 1)} />
              <Button size="sm" variant="ghost" iconOnly icon={<Copy size={14} />} aria-label={`Duplicate item ${idx + 1}`} onClick={() => duplicate(idx)} />
              <Button size="sm" variant="danger-soft" iconOnly icon={<Trash2 size={14} />} aria-label={`Delete item ${idx + 1}`} onClick={() => remove(idx)} />
            </div>
            <div className="grid grid-cols-1 gap-3 @lg:grid-cols-6">
              <Input id={`inv-item-name-${it.id}`} containerClassName="@lg:col-span-6" inputSize="sm" label="Name" required placeholder="e.g. Website redesign"
                value={it.name} onChange={(e) => update(it.id, { name: e.target.value })} onBlur={() => onBlurField(`${p}.name`)} error={errors[`${p}.name`]} />
              <Textarea containerClassName="@lg:col-span-6" label="Description" rows={2} placeholder="Optional details shown under the item name"
                value={it.description} onChange={(e) => update(it.id, { description: e.target.value })} style={{ minHeight: 56 }} />
              <Input containerClassName="@lg:col-span-2" inputSize="sm" label="Quantity" required inputMode="decimal" className="text-right"
                value={it.quantity} onChange={(e) => update(it.id, { quantity: e.target.value })} onBlur={() => onBlurField(`${p}.quantity`)} error={errors[`${p}.quantity`]} />
              <Input containerClassName="@lg:col-span-2" inputSize="sm" label="Unit price" required inputMode="decimal" className="text-right" prefix={currency}
                placeholder={decimals === 0 ? '0' : '0.00'} value={it.unitPrice} onChange={(e) => update(it.id, { unitPrice: e.target.value })}
                onBlur={() => onBlurField(`${p}.unitPrice`)} error={errors[`${p}.unitPrice`]} />
              <Input containerClassName="@lg:col-span-2" inputSize="sm" label="Tax rate" inputMode="decimal" className="text-right" suffix="%" list="inv-tax-presets" placeholder="0"
                value={it.taxRate} onChange={(e) => update(it.id, { taxRate: e.target.value })} onBlur={() => onBlurField(`${p}.taxRate`)} error={errors[`${p}.taxRate`]} />
            </div>
            {line && (
              <dl className="num mt-3 grid grid-cols-3 gap-2 rounded-lg px-3 py-2 text-[12.5px]" style={{ background: 'var(--inv-surface-2)' }}>
                <div><dt className="inv-faint">Subtotal</dt><dd className="font-medium">{formatMoney(line.subtotal, currency)}</dd></div>
                <div>
                  <dt className="inv-faint">Tax</dt>
                  <dd className="font-medium">{formatMoney(line.tax, currency)}</dd>
                </div>
                <div className="text-right">
                  <dt className="inv-faint">Total</dt>
                  <dd className="font-semibold">{formatMoney(line.total, currency)}</dd>
                </div>
                {line.discountShare > 0n && (
                  <p className="inv-faint col-span-3 text-[11.5px]">Includes −{formatMoney(line.discountShare, currency)} share of the invoice discount, applied before tax.</p>
                )}
              </dl>
            )}
          </div>
        );
      })}
      <Button variant="secondary" icon={<Plus size={15} />} onClick={add} className="w-full" style={{ borderStyle: 'dashed' }}>Add item</Button>
    </div>
  );
}
