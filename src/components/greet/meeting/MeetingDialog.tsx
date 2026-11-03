/** Accessible dialog: Escape and backdrop click close it; focus moves in on open and back on close. */
import React, { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

export function MeetingDialog({ open, onClose, title, description, icon, width = 520, children, footer }: {
  open: boolean; onClose: () => void; title: string; description?: string; icon?: React.ReactNode; width?: number;
  children: React.ReactNode; footer?: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const first = el?.querySelector<HTMLElement>('[data-autofocus]') ?? el?.querySelector<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
      if (e.key !== 'Tab' || !el) return;
      const f = [...el.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])')];
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('keydown', onKey, true); prev?.focus?.(); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="m-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={description ? descId : undefined}
        className="m-dialog" style={{ maxWidth: width, animation: 'm-dialog-in .18s cubic-bezier(.2,.8,.2,1)' }}>
        <div className="flex items-start gap-3 px-5 pb-3 pt-5">
          {icon && <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl" style={{ background: 'var(--m-accent-tint)', color: 'var(--m-accent)' }} aria-hidden>{icon}</span>}
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-[17px] font-semibold leading-tight">{title}</h2>
            {description && <p id={descId} className="m-muted mt-1 text-[13px]">{description}</p>}
          </div>
          <button type="button" className="m-icon-btn" aria-label="Close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="px-5 pb-5">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t px-5 py-3.5" style={{ borderColor: 'var(--m-line)' }}>{footer}</div>}
      </div>
      <style>{'@keyframes m-dialog-in{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}'}</style>
    </div>
  );
}
