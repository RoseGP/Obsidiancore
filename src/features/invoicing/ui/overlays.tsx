import React, { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import { CheckCircle2, AlertTriangle, Info, X, XCircle } from 'lucide-react';
import { Button, ScopedPortal, cx } from './primitives';

// ---------- Dialog (focus-trapped, Esc to close, restores focus) ----------

export function Dialog({ open, onClose, title, description, children, footer, width = 520, dismissible = true }: {
  open: boolean; onClose: () => void; title: React.ReactNode; description?: React.ReactNode;
  children?: React.ReactNode; footer?: React.ReactNode; width?: number; dismissible?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const first = node?.querySelector<HTMLElement>('[data-autofocus], input, select, textarea, button:not([data-close])');
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dismissible) { e.stopPropagation(); onClose(); }
      if (e.key !== 'Tab' || !node) return;
      const items = [...node.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')];
      if (items.length === 0) return;
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) { e.preventDefault(); lastEl.focus(); }
      else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); firstEl.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = overflow;
      prev?.focus?.();
    };
  }, [open, dismissible, onClose]);

  if (!open) return null;
  return (
    <ScopedPortal>
      <div className="inv-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && dismissible) onClose(); }}>
        <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={description ? descId : undefined} className="inv-dialog" style={{ maxWidth: width }}>
          <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-3">
            <div>
              <h2 id={titleId} className="inv-h2">{title}</h2>
              {description && <p id={descId} className="inv-muted mt-0.5 text-[13px]">{description}</p>}
            </div>
            {dismissible && (
              <Button variant="ghost" size="sm" iconOnly icon={<X size={16} />} aria-label="Close" data-close onClick={onClose} />
            )}
          </div>
          {children && <div className="px-6 pb-4">{children}</div>}
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t px-6 py-4" style={{ borderColor: 'var(--inv-border)' }}>{footer}</div>}
        </div>
      </div>
    </ScopedPortal>
  );
}

export function ConfirmDialog({ open, onClose, onConfirm, title, body, confirmLabel, tone = 'primary', loading }: {
  open: boolean; onClose: () => void; onConfirm: () => void; title: string; body: React.ReactNode;
  confirmLabel: string; tone?: 'primary' | 'danger'; loading?: boolean;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      width={440}
      footer={<>
        <Button onClick={onClose} disabled={loading}>Cancel</Button>
        <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm} loading={loading} data-autofocus>{confirmLabel}</Button>
      </>}
    >
      <div className="inv-muted text-[13.5px]">{body}</div>
    </Dialog>
  );
}

// ---------- Toasts ----------

type ToastTone = 'success' | 'error' | 'info' | 'warning';
interface ToastItem { id: number; tone: ToastTone; title: string; body?: string }

const ToastContext = createContext<(t: Omit<ToastItem, 'id'>) => void>(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const counter = useRef(0);
  const push = useCallback((t: Omit<ToastItem, 'id'>) => {
    const id = ++counter.current;
    setItems((s) => [...s.slice(-3), { ...t, id }]);
    setTimeout(() => setItems((s) => s.filter((x) => x.id !== id)), t.tone === 'error' || t.tone === 'warning' ? 8000 : 4500);
  }, []);
  const icon = { success: CheckCircle2, error: XCircle, info: Info, warning: AlertTriangle };
  const color = { success: 'var(--inv-success)', error: 'var(--inv-danger)', info: 'var(--inv-primary)', warning: 'var(--inv-warning)' };
  return (
    <ToastContext.Provider value={push}>
      {children}
      <ScopedPortal>
        <div aria-live="polite" className="fixed bottom-4 right-4 z-[90] flex w-[min(380px,calc(100vw-32px))] flex-col gap-2">
          {items.map((t) => {
            const Icon = icon[t.tone];
            return (
              <div key={t.id} role={t.tone === 'error' ? 'alert' : 'status'} className="inv-toast inv-pop flex items-start gap-3 p-3.5">
                <Icon size={18} style={{ color: color[t.tone], flex: 'none', marginTop: 1 }} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-semibold">{t.title}</p>
                  {t.body && <p className="inv-muted mt-0.5 text-[12.5px]">{t.body}</p>}
                </div>
                <button type="button" aria-label="Dismiss" className="inv-faint" style={{ background: 'none', border: 0, cursor: 'pointer' }} onClick={() => setItems((s) => s.filter((x) => x.id !== t.id))}>
                  <X size={14} />
                </button>
              </div>
            );
          })}
        </div>
      </ScopedPortal>
    </ToastContext.Provider>
  );
}

