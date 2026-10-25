import React, { createContext, forwardRef, useContext, useId } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, Loader2 } from 'lucide-react';
import type { InvoiceStatus } from '../domain/types';
import { STATUS_LABELS } from '../domain/status';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

// ---------- Theme scope (portals must re-enter the .inv scope) ----------

export const ThemeContext = createContext<'light' | 'dark'>('light');

export function ScopedPortal({ children }: { children: React.ReactNode }) {
  const theme = useContext(ThemeContext);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="inv" data-theme={theme} style={{ background: 'none' }}>{children}</div>,
    document.body,
  );
}

// ---------- Button ----------

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-soft';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  icon?: React.ReactNode;
  iconOnly?: boolean;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, iconOnly, loading, disabled, children, className, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx('inv-btn', `inv-btn-${variant}`, size === 'sm' && 'inv-btn-sm', size === 'lg' && 'inv-btn-lg', iconOnly && 'inv-btn-icon', className)}
      {...rest}
    >
      {loading ? <Loader2 className="inv-spin" size={15} aria-hidden /> : icon}
      {!iconOnly && children}
    </button>
  );
});

// ---------- Field wrapper ----------

export interface FieldProps {
  label?: React.ReactNode;
  error?: string;
  hint?: React.ReactNode;
  required?: boolean;
  className?: string;
  children: (ids: { id: string; describedBy?: string; invalid: boolean }) => React.ReactNode;
}

export function Field({ label, error, hint, required, className, children }: FieldProps) {
  const id = useId();
  const errId = `${id}-err`;
  const hintId = `${id}-hint`;
  const describedBy = [error ? errId : '', hint ? hintId : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className={className}>
      {label && (
        <label htmlFor={id} className="inv-label">
          {label}
          {required && <span aria-hidden className="inv-faint"> *</span>}
        </label>
      )}
      {children({ id, describedBy, invalid: !!error })}
      {error ? (
        <p id={errId} className="inv-error" role="alert">
          <AlertCircle size={13} aria-hidden style={{ flex: 'none', marginTop: 2 }} /> {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="inv-hint">{hint}</p>
      ) : null}
    </div>
  );
}

type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  label?: React.ReactNode; error?: string; hint?: React.ReactNode; inputSize?: 'sm' | 'md';
  prefix?: string; suffix?: string; containerClassName?: string;
};

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, hint, required, inputSize = 'md', prefix, suffix, className, containerClassName, style, id: _id, ...rest }, ref,
) {
  return (
    <Field label={label} error={error} hint={hint} required={required} className={containerClassName}>
      {({ id, describedBy, invalid }) => (
        <div className="inv-affix">
          {prefix && <span className="inv-affix-text inv-affix-left">{prefix}</span>}
          <input
            ref={ref}
            id={id}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            aria-required={required || undefined}
            className={cx('inv-input', inputSize === 'sm' && 'inv-input-sm', className)}
            style={{ paddingLeft: prefix ? 12 + prefix.length * 7.5 + 4 : undefined, paddingRight: suffix ? 12 + suffix.length * 7.5 + 4 : undefined, ...style }}
            {...rest}
          />
          {suffix && <span className="inv-affix-text inv-affix-right">{suffix}</span>}
        </div>
      )}
    </Field>
  );
});

type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: React.ReactNode; error?: string; hint?: React.ReactNode; containerClassName?: string };

export function Textarea({ label, error, hint, required, className, containerClassName, ...rest }: TextareaProps) {
  return (
    <Field label={label} error={error} hint={hint} required={required} className={containerClassName}>
      {({ id, describedBy, invalid }) => (
        <textarea id={id} aria-invalid={invalid || undefined} aria-describedby={describedBy} className={cx('inv-input', className)} {...rest} />
      )}
    </Field>
  );
}

export interface SelectOption { value: string; label: string; disabled?: boolean }

type SelectProps = Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'onChange'> & {
  label?: React.ReactNode; error?: string; hint?: React.ReactNode; options: SelectOption[];
  onChange: (value: string) => void; inputSize?: 'sm' | 'md'; containerClassName?: string;
};

