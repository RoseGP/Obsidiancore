/**
 * Small shared pieces for the Contacts, Companies and Tasks screens (design tokens from docs/DESIGN_SYSTEM.md,
 * light + dark). Kept local to these screens.
 */
import React, { useEffect, useRef } from 'react';
import { Loader2, X, AlertTriangle } from 'lucide-react';

export async function api<T = any>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok || body?.success === false) {
    const err: any = new Error(body?.error || (r.status === 403 ? 'Your role doesn’t allow this.' : `Request failed (${r.status}).`));
    err.status = r.status; err.code = body?.code; err.body = body;
    throw err;
  }
  return body as T;
}

export const fmtDate = (v?: string | null, withTime = false) => {
  if (!v) return '';
  const d = new Date(v);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toLocaleString('en-US', withTime ? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' } : { month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
};
export const money = (n?: number | null) => (n == null ? '' : `$${Math.round(n).toLocaleString('en-US')}`);
export const initialsOf = (name?: string) => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('') || '?';

export function Page({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="min-h-full shrink-0 w-full bg-[var(--app-bg)] text-[var(--text)]">
      <div className="mx-auto w-full max-w-[1200px] px-4 sm:px-6 py-5 sm:py-7 space-y-5">
        <header className="flex flex-col sm:flex-row sm:items-end gap-3 sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-[24px] sm:text-[26px] font-semibold tracking-[-0.02em]">{title}</h1>
            {subtitle && <p className="mt-1 text-[13px] text-[var(--text-muted)] max-w-[70ch]">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
        {children}
      </div>
    </div>
  );
}

export function Button({ variant = 'secondary', className = '', ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' }) {
  const v = variant === 'primary' ? 'bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white border-transparent'
    : variant === 'danger' ? 'bg-[var(--surface)] text-[var(--danger)] border-[var(--border)] hover:bg-[var(--danger-soft)]'
    : variant === 'ghost' ? 'bg-transparent border-transparent text-[var(--text-muted)] hover:bg-[var(--surface-sunken)] hover:text-[var(--text)]'
    : 'bg-[var(--surface)] text-[var(--text)] border-[var(--border)] hover:bg-[var(--surface-sunken)]';
  return <button type="button" {...p} className={`inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-control)] border px-3 py-2 text-[13px] font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${v} ${className}`} />;
}

export const inputCls = 'w-full rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[13px] text-[var(--text)] placeholder:text-[var(--text-subtle)] focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-soft)]';

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block text-[12px] font-medium text-[var(--text-muted)]">
      <span className="mb-1 block">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] font-normal text-[var(--text-subtle)]">{hint}</span>}
    </label>
  );
}

export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] ${className}`}>{children}</div>;
}

export function Badge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger' }) {
  const t = tone === 'accent' ? 'bg-[var(--accent-soft)] text-[var(--accent-text)]'
    : tone === 'success' ? 'bg-[var(--success-soft)] text-[var(--success)]'
    : tone === 'warning' ? 'bg-[var(--warning-soft)] text-[var(--warning)]'
    : tone === 'danger' ? 'bg-[var(--danger-soft)] text-[var(--danger)]'
    : 'bg-[var(--surface-sunken)] text-[var(--text-muted)]';
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${t}`}>{children}</span>;
}

export function Avatar({ name }: { name?: string }) {
  return <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[12px] font-semibold text-[var(--accent-text)]">{initialsOf(name)}</span>;
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return <div className="flex items-center justify-center gap-2 py-12 text-[13px] text-[var(--text-muted)]" role="status"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />{label}</div>;
}

