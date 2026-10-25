import React, { useId, useMemo, useRef, useState } from 'react';
import { ChevronDown, Plus, X } from 'lucide-react';
import type { Client } from '../../domain/types';
import { Initials } from '../../layout/AppShell';
import { Button } from '../../ui/primitives';

/** Accessible combobox: type to filter, arrows to move, Enter to choose. */
export function ClientPicker({ clients, selectedId, onSelect, onCreate, onClear, error }: {
  clients: Client[]; selectedId: string | null; onSelect: (c: Client) => void; onCreate: () => void; onClear: () => void; error?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const selected = clients.find((c) => c.id === selectedId);

  const options = useMemo(() => {
    const t = q.trim().toLowerCase();
    return clients
      .filter((c) => !c.archived)
      .filter((c) => !t || [c.name, c.company, c.email].some((s) => s.toLowerCase().includes(t)))
      .sort((a, b) => (a.company || a.name).localeCompare(b.company || b.name));
  }, [clients, q]);
  const total = options.length + 1; // + "Add new client"

  const choose = (i: number) => {
    if (i === options.length) { setOpen(false); onCreate(); return; }
    const c = options[i];
    if (c) { onSelect(c); setOpen(false); setQ(''); }
  };

  if (selected && !open) {
    return (
      <div className="flex items-center gap-3 rounded-xl p-2.5 pr-2" style={{ border: '1px solid var(--inv-border-strong)', background: 'var(--inv-surface)' }}>
        <Initials name={selected.company || selected.name} size={34} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{selected.company || selected.name}</p>
          <p className="inv-muted truncate text-[12.5px]">{selected.name} · {selected.email}</p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => { setOpen(true); requestAnimationFrame(() => input.current?.focus()); }}>Change</Button>
        <Button size="sm" variant="ghost" iconOnly icon={<X size={14} />} aria-label="Remove client" onClick={onClear} />
      </div>
    );
  }

  return (
    <div className="relative">
      <label htmlFor={id} className="inv-label">Client <span className="inv-faint">*</span></label>
      <div className="relative">
        <input
          ref={input}
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={open ? `${id}-opt-${active}` : undefined}
          aria-invalid={!!error || undefined}
          className="inv-input"
          placeholder="Search clients by name, company or email"
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(0); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, total - 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
            if (e.key === 'Enter' && open) { e.preventDefault(); choose(active); }
            if (e.key === 'Escape') setOpen(false);
          }}
        />
        <ChevronDown size={16} className="inv-faint pointer-events-none absolute right-3 top-1/2 -translate-y-1/2" aria-hidden />
      </div>
      {error && <p className="inv-error" role="alert">{error}</p>}
      {open && (
        <ul id={`${id}-list`} role="listbox" className="inv-pop absolute left-0 right-0 top-[calc(100%+4px)] z-30 max-h-[280px] overflow-auto p-1.5">
          {options.length === 0 && <li className="inv-muted px-3 py-2 text-[13px]">No clients match “{q.trim()}”.</li>}
          {options.map((c, i) => (
            <li key={c.id} id={`${id}-opt-${i}`} role="option" aria-selected={i === active} data-active={i === active} className="inv-menu-item"
              onMouseDown={(e) => { e.preventDefault(); choose(i); }} onMouseEnter={() => setActive(i)}>
              <Initials name={c.company || c.name} size={28} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{c.company || c.name}</span>
                <span className="inv-muted block truncate text-[12px]">{c.name} · {c.email}</span>
              </span>
            </li>
          ))}
          <li id={`${id}-opt-${options.length}`} role="option" aria-selected={active === options.length} data-active={active === options.length}
            className="inv-menu-item mt-1 font-semibold" style={{ color: 'var(--inv-primary)', borderTop: '1px solid var(--inv-border)', borderRadius: 0, paddingTop: 10 }}
            onMouseDown={(e) => { e.preventDefault(); choose(options.length); }} onMouseEnter={() => setActive(options.length)}>
            <Plus size={15} /> Add new client{q.trim() ? ` “${q.trim()}”` : ''}
          </li>
        </ul>
      )}
    </div>
  );
}
