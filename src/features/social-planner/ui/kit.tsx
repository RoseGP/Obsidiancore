import React, { createContext, forwardRef, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, Clock, Info, Loader2, MoreHorizontal, PencilLine, RefreshCw, Search, X, XCircle } from 'lucide-react';
import { PLATFORMS, STATUS_LABEL, type PlatformId, type PostStatus } from '../domain/model';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

/** Portals must re-enter the .sp scope to keep the theme. */
export function Portal({ children }: { children: React.ReactNode }) {
  if (typeof document === 'undefined') return null;
  return createPortal(<div className="sp">{children}</div>, document.body);
}

// ---------- Platform glyphs (monochrome, drawn for 16–20px) ----------

export function PlatformGlyph({ id, size = 14, color = 'currentColor' }: { id: PlatformId; size?: number; color?: string }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': true as const };
  switch (id) {
    case 'instagram':
      return <svg {...common} fill="none" stroke={color} strokeWidth="2.2"><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4.2" /><circle cx="17.4" cy="6.6" r="1.2" fill={color} stroke="none" /></svg>;
    case 'x':
      return <svg {...common} fill={color}><path d="M17.8 3h3.1l-6.8 7.8 8 10.2h-6.3l-4.9-6.4L5.3 21H2.2l7.3-8.4L1.8 3h6.4l4.4 5.9L17.8 3zm-1.1 16.2h1.7L7.4 4.7H5.6l11.1 14.5z" /></svg>;
    case 'linkedin':
      return <svg {...common} fill={color}><path d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM3 9.75h4V21H3V9.75zM9.5 9.75h3.8v1.6h.06c.53-1 1.83-2.05 3.77-2.05 4.03 0 4.77 2.65 4.77 6.1V21h-4v-4.98c0-1.19-.02-2.72-1.66-2.72-1.66 0-1.92 1.3-1.92 2.63V21h-4V9.75z" /></svg>;
    case 'tiktok':
      return <svg {...common} fill={color}><path d="M16.6 2h-3.4v13.3a2.9 2.9 0 1 1-2.9-2.9c.3 0 .6 0 .9.1V9a6.3 6.3 0 1 0 5.4 6.3V8.6a8 8 0 0 0 4.4 1.3V6.5a4.5 4.5 0 0 1-4.4-4.5z" /></svg>;
    case 'facebook':
      return <svg {...common} fill={color}><path d="M14 8.5V6.6c0-.9.6-1.1 1-1.1h2.6V1.6L14 1.5c-4 0-4.9 3-4.9 4.9v2.1H6.8v4h2.3V22.5h4.9V12.5h3.3l.4-4H14z" /></svg>;
    case 'youtube':
      return <svg {...common} fill={color}><path d="M23.5 6.2s-.2-1.7-1-2.4c-.9-1-2-.1-2.5-1.1C16.8 2.5 12 2.5 12 2.5s-4.8 0-8 .2c-.5.1-1.6.1-2.5 1.1-.7.7-1 2.4-1 2.4S.2 8.1.2 10.1v3.8c0 1.9.3 3.8.3 3.8s.2 1.7 1 2.4c.9 1 2.2 1 2.7 1.1 2 .2 7.8.3 7.8.3s4.8 0 8-.3c.5-.1 1.6-.1 2.5-1.1.7-.7 1-2.4 1-2.4s.3-1.9.3-3.8v-3.8c0-1.9-.3-3.9-.3-3.9zM9.8 15.5V8.5l6.5 3.5-6.5 3.5z" /></svg>;
    case 'pinterest':
      return <svg {...common} fill={color}><path d="M12 2C6.5 2 2 6.5 2 12c0 4.2 2.6 7.8 6.4 9.2-.1-.8-.2-2 .04-2.9.2-.8 1.4-5.8 1.4-5.8s-.4-.7-.4-1.8c0-1.7 1-3 2.2-3 1 0 1.5.8 1.5 1.8 0 1-.7 2.6-1 4-.3 1.2.6 2.2 1.8 2.2 2.2 0 3.8-2.3 3.8-5.6 0-2.9-2.1-5-5.1-5-3.5 0-5.6 2.6-5.6 5.4 0 1 .4 2.2.9 2.8.1.1.1.2.1.3-.1.4-.3 1.2-.3 1.4 0 .2-.1.2-.3.1-1.4-.7-2.3-2.8-2.3-4.5 0-3.7 2.7-7.1 7.8-7.1 4.1 0 7.3 2.9 7.3 6.8 0 4.1-2.6 7.3-6.1 7.3-1.2 0-2.3-.6-2.7-1.4l-.7 2.8c-.3 1-1 2.3-1.5 3.1 1.1.3 2.2.5 3.4.5 5.5 0 10-4.5 10-10S17.5 2 12 2z" /></svg>;
    case 'threads':
      return <svg {...common} fill={color}><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c2.5 0 4.8-.9 6.5-2.5l-1.4-1.4c-1.4 1.2-3.2 1.9-5.1 1.9-4.4 0-8-3.6-8-8s3.6-8 8-8 8 3.6 8 8c0 2.2-.8 4.2-2.2 5.6-1.3 1.3-3.1 2-5 2-2.5 0-4.6-1.5-5.5-3.7l1.9-.8c.6 1.4 2 2.5 3.6 2.5 1.4 0 2.6-.5 3.6-1.5 1-1 1.6-2.4 1.6-4.1 0-3.3-2.7-6-6-6s-6 2.7-6 6c0 1.8.8 3.5 2.1 4.6l-1.4 1.4C3.8 15.9 3 14 3 12c0-5 4-9 9-9z" /></svg>;
    case 'bluesky':
      return <svg {...common} fill={color}><path d="M5.2 3.6C7.8 5.6 10.6 9.5 12 11.6c1.4-2.1 4.2-6 6.8-8 1.9-1.4 4.9-2.5 4.9 1 0 .7-.4 5.8-.6 6.6-.8 2.9-3.7 3.6-6.4 3.2 4.6.8 5.8 3.4 3.2 6-4.8 5-6.9-1.2-7.4-2.8l-.5-1.4-.5 1.4c-.5 1.6-2.6 7.8-7.4 2.8-2.6-2.6-1.4-5.2 3.2-6-2.7.4-5.6-.3-6.4-3.2C.6 10.4.3 5.3.3 4.6c0-3.5 3-2.4 4.9-1z" /></svg>;
    case 'mastodon':
      return <svg {...common} fill={color}><path d="M21.3 13.9c-.3 1.5-2.6 3.2-5.3 3.5-1.4.2-2.8.3-4.2.2-2.4-.1-4.3-.6-4.3-.6v.7c.3 2.3 2.4 2.5 4.3 2.5 2 .1 3.7-.5 3.7-.5l.1 1.8s-1.4.7-3.8.9c-1.3.1-3-.1-4.9-.6C2.8 20.7 2.1 16.6 2 12.5V7.9C2 3.5 4.9 2.2 4.9 2.2 6.3 1.5 8.9 1.2 11.6 1.2h.1c2.7 0 5.3.3 6.7 1 0 0 2.9 1.3 2.9 5.7 0 0 0 3.2-.4 5.4l.4.6zM18.2 8.6c0-1.1-.3-1.9-.8-2.6-.6-.6-1.3-1-2.2-1-1.1 0-1.9.4-2.4 1.2l-.5.9-.5-.9c-.6-.8-1.4-1.2-2.4-1.2-.9 0-1.7.3-2.2 1-.6.7-.8 1.5-.8 2.6v5.3h2.1V8.8c0-1.1.5-1.6 1.4-1.6 1 0 1.5.6 1.5 1.9v2.8h2.1V9.1c0-1.3.5-1.9 1.5-1.9.9 0 1.4.6 1.4 1.6v5.1h2.1V8.6z" /></svg>;
  }
}

