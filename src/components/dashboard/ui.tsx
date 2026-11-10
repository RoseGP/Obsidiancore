/**
 * Dashboard design-system primitives, built on the theme tokens in styles/obsidian-theme.css
 * (--surface, --border, --text, --accent, status colours, --radius-*). Light and dark themes come for free.
 */
import React, { useId, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Info, Minus } from 'lucide-react';

export const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');

export const focusRing = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--surface)]';

export function Card({ as: Tag = 'section', className, children, ...rest }: React.HTMLAttributes<HTMLElement> & { as?: any }) {
  return (
    <Tag
      className={cx('cc-card bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-panel)] shadow-xs transition-shadow', className)}
      {...rest}
    >
      {children}
    </Tag>
  );
}

export function CardHeader({ title, subtitle, icon, actions, id, wrap = true }: { title: string; subtitle?: React.ReactNode; icon?: React.ReactNode; actions?: React.ReactNode; id?: string; wrap?: boolean }) {
  return (
    <div className={cx('flex items-start justify-between gap-3 px-5 pt-4 pb-3', wrap && 'flex-wrap')}>
      <div className="flex items-start gap-2.5 min-w-0">
        {icon && <span className="mt-0.5 shrink-0 text-[var(--text-muted)]" aria-hidden="true">{icon}</span>}
        <div className="min-w-0">
          <h2 id={id} className="text-[14px] font-semibold text-[var(--text)] tracking-[-0.01em]">{title}</h2>
          {subtitle && <p className="text-[12px] text-[var(--text-muted)] mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-1.5 shrink-0 ml-auto">{actions}</div>}
    </div>
  );
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-contrast)] shadow-xs',
  secondary: 'bg-[var(--surface)] hover:bg-[var(--surface-sunken)] text-[var(--text)] border border-[var(--border)] shadow-xs',
  ghost: 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-sunken)]',
  danger: 'bg-[var(--danger)] text-white hover:opacity-90',
};

export const Button = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; icon?: React.ReactNode }>(
  function Button({ variant = 'secondary', size = 'md', icon, className, children, type = 'button', ...rest }, ref) {
    return (
      <button
        ref={ref}
        type={type}
        className={cx(
          'inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-control)] font-medium transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap',
          size === 'sm' ? 'h-8 px-2.5 text-[12px]' : 'h-9 px-3.5 text-[13px]',
          VARIANTS[variant], focusRing, className,
        )}
        {...rest}
      >
        {icon}{children}
      </button>
    );
  },
);

export function IconButton({ label, className, children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx('inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-control)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-sunken)] transition-colors cursor-pointer disabled:opacity-40', focusRing, className)}
      {...rest}
    >
      {children}
    </button>
  );
}

type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';
const TONES: Record<Tone, string> = {
  neutral: 'bg-[var(--surface-sunken)] text-[var(--text-muted)]',
  accent: 'bg-[var(--accent-soft)] text-[var(--accent-text)]',
  success: 'bg-[var(--success-soft)] text-[var(--success)]',
  warning: 'bg-[var(--warning-soft)] text-[var(--warning)]',
  danger: 'bg-[var(--danger-soft)] text-[var(--danger)]',
  info: 'bg-[var(--info-soft)] text-[var(--info)]',
};
export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  return <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium', TONES[tone], className)}>{children}</span>;
}

export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cx('block animate-pulse rounded-md bg-[var(--surface-sunken)]', className)} />;
}

export function EmptyState({ icon, title, body, action }: { icon?: React.ReactNode; title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center px-6 py-8 gap-2">
      {icon && <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--surface-sunken)] text-[var(--text-subtle)]" aria-hidden="true">{icon}</span>}
      <p className="text-[13px] font-medium text-[var(--text)]">{title}</p>
      {body && <p className="text-[12px] text-[var(--text-muted)] max-w-xs">{body}</p>}
      {action && <div className="pt-1">{action}</div>}
    </div>
  );
}