// ---------- Dropdown menu ----------

export interface MenuAction {
  label: string;
  icon?: React.ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
  hint?: string;
}

export function Menu({ trigger, items, align = 'end', label }: {
  trigger: (props: { ref: React.Ref<HTMLButtonElement>; onClick: () => void; 'aria-expanded': boolean; 'aria-haspopup': 'menu' }) => React.ReactNode;
  items: (MenuAction | 'separator')[];
  align?: 'start' | 'end';
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const actions = items.filter((i): i is MenuAction => i !== 'separator');

  const place = useCallback(() => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const width = 220;
    const left = align === 'end' ? Math.max(8, r.right - width) : Math.min(r.left, window.innerWidth - width - 8);
    const estH = items.length * 36 + 12;
    const top = r.bottom + 6 + estH > window.innerHeight ? Math.max(8, r.top - estH - 6) : r.bottom + 6;
    setPos({ top, left });
  }, [align, items.length]);

  useEffect(() => {
    if (!open) return;
    place();
    const close = (e: MouseEvent) => {
      if (!menu.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false);
    };
    const onScroll = () => setOpen(false);
    document.addEventListener('mousedown', close);
    window.addEventListener('resize', onScroll);
    window.addEventListener('scroll', onScroll, true);
    const firstEnabled = actions.findIndex((a) => !a.disabled);
    setActive(firstEnabled < 0 ? 0 : firstEnabled);
    requestAnimationFrame(() => menu.current?.focus());
    return () => {
      document.removeEventListener('mousedown', close);
      window.removeEventListener('resize', onScroll);
      window.removeEventListener('scroll', onScroll, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { setOpen(false); btn.current?.focus(); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const dir = e.key === 'ArrowDown' ? 1 : -1;
      let n = active;
      for (let k = 0; k < actions.length; k++) {
        n = (n + dir + actions.length) % actions.length;
        if (!actions[n].disabled) break;
      }
      setActive(n);
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const a = actions[active];
      if (a && !a.disabled) { setOpen(false); a.onSelect(); }
    }
    if (e.key === 'Tab') setOpen(false);
  };

  let actionIdx = -1;
  return (
    <>
      {trigger({ ref: btn, onClick: () => setOpen((o) => !o), 'aria-expanded': open, 'aria-haspopup': 'menu' })}
      {open && pos && (
        <ScopedPortal>
          <div
            ref={menu}
            role="menu"
            aria-label={label}
            tabIndex={-1}
            onKeyDown={onKey}
            className="inv-pop fixed z-[95] w-[220px] p-1.5 outline-none"
            style={{ top: pos.top, left: pos.left }}
          >
            {items.map((it, i) => {
              if (it === 'separator') return <div key={`s${i}`} className="my-1 h-px" style={{ background: 'var(--inv-border)' }} />;
              actionIdx++;
              const idx = actionIdx;
              return (
                <button
                  key={it.label}
                  type="button"
                  role="menuitem"
                  disabled={it.disabled}
                  title={it.hint}
                  data-active={idx === active}
                  onMouseEnter={() => setActive(idx)}
                  onClick={() => { setOpen(false); it.onSelect(); }}
                  className={cx('inv-menu-item', it.danger && 'is-danger')}
                >
                  {it.icon}
                  <span className="flex-1">{it.label}</span>
                </button>
              );
            })}
          </div>
        </ScopedPortal>
      )}
    </>
  );
}
