/** Toast notifications for the meeting room (joins, recordings, errors). One live region, newest last. */
import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useMeetingUi } from './useMeetingUi';

export type NoticeTone = 'info' | 'success' | 'warning' | 'error';
export interface Notice { id: number; message: string; tone: NoticeTone; action?: { label: string; onClick: () => void } }
type Notify = (message: string, tone?: NoticeTone, opts?: { action?: Notice['action']; durationMs?: number }) => void;

const Ctx = createContext<Notify>(() => {});
export const useNotify = () => useContext(Ctx);

const ICON = { info: Info, success: CheckCircle2, warning: AlertTriangle, error: XCircle };

export function NotificationSystem({ children }: { children: React.ReactNode }) {
  const { theme } = useMeetingUi();
  const [items, setItems] = useState<Notice[]>([]);
  const seq = useRef(0);
  const dismiss = useCallback((id: number) => setItems((s) => s.filter((n) => n.id !== id)), []);
  const notify = useCallback<Notify>((message, tone = 'info', opts) => {
    const id = ++seq.current;
    setItems((s) => [...s.filter((n) => n.message !== message), { id, message, tone, action: opts?.action }].slice(-4));
    window.setTimeout(() => dismiss(id), opts?.durationMs ?? (tone === 'error' ? 7000 : 4200));
  }, [dismiss]);

  return (
    <Ctx.Provider value={notify}>
      {children}
      {/* Re-enter the theme scope: toasts render beside the room, not inside it. */}
      <div className="mtg m-toasts" data-mtg-theme={theme} style={{ background: 'transparent' }} role="status" aria-live="polite">
        <AnimatePresence initial={false}>
          {items.map((n) => {
            const Icon = ICON[n.tone];
            return (
              <motion.div key={n.id} layout initial={{ opacity: 0, y: -10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.18 }} className="m-toast m-glass" data-tone={n.tone}>
                <Icon size={17} aria-hidden />
                <span className="min-w-0 flex-1">{n.message}</span>
                {n.action && <button type="button" className="m-btn m-btn-sm" onClick={() => { n.action!.onClick(); dismiss(n.id); }}>{n.action.label}</button>}
                <button type="button" className="m-icon-btn" style={{ width: 28, height: 28 }} aria-label="Dismiss" onClick={() => dismiss(n.id)}><X size={15} /></button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  );
}