/** White rounded tile with the platform's colour glyph, as in the chips. */
export function PlatformTile({ id, size = 20 }: { id: PlatformId; size?: number }) {
  return (
    <span className="sp-chip-icon" style={{ width: size, height: size, borderRadius: size * 0.3 }} aria-hidden>
      <PlatformGlyph id={id} size={size * 0.62} color={id === 'instagram' ? '#b42a6d' : PLATFORMS[id].chip.startsWith('#') ? PLATFORMS[id].chip : '#333'} />
    </span>
  );
}

/** Brand-coloured rounded tile with a white glyph: the platform's logo. */
export function PlatformLogo({ id, size = 36, className, style }: { id: PlatformId; size?: number; className?: string; style?: React.CSSProperties }) {
  return (
    <span className={cx('sp-logo', className)} style={{ width: size, height: size, borderRadius: Math.round(size * 0.28), background: PLATFORMS[id].brand, ...style }} aria-hidden>
      <PlatformGlyph id={id} size={Math.round(size * 0.5)} color="#fff" />
    </span>
  );
}

// ---------- Status ----------

export function StatusIcon({ status, size = 15, className }: { status: PostStatus; size?: number; className?: string }) {
  const p = { size, className, 'aria-hidden': true as const };
  switch (status) {
    case 'published': return <CheckCircle2 {...p} />;
    case 'scheduled': return <Clock {...p} />;
    case 'draft': return <PencilLine {...p} />;
    case 'failed': return <AlertTriangle {...p} />;
    case 'publishing': return <Loader2 {...p} className={cx('sp-spin', className)} />;
  }
}