/** Dropdown built on the native select for full keyboard and screen-reader support. */
export function Select({ label, error, hint, options, onChange, inputSize = 'md', className, containerClassName, required, id: _id, ...rest }: SelectProps) {
  return (
    <Field label={label} error={error} hint={hint} required={required} className={containerClassName}>
      {({ id, describedBy, invalid }) => (
        <select
          id={id}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className={cx('inv-input', inputSize === 'sm' && 'inv-input-sm', className)}
          onChange={(e) => onChange(e.target.value)}
          {...rest}
        >
          {options.map((o) => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>)}
        </select>
      )}
    </Field>
  );
}

/** Date picker: native date input (locale-aware calendar, keyboard accessible), ISO value. */
export function DateField(props: Omit<InputProps, 'type' | 'onChange'> & { onChange: (iso: string) => void }) {
  const { onChange, ...rest } = props;
  return <Input type="date" onChange={(e) => onChange(e.target.value)} {...rest} />;
}

// ---------- Segmented control ----------

export function SegmentedControl<T extends string>({ value, onChange, options, label, className }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string; className?: string;
}) {
  const onKey = (e: React.KeyboardEvent, idx: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const next = (idx + (e.key === 'ArrowRight' ? 1 : -1) + options.length) % options.length;
    onChange(options[next].value);
    const group = (e.currentTarget.parentElement as HTMLElement);
    (group.children[next] as HTMLElement)?.focus();
  };
  return (
    <div role="radiogroup" aria-label={label} className={cx('inv-seg', className)}>
      {options.map((o, i) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          tabIndex={value === o.value ? 0 : -1}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => onKey(e, i)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------- Badges ----------

export function StatusBadge({ status }: { status: InvoiceStatus }) {
  return <span className={`inv-badge inv-badge-${status}`}>{STATUS_LABELS[status]}</span>;
}

export function Badge({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={`inv-badge inv-badge-${tone}`}>{children}</span>;
}

// ---------- Feedback states ----------

export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={cx('inv-skeleton', className)} style={style} aria-hidden />;
}

export function EmptyState({ icon, title, body, action }: { icon?: React.ReactNode; title: string; body?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center px-6 py-12">
      {icon && <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full" style={{ background: 'var(--inv-surface-3)', color: 'var(--inv-muted)' }}>{icon}</div>}
      <p className="inv-h3">{title}</p>
      {body && <p className="inv-muted mt-1 max-w-sm text-[13px]">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function InlineAlert({ tone = 'info', title, children, action }: {
  tone?: 'info' | 'warning' | 'danger' | 'success'; title?: string; children?: React.ReactNode; action?: React.ReactNode;
}) {
  const palette = {
    info: ['var(--inv-primary-tint)', 'var(--inv-primary-ink)'],
    warning: ['var(--inv-warning-tint)', 'var(--inv-warning)'],
    danger: ['var(--inv-danger-tint)', 'var(--inv-danger)'],
    success: ['var(--inv-success-tint)', 'var(--inv-success)'],
  }[tone];
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className="flex items-start gap-3 rounded-xl px-3.5 py-3 text-[13px]" style={{ background: palette[0] }}>
      <AlertCircle size={16} style={{ color: palette[1], flex: 'none', marginTop: 1 }} aria-hidden />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold" style={{ color: palette[1] }}>{title}</p>}
        {children && <div style={{ color: 'var(--inv-text)' }}>{children}</div>}
      </div>
      {action}
    </div>
  );
}

export function SectionCard({ title, description, actions, children, className, bodyClassName, id }: {
  title?: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode;
  className?: string; bodyClassName?: string; id?: string;
}) {
  return (
    <section className={cx('inv-card', className)} aria-labelledby={id}>
      {(title || actions) && (
        <header className="inv-card-head flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
          <div className="min-w-0">
            {title && <h2 id={id} className="inv-h2">{title}</h2>}
            {description && <p className="inv-muted text-[12.5px]">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={bodyClassName ?? 'p-5'}>{children}</div>
    </section>
  );
}

/**
 * Focuses a field and scrolls only its own scroll pane. Plain focus() /
 * scrollIntoView() also scroll overflow-hidden ancestors, which can shift
 * the whole module when it is embedded in a host page.
 */
export function focusInPane(el: HTMLElement | null) {
  if (!el) return;
  el.focus({ preventScroll: true });
  const pane = el.closest('.overflow-y-auto') as HTMLElement | null;
  if (!pane) return;
  const delta = el.getBoundingClientRect().top - pane.getBoundingClientRect().top;
  if (delta < 80 || delta > pane.clientHeight - 80) pane.scrollTop += delta - pane.clientHeight / 3;
}
