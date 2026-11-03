/**
 * "More" menu: every secondary meeting feature, grouped. Opens above the toolbar.
 * Closes on outside click, Escape, or after choosing an item. Arrow keys move between items.
 */
import React, { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';

export type MenuItem =
  | { kind?: 'item'; id: string; label: string; icon: React.ElementType; hint?: string; shortcut?: string; disabled?: boolean; onSelect: () => void }
  | { kind: 'toggle'; id: string; label: string; icon: React.ElementType; hint?: string; shortcut?: string; checked: boolean; disabled?: boolean; onSelect: () => void }
  | { kind: 'reactions'; id: string; label: string; emojis: string[]; onPick: (emoji: string) => void };

export interface MenuGroup { id: string; label: string; items: MenuItem[] }

export function MoreOptionsMenu({ open, groups, onClose, anchorRef }: {
  open: boolean; groups: MenuGroup[]; onClose: () => void; anchorRef: React.RefObject<HTMLElement | null>;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const first = ref.current?.querySelector<HTMLElement>('[role^="menuitem"]');
    first?.focus();
    const onDown = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchorRef.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); anchorRef.current?.focus(); return; }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
      const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([disabled])') ?? [])];
      if (!items.length) return;
      e.preventDefault();
      const i = items.indexOf(document.activeElement as HTMLElement);
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1
        : e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
      items[next].focus();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open, onClose, anchorRef]);

  const choose = (fn: () => void) => { onClose(); fn(); };

  return (
    <AnimatePresence>
      {open && (
        <motion.div ref={ref} id="meeting-more-menu" role="menu" aria-label="More options"
          initial={{ opacity: 0, y: 10, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.98 }}
          transition={{ duration: 0.16, ease: [0.2, 0.8, 0.2, 1] }}
          className="m-menu m-glass absolute bottom-[calc(100%+12px)] right-0 z-50">
          <div className="m-menu-grid">
            {groups.map((g, gi) => (
              <React.Fragment key={g.id}>
                {gi > 0 && gi % 2 === 0 && <div className="m-menu-divider" role="separator" />}
                <div className="m-menu-group" role="group" aria-labelledby={`mm-${g.id}`}>
                  <div id={`mm-${g.id}`} className="m-menu-label">{g.label}</div>
                  {g.items.map((it) => {
                    if (it.kind === 'reactions') {
                      return (
                        <div key={it.id} className="m-reactions" role="group" aria-label={it.label}>
                          {it.emojis.map((e) => (
                            <button key={e} type="button" role="menuitem" className="m-reaction" aria-label={`React ${e}`} onClick={() => choose(() => it.onPick(e))}>{e}</button>
                          ))}
                        </div>
                      );
                    }
                    const Icon = it.icon;
                    const toggle = it.kind === 'toggle';
                    return (
                      <button key={it.id} type="button" role={toggle ? 'menuitemcheckbox' : 'menuitem'} aria-checked={toggle ? it.checked : undefined}
                        disabled={it.disabled} className="m-menu-item" onClick={() => choose(it.onSelect)}>
                        <Icon size={17} aria-hidden />
                        <span className="m-menu-text">
                          {it.label}
                          {it.hint && <span className="m-menu-hint">{it.hint}</span>}
                        </span>
                        {toggle && <span className="m-switch" data-on={it.checked} aria-hidden />}
                        {!toggle && it.shortcut && <kbd className="m-kbd">{it.shortcut}</kbd>}
                      </button>
                    );
                  })}
                </div>
              </React.Fragment>
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