export function StatusBadge({ status }: { status: PostStatus }) {
  return <span className={`sp-status sp-status-${status}`}><StatusIcon status={status} size={12} />{STATUS_LABEL[status]}</span>;
}

// ---------- Buttons ----------

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'sm' | 'md'; icon?: React.ReactNode; loading?: boolean;
};
export const Button = forwardRef<HTMLButtonElement, BtnProps>(function Button(
  { variant = 'secondary', size = 'md', icon, loading, disabled, className, children, type = 'button', ...rest }, ref,
) {
  return (
    <button ref={ref} type={type} disabled={disabled || loading} aria-busy={loading || undefined}
      className={cx('sp-btn', `sp-btn-${variant}`, size === 'sm' && 'sp-btn-sm', className)} {...rest}>
      {loading ? <Loader2 size={15} className="sp-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

export const IconButton = forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; small?: boolean }>(
  function IconButton({ label, small, className, children, type = 'button', ...rest }, ref) {
    return (
      <button ref={ref} type={type} aria-label={label} title={label} className={cx('sp-btn sp-icon-btn', small && 'sm', className)} {...rest}>
        {children}
      </button>
    );
  },
);

export function Segmented<T extends string>({ value, onChange, options, label }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="sp-seg">
      {options.map((o, i) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} tabIndex={value === o.value ? 0 : -1}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
            e.preventDefault();
            const n = (i + (e.key === 'ArrowRight' ? 1 : -1) + options.length) % options.length;
            onChange(options[n].value);
            ((e.currentTarget.parentElement as HTMLElement).children[n] as HTMLElement).focus();
          }}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------- States ----------

export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={cx('sp-skel', className)} style={style} aria-hidden />;
}

export function EmptyState({ icon, title, body, action }: { icon?: React.ReactNode; title: string; body?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {icon && <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl" style={{ background: 'var(--sp-surface)', color: 'var(--sp-muted)', border: '1px solid var(--sp-border)', boxShadow: 'var(--sp-shadow-sm)' }}>{icon}</div>}
      <p className="display text-[15px] font-semibold">{title}</p>
      {body && <p className="sp-muted mt-1.5 max-w-sm text-[13.5px]">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ title = 'Something went wrong', message, onRetry }: { title?: string; message?: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl" style={{ background: 'var(--sp-danger-soft)', color: 'var(--sp-danger)' }}><AlertTriangle size={20} /></div>
      <p className="display text-[15px] font-semibold">{title}</p>
      {message && <p className="sp-muted mt-1.5 max-w-sm text-[13.5px]">{message}</p>}
      {onRetry && <div className="mt-5"><Button icon={<RefreshCw size={15} />} onClick={onRetry}>Try again</Button></div>}
    </div>
  );
}

export function Banner({ tone, children, action }: { tone: 'info' | 'warning' | 'danger'; children: React.ReactNode; action?: React.ReactNode }) {
  const c = { info: ['var(--sp-accent-tint)', 'var(--sp-accent-text)', Info], warning: ['var(--sp-warning-soft)', 'var(--sp-warning)', AlertTriangle], danger: ['var(--sp-danger-soft)', 'var(--sp-danger)', XCircle] }[tone] as [string, string, React.ElementType];
  const Icon = c[2];
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className="flex items-center gap-3 rounded-[10px] px-3.5 py-2.5 text-[13px]" style={{ background: c[0], border: `1px solid color-mix(in srgb, ${c[1]} 22%, transparent)` }}>
      <Icon size={16} style={{ color: c[1], flex: 'none' }} aria-hidden />
      <div className="min-w-0 flex-1">{children}</div>
      {action}
    </div>
  );
}

// ---------- Layout ----------

/** Title + description + actions row that opens every planner section. */
export function SectionHeader({ title, description, actions, id }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; id?: string }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h2 id={id} className="display text-[19px] font-semibold leading-tight">{title}</h2>
        {description && <p className="sp-muted mt-1 max-w-[62ch] text-[13.5px]">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function SearchField({ value, onChange, placeholder, label, className, style }: {
  value: string; onChange: (v: string) => void; placeholder?: string; label: string; className?: string; style?: React.CSSProperties;
}) {
  return (
    <div className={cx('sp-search', className)} style={style}>
      <Search size={15} aria-hidden />
      <input className="sp-input" type="search" value={value} placeholder={placeholder} aria-label={label}
        onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape' && value) { e.stopPropagation(); onChange(''); } }} />
    </div>
  );
}

// ---------- Dropdown menu ----------

export type MenuEntry = 'separator' | { label: string; icon?: React.ReactNode; onSelect: () => void; danger?: boolean; disabled?: boolean };

/** Accessible dropdown menu: arrow keys, Home/End, Escape, outside click. */
export function Menu({ label, items, trigger, align = 'end', width }: {
  label: string; items: MenuEntry[]; trigger?: React.ReactNode; align?: 'start' | 'end'; width?: number;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const focusables = () => [...(list.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])];
  useEffect(() => {
    if (!open) return;
    focusables()[0]?.focus({ preventScroll: true });
    const close = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const onKey = (e: React.KeyboardEvent) => {
    const f = focusables();
    const i = f.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); btn.current?.focus(); }
    else if (e.key === 'Tab') setOpen(false);
    else if (e.key === 'ArrowDown') { e.preventDefault(); f[(i + 1) % f.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); f[(i - 1 + f.length) % f.length]?.focus(); }
    else if (e.key === 'Home') { e.preventDefault(); f[0]?.focus(); }
    else if (e.key === 'End') { e.preventDefault(); f[f.length - 1]?.focus(); }
  };
  return (
    <div ref={wrap} className="relative inline-flex">
      <button ref={btn} type="button" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
        className="sp-btn sp-icon-btn sm" onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => { if (e.key === 'ArrowDown' && !open) { e.preventDefault(); setOpen(true); } }}>
        {trigger ?? <MoreHorizontal size={17} />}
      </button>
      {open && (
        <div ref={list} id={menuId} role="menu" aria-label={label} onKeyDown={onKey}
          className={cx('sp-pop sp-menu animate absolute top-[calc(100%+4px)] z-40', align === 'end' ? 'right-0' : 'left-0')} style={width ? { width } : undefined}>
          {items.map((it, i) => it === 'separator'
            ? <div key={`s${i}`} role="separator" className="sp-menu-sep" />
            : (
              <button key={it.label} type="button" role="menuitem" tabIndex={-1} disabled={it.disabled} className={cx('sp-menu-item', it.danger && 'is-danger')}
                onClick={() => { setOpen(false); btn.current?.focus({ preventScroll: true }); it.onSelect(); }}>
                {it.icon}{it.label}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

// ---------- Dialog ----------

export function Dialog({ open, onClose, title, description, children, footer, width = 560, busy }: {
  open: boolean; onClose: () => void; title: React.ReactNode; description?: React.ReactNode; children?: React.ReactNode;
  footer?: React.ReactNode; width?: number; busy?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const node = ref.current;
    (node?.querySelector<HTMLElement>('[data-autofocus]') ?? node?.querySelector<HTMLElement>('input,textarea,select,button'))?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) { e.stopPropagation(); onClose(); }
      if (e.key !== 'Tab' || !node) return;
      const f = [...node.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex]:not([tabindex="-1"])')];
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('keydown', onKey, true); prev?.focus?.({ preventScroll: true }); };
  }, [open, busy, onClose]);
  if (!open) return null;
  return (
    <Portal>
      <div className="sp-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
        <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} className="sp-dialog" style={{ maxWidth: width }}>
          <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-2">
            <div className="min-w-0">
              <h2 id={titleId} className="display text-[17px] font-semibold">{title}</h2>
              {description && <p className="sp-muted mt-1 text-[13.5px]">{description}</p>}
            </div>
            <IconButton label="Close" small onClick={onClose} disabled={busy}><X size={16} /></IconButton>
          </div>
          {children && <div className="px-6 py-3">{children}</div>}
          {footer && <div className="flex flex-wrap justify-end gap-2 px-6 pb-5 pt-2">{footer}</div>}
        </div>
      </div>
    </Portal>
  );
}

// ---------- Toasts ----------

type Tone = 'success' | 'error' | 'info';
interface Toast { id: number; tone: Tone; title: string; body?: string; action?: { label: string; run: () => void } }
const ToastCtx = createContext<(t: Omit<Toast, 'id'>) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const n = useRef(0);
  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = ++n.current;
    setItems((s) => [...s.slice(-2), { ...t, id }]);
    setTimeout(() => setItems((s) => s.filter((x) => x.id !== id)), t.tone === 'error' || t.action ? 7000 : 4000);
  }, []);
  const Icon = { success: CheckCircle2, error: XCircle, info: Info };
  const color = { success: 'var(--sp-success)', error: 'var(--sp-danger)', info: 'var(--sp-accent-text)' };
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <Portal>
        <div aria-live="polite" className="fixed bottom-4 left-1/2 z-[95] flex w-[min(400px,calc(100vw-24px))] -translate-x-1/2 flex-col gap-2 sm:left-auto sm:right-4 sm:translate-x-0">
          {items.map((t) => {
            const I = Icon[t.tone];
            return (
              <div key={t.id} role={t.tone === 'error' ? 'alert' : 'status'} className="sp-toast sp-pop flex items-start gap-3 p-3.5">
                <I size={18} style={{ color: color[t.tone], flex: 'none', marginTop: 1 }} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-semibold">{t.title}</p>
                  {t.body && <p className="sp-muted mt-0.5 text-[12.5px]">{t.body}</p>}
                </div>
                {t.action && <Button size="sm" variant="ghost" onClick={() => { t.action!.run(); setItems((s) => s.filter((x) => x.id !== t.id)); }}>{t.action.label}</Button>}
                <IconButton label="Dismiss" small onClick={() => setItems((s) => s.filter((x) => x.id !== t.id))}><X size={14} /></IconButton>
              </div>
            );
          })}
        </div>
      </Portal>
    </ToastCtx.Provider>
  );
}