/** Segmented control (radio group semantics). */
export function Segmented<T extends string>({ value, options, onChange, label, size = 'md' }: { value: T; options: { value: NoInfer<T>; label: string }[]; onChange: (v: NoInfer<T>) => void; label: string; size?: 'sm' | 'md' }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex items-center rounded-[10px] bg-[var(--surface-sunken)] p-0.5 max-w-full overflow-x-auto">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cx(
              'rounded-[8px] font-medium transition-all cursor-pointer whitespace-nowrap',
              size === 'sm' ? 'px-2 py-1 text-[11px]' : 'px-3 py-1.5 text-[12px]',
              active ? 'bg-[var(--surface)] text-[var(--text)] shadow-xs' : 'text-[var(--text-muted)] hover:text-[var(--text)]',
              focusRing,
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Change versus the previous period. `points` means percentage-point changes (rates);
 * `higherIsBetter` decides the colour.
 */
export function TrendBadge({ change, higherIsBetter = true, points = false, compareLabel }: { change: number | null; higherIsBetter?: boolean; points?: boolean; compareLabel: string }) {
  if (change === null || !Number.isFinite(change)) {
    return <span className="text-[11px] text-[var(--text-subtle)]" title={compareLabel ? `Nothing to compare ${compareLabel.replace(/^vs /, 'with the ')}` : 'Nothing in the previous period to compare with'}>No earlier data</span>;
  }
  const flat = Math.abs(change) < 0.5;
  const good = flat ? null : (change > 0) === higherIsBetter;
  const Icon = flat ? Minus : change > 0 ? ArrowUpRight : ArrowDownRight;
  const amount = `${Math.abs(change) >= 10 ? Math.round(Math.abs(change)) : Math.abs(change).toFixed(1)}${points ? ' pts' : '%'}`;
  return (
    <span className="inline-flex min-w-0 items-center gap-1 text-[11px]">
      <span className={cx('inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 font-semibold',
        good === null ? 'bg-[var(--surface-sunken)] text-[var(--text-muted)]' : good ? 'bg-[var(--success-soft)] text-[var(--success)]' : 'bg-[var(--danger-soft)] text-[var(--danger)]')}>
        <Icon className="h-3 w-3" aria-hidden="true" />
        <span className="sr-only">{flat ? 'No change' : change > 0 ? 'Up' : 'Down'}</span>
        {flat ? 'No change' : amount}
      </span>
      {compareLabel && <span className="text-[var(--text-subtle)] truncate">{compareLabel}</span>}
    </span>
  );
}

/** Tiny inline trend line. Purely decorative: the value and change are given in text. */
export function Sparkline({ values, tone = 'accent', height = 32 }: { values: number[]; tone?: 'accent' | 'success' | 'danger' | 'muted'; height?: number }) {
  const id = useId().replace(/:/g, '');
  if (!values.length) return null;
  const w = 120, h = height, max = Math.max(...values), min = Math.min(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [values.length === 1 ? w : (i / (values.length - 1)) * w, h - 3 - ((v - min) / span) * (h - 6)] as const);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const color = tone === 'success' ? 'var(--success)' : tone === 'danger' ? 'var(--danger)' : tone === 'muted' ? 'var(--text-subtle)' : 'var(--accent)';
  const allZero = max === 0 && min === 0;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full" style={{ height }} aria-hidden="true">
      <defs>
        <linearGradient id={`sg-${id}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={allZero ? 0 : 0.18} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      {!allZero && <path d={`${line} L${w},${h} L0,${h} Z`} fill={`url(#sg-${id})`} />}
      <path d={line} fill="none" stroke={allZero ? 'var(--border-strong)' : color} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" strokeDasharray={allZero ? '3 3' : undefined} />
    </svg>
  );
}

/** Small "i" with an explanation, available on hover and keyboard focus. */
export function InfoTip({ text, label = 'How this is calculated' }: { text: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-label={label}
        aria-describedby={open ? id : undefined}
        onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
        onClick={() => setOpen((o) => !o)}
        className={cx('inline-flex h-5 w-5 items-center justify-center rounded-full text-[var(--text-subtle)] hover:text-[var(--text)] cursor-help', focusRing)}
      >
        <Info className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      {open && (
        <span id={id} role="tooltip" className="absolute z-40 top-full right-0 sm:right-auto sm:left-1/2 sm:-translate-x-1/2 mt-1.5 w-56 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-[11px] leading-relaxed text-[var(--text-muted)] shadow-lg">
          {text}
        </span>
      )}
    </span>
  );
}
