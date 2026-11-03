/** UI kit for the growth platform (scoped by .gp). */
import React, { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, Loader2, X, XCircle } from 'lucide-react';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

export function Button({ variant = 'default', size = 'md', icon, loading, children, className, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'primary' | 'ghost' | 'danger'; size?: 'sm' | 'md'; icon?: React.ReactNode; loading?: boolean }) {
  return (
    <button type="button" {...rest} disabled={rest.disabled || loading} aria-busy={loading || undefined}
      className={cx('g-btn', variant !== 'default' && `g-btn-${variant}`, size === 'sm' && 'g-btn-sm', className)}>
      {loading ? <Loader2 size={15} className="animate-spin" aria-hidden /> : icon}{children}
    </button>
  );
}

export function Badge({ tone, children }: { tone?: 'ok' | 'warn' | 'danger' | 'accent' | 'teal'; children: React.ReactNode }) {
  return <span className="g-badge" data-tone={tone}>{children}</span>;
}

export function Card({ title, description, actions, children, className, pad = true }: { title?: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={cx('g-card', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4">
          <div className="min-w-0">
            {title && <h2 className="g-section-title">{title}</h2>}
            {description && <p className="g-muted mt-0.5 text-[13px]">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={pad ? 'px-5 pb-5 pt-4' : ''}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[22px] font-bold">{title}</h1>
        {description && <p className="g-muted mt-1 max-w-[72ch] text-[13.5px]">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Skeleton({ h = 16, w, className }: { h?: number; w?: number | string; className?: string }) {
  return <div className={cx('g-skel', className)} style={{ height: h, width: w ?? '100%' }} aria-hidden />;
}

export function Empty({ icon, title, body, action }: { icon?: React.ReactNode; title: string; body?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      {icon && <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl" style={{ background: 'var(--g-accent-tint)', color: 'var(--g-accent)' }}>{icon}</div>}
      <p className="text-[15px] font-semibold">{title}</p>
      {body && <p className="g-muted mt-1 max-w-[52ch] text-[13.5px]">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Alert({ tone = 'info', title, children, action }: { tone?: 'info' | 'ok' | 'warn' | 'danger'; title?: React.ReactNode; children?: React.ReactNode; action?: React.ReactNode }) {
  const map = { info: ['var(--g-accent-tint)', 'var(--g-accent)', Info], ok: ['var(--g-ok-tint)', 'var(--g-ok)', CheckCircle2], warn: ['var(--g-warn-tint)', 'var(--g-warn)', AlertTriangle], danger: ['var(--g-danger-tint)', 'var(--g-danger)', XCircle] } as const;
  const [bg, fg, Icon] = map[tone];
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className="flex flex-wrap items-start gap-3 rounded-xl px-4 py-3 text-[13.5px]" style={{ background: bg }}>
      <Icon size={17} style={{ color: fg, flex: 'none', marginTop: 1 }} aria-hidden />
      <div className="min-w-0 flex-1">{title && <p className="font-semibold" style={{ color: fg }}>{title}</p>}{children && <div>{children}</div>}</div>
      {action}
    </div>
  );
}

/** Circular score (0–100); colour follows the band. */
export function ScoreRing({ value, size = 96, label }: { value: number | null; size?: number; label?: string }) {
  const r = size / 2 - 7; const c = 2 * Math.PI * r;
  const v = value ?? 0;
  const color = value === null ? 'var(--g-faint)' : v >= 80 ? 'var(--g-ok)' : v >= 55 ? 'var(--g-warn)' : 'var(--g-danger)';
  return (
    <div className="relative flex-none" style={{ width: size, height: size }} role="img" aria-label={`${label ?? 'Score'}: ${value === null ? 'not available' : `${v} out of 100`}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--g-raised)" strokeWidth="8" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - v / 100)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: 'stroke-dashoffset .6s ease' }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="g-num font-bold" style={{ fontSize: size * 0.28 }}>{value === null ? '–' : v}</span>
        {size >= 80 && <span className="g-faint text-[11px]">of 100</span>}
      </div>
    </div>
  );
}

export function Bar({ value, tone }: { value: number | null; tone?: string }) {
  const v = value ?? 0;
  const color = tone ?? (value === null ? 'var(--g-faint)' : v >= 80 ? 'var(--g-ok)' : v >= 55 ? 'var(--g-warn)' : 'var(--g-danger)');
  return <div className="h-2 overflow-hidden rounded-full" style={{ background: 'var(--g-raised)' }}><div className="h-full rounded-full" style={{ width: `${v}%`, background: color, transition: 'width .5s ease' }} /></div>;
}

export function Stat({ label, value, sub, icon, tone, onClick, source }: { label: string; value: React.ReactNode; sub?: React.ReactNode; icon?: React.ReactNode; tone?: string; onClick?: () => void; source?: 'google' | 'app' | 'estimate' }) {
  const W: any = onClick ? 'button' : 'div';
  return (
    <W type={onClick ? 'button' : undefined} onClick={onClick} className="g-card flex min-w-0 flex-col gap-1 p-4 text-left" style={{ font: 'inherit', color: 'inherit', cursor: onClick ? 'pointer' : undefined }}>
      <span className="g-muted flex items-center gap-1.5 text-[12.5px] font-medium">{icon}{label}</span>
      <span className="g-num text-[24px] font-bold leading-8" style={{ color: tone }}>{value}</span>
      {(sub || source) && <span className="g-faint flex flex-wrap items-center gap-1.5 text-[12px]">{sub}{source && <span title={SOURCE_HINT[source]}>{SOURCE_LABEL[source]}</span>}</span>}
    </W>
  );
}
export const SOURCE_LABEL = { google: '· from Google', app: '· this app’s score', estimate: '· estimate' } as const;
const SOURCE_HINT = { google: 'Reported by Google Business Profile.', app: 'Calculated by this app from your profile data. Not a Google metric.', estimate: 'An estimate, not a measurement.' } as const;

export function Tabs<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: NoInfer<T>) => void; options: { value: NoInfer<T>; label: React.ReactNode }[]; label: string }) {
  return (
    <div className="g-tabs" role="tablist" aria-label={label}>
      {options.map((o) => <button key={o.value} type="button" role="tab" aria-selected={value === o.value} onClick={() => onChange(o.value)}>{o.label}</button>)}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: React.ReactNode; children: (id: string) => React.ReactNode }) {
  const id = useId();
  return <div><label htmlFor={id} className="g-label">{label}</label>{children(id)}{hint && <p className="g-hint">{hint}</p>}</div>;
}

export function Dialog({ open, onClose, title, description, children, footer, width = 560 }: { open: boolean; onClose: () => void; title: string; description?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode; width?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const tid = useId();
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('[data-autofocus], input, textarea, select, button')?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="g-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={tid} className="g-dialog g-fade" style={{ maxWidth: width }}>
        <div className="flex items-start gap-3 px-5 pt-5">
          <div className="min-w-0 flex-1"><h2 id={tid} className="text-[17px] font-semibold">{title}</h2>{description && <p className="g-muted mt-1 text-[13px]">{description}</p>}</div>
          <button type="button" className="g-icon-btn" aria-label="Close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t px-5 py-3.5" style={{ borderColor: 'var(--g-line)' }}>{footer}</div>}
      </div>
    </div>
  );
}

type Toast = { id: number; tone: 'ok' | 'danger' | 'info' | 'warn'; text: string };
const ToastCtx = createContext<(tone: Toast['tone'], text: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const seq = useRef(0);
  const push = useCallback((tone: Toast['tone'], text: string) => {
    const id = ++seq.current;
    setItems((s) => [...s.slice(-3), { id, tone, text }]);
    setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), tone === 'danger' ? 7000 : 4000);
  }, []);
  const I = { ok: CheckCircle2, danger: XCircle, info: Info, warn: AlertTriangle };
  const C = { ok: 'var(--g-ok)', danger: 'var(--g-danger)', info: 'var(--g-accent)', warn: 'var(--g-warn)' };
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="g-toasts" role="status" aria-live="polite">
        {items.map((t) => { const Ic = I[t.tone]; return <div key={t.id} className="g-toast g-fade"><Ic size={17} style={{ color: C[t.tone], flex: 'none', marginTop: 1 }} aria-hidden /><span className="min-w-0 flex-1">{t.text}</span></div>; })}
      </div>
    </ToastCtx.Provider>
  );
}

export const PRIORITY_TONE = { critical: 'danger', high: 'warn', medium: 'accent', low: undefined } as const;
export const fmtDate = (s?: string | null) => (s ? new Date(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
export const fmtDateTime = (s?: string | null) => (s ? new Date(s).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
export const fmtNum = (n: number | null | undefined) => (n === null || n === undefined || Number.isNaN(n) ? '—' : n.toLocaleString());
export const pct = (cur: number, prev: number | null | undefined) => (prev === null || prev === undefined || !Number.isFinite(prev) || prev === 0 ? null : Math.round(((cur - prev) / prev) * 1000) / 10);

/** Minimal, safe markdown (bold, bullets, paragraphs). No HTML is injected. */
export function Prose({ text }: { text: string }) {
  const blocks = text.trim().split(/\n{2,}/);
  const inline = (s: string) => s.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith('**') && p.endsWith('**') ? <strong key={i}>{p.slice(2, -2)}</strong> : <React.Fragment key={i}>{p}</React.Fragment>));
  return (
    <div className="g-prose">
      {blocks.map((b, i) => {
        const lines = b.split('\n');
        if (lines.every((l) => /^\s*([-*]|\d+\.)\s+/.test(l))) return <ul key={i}>{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*([-*]|\d+\.)\s+/, ''))}</li>)}</ul>;
        return <p key={i}>{lines.map((l, j) => <React.Fragment key={j}>{j > 0 && <br />}{inline(l)}</React.Fragment>)}</p>;
      })}
    </div>
  );
}
