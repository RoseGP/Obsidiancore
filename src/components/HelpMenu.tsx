/**
 * Header help: keyboard shortcuts, where things are, and a way to bring back the setup checklist.
 */
import React, { useEffect, useRef, useState } from 'react';
import { HelpCircle, Keyboard, ListChecks, Settings } from 'lucide-react';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export default function HelpMenu({ onOpenDashboard, onOpenSettings }: { onOpenDashboard: () => void; onOpenSettings: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [open]);

  const kbd = 'inline-flex min-w-[22px] justify-center rounded border border-[var(--border)] bg-[var(--surface-sunken)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--text-muted)]';
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog" aria-expanded={open} aria-label="Help"
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-sunken)] cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
      >
        <HelpCircle className="h-[18px] w-[18px]" />
      </button>
      {open && (
        <div role="dialog" aria-label="Help" className="absolute right-0 z-50 mt-2 w-72 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-2 shadow-xl text-[var(--text)]">
          <p className="flex items-center gap-2 px-2 pt-1 pb-2 text-[12px] font-semibold"><Keyboard className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />Keyboard shortcuts</p>
          <dl className="space-y-1.5 px-2 pb-3 text-[12px]">
            <div className="flex items-center justify-between"><dt className="text-[var(--text-muted)]">Search anything</dt><dd><span className={kbd}>{isMac ? '⌘' : 'Ctrl'}</span> <span className={kbd}>K</span></dd></div>
            <div className="flex items-center justify-between"><dt className="text-[var(--text-muted)]">Quick create</dt><dd><span className={kbd}>Alt</span> <span className={kbd}>N</span></dd></div>
            <div className="flex items-center justify-between"><dt className="text-[var(--text-muted)]">Close dialogs and menus</dt><dd><span className={kbd}>Esc</span></dd></div>
          </dl>
          <div className="border-t border-[var(--border)] pt-1">
            <button type="button" onClick={() => { setOpen(false); onOpenDashboard(); setTimeout(() => window.dispatchEvent(new Event('obsidian:show-setup')), 50); }} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-[13px] hover:bg-[var(--surface-sunken)] cursor-pointer">
              <ListChecks className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />Show the setup checklist
            </button>
            <button type="button" onClick={() => { setOpen(false); onOpenSettings(); }} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-[13px] hover:bg-[var(--surface-sunken)] cursor-pointer">
              <Settings className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />Settings, team and plan
            </button>
          </div>
          <p className="px-2 pt-2 pb-1 text-[11px] text-[var(--text-subtle)]">Tip: hover the ⓘ next to any dashboard figure to see exactly how it's calculated.</p>
        </div>
      )}
    </div>
  );
}