export function Empty({ icon, title, text, action }: { icon?: React.ReactNode; title: string; text?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      {icon && <div className="text-[var(--text-subtle)]" aria-hidden="true">{icon}</div>}
      <p className="text-[14px] font-medium text-[var(--text)]">{title}</p>
      {text && <p className="max-w-[46ch] text-[13px] text-[var(--text-muted)]">{text}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorNote({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-[var(--radius-control)] border border-[var(--danger)]/30 bg-[var(--danger-soft)] px-3 py-2 text-[13px] text-[var(--danger)]">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="flex-1">{text}</span>
      {onRetry && <button type="button" onClick={onRetry} className="underline underline-offset-2">Try again</button>}
    </div>
  );
}

/** Right-side panel (full width on phones). Escape and the backdrop close it; focus moves into it. */
export function Drawer({ title, subtitle, onClose, children, actions, labelId }: { title: React.ReactNode; subtitle?: React.ReactNode; onClose: () => void; children: React.ReactNode; actions?: React.ReactNode; labelId: string }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[85] flex justify-end" role="dialog" aria-modal="true" aria-labelledby={labelId}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <aside ref={ref} tabIndex={-1} className="relative h-full w-full max-w-[680px] overflow-y-auto border-l border-[var(--border)] bg-[var(--surface-raised)] shadow-2xl outline-none">
        <div className="sticky top-0 z-10 flex items-start gap-3 border-b border-[var(--border)] bg-[var(--surface-raised)] px-4 sm:px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 id={labelId} className="text-[18px] font-semibold text-[var(--text)] truncate">{title}</h2>
            {subtitle && <div className="mt-0.5 text-[12px] text-[var(--text-muted)]">{subtitle}</div>}
          </div>
          {actions}
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-[var(--radius-control)] p-2 text-[var(--text-muted)] hover:bg-[var(--surface-sunken)] hover:text-[var(--text)]"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-5 px-4 sm:px-5 py-5">{children}</div>
      </aside>
    </div>
  );
}

/** Centered dialog for forms and confirmations. */
export function Modal({ title, onClose, children, footer, labelId }: { title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; labelId: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true" aria-labelledby={labelId}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div className="relative w-full sm:max-w-[520px] max-h-[92vh] overflow-y-auto rounded-t-[var(--radius-panel)] sm:rounded-[var(--radius-panel)] border border-[var(--border)] bg-[var(--surface-raised)] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <h2 id={labelId} className="text-[16px] font-semibold text-[var(--text)]">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-[var(--radius-control)] p-1.5 text-[var(--text-muted)] hover:bg-[var(--surface-sunken)]"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-3 px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--border)] px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Section({ title, count, children, action }: { title: string; count?: number; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[13px] font-semibold text-[var(--text)]">{title}{count !== undefined && <span className="ml-1.5 font-normal text-[var(--text-muted)]">{count}</span>}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

export interface TimelineItem { id: string; type?: string; title?: string; description?: string; actor?: string; timestamp?: string; via?: { type: string; id: string; name?: string } }

export function Timeline({ items, empty = 'Nothing here yet.' }: { items: TimelineItem[]; empty?: string }) {
  if (!items.length) return <p className="text-[13px] text-[var(--text-muted)]">{empty}</p>;
  return (
    <ol className="relative space-y-3 border-l border-[var(--border)] pl-4">
      {items.slice(0, 80).map((a) => (
        <li key={`${a.id}-${a.via?.type || ''}`} className="relative">
          <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-[var(--surface-raised)] bg-[var(--accent)]" aria-hidden="true" />
          <div className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
            <span className="font-medium text-[var(--text)]">{a.title || a.type}</span>
            {a.via && a.via.type !== 'contact' && a.via.type !== 'company' && <Badge>{a.via.type}{a.via.name ? `: ${a.via.name}` : ''}</Badge>}
          </div>
          {a.description && <p className="mt-0.5 whitespace-pre-wrap break-words text-[12px] text-[var(--text-muted)]">{a.description}</p>}
          <p className="mt-0.5 text-[11px] text-[var(--text-subtle)]">{[fmtDate(a.timestamp, true), a.actor].filter(Boolean).join(' · ')}</p>
        </li>
      ))}
    </ol>
  );
}

/** "Add a note" box used on contact and company profiles. */
export function NoteBox({ onSave }: { onSave: (text: string) => Promise<void> }) {
  const [text, setText] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState('');
  return (
    <form className="space-y-2" onSubmit={async (e) => { e.preventDefault(); if (!text.trim()) return; setBusy(true); setErr(''); try { await onSave(text.trim()); setText(''); } catch (x: any) { setErr(x.message); } finally { setBusy(false); } }}>
      <label className="sr-only" htmlFor="note-box">Add a note</label>
      <textarea id="note-box" rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a note…" className={inputCls} />
      {err && <ErrorNote text={err} />}
      <div className="flex justify-end"><Button type="submit" variant="primary" disabled={busy || !text.trim()}>{busy ? 'Saving…' : 'Save note'}</Button></div>
    </form>
  );
}
