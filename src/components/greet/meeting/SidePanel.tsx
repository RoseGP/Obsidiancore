/** Right-hand panel shell. Chat and Participants share a switcher; other panels show their own title. Full-screen sheet on phones. */
import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';
import type { PanelId } from './useMeetingUi';

export const PANEL_TITLES: Record<PanelId, string> = {
  chat: 'Chat', people: 'Participants', greet: 'Meet & Greet', transcript: 'Live transcript', notes: 'Notes & CRM',
  whiteboard: 'Whiteboard', polls: 'Polls', summary: 'Meeting summary',
};

export function SidePanel({ panel, compact, onSwitch, onClose, peopleCount, unreadChat, wide, children }: {
  panel: PanelId | null; compact: boolean; onSwitch: (p: PanelId) => void; onClose: () => void;
  peopleCount: number; unreadChat: number; wide?: boolean; children: React.ReactNode;
}) {
  const width = wide ? 460 : 372;
  return (
    <AnimatePresence initial={false}>
      {panel && (
        <motion.aside id="meeting-side-panel" key="panel" aria-label={PANEL_TITLES[panel]}
          initial={compact ? { y: 24, opacity: 0 } : { width: 0, opacity: 0 }}
          animate={compact ? { y: 0, opacity: 1 } : { width, opacity: 1 }}
          exit={compact ? { y: 24, opacity: 0 } : { width: 0, opacity: 0 }}
          transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
          className={compact ? 'm-panel fixed inset-0 z-40' : 'm-panel h-full flex-none overflow-hidden'}
          style={compact ? { paddingTop: 'env(safe-area-inset-top, 0px)' } : undefined}>
          <div className="flex h-full min-h-0 flex-col" style={{ width: compact ? '100%' : width }}>
            <div className="m-panel-head">
              {panel === 'chat' || panel === 'people' ? (
                <div className="m-seg" role="tablist" aria-label="Side panel">
                  <button type="button" role="tab" aria-selected={panel === 'chat'} onClick={() => onSwitch('chat')}>Chat{unreadChat ? ` (${unreadChat})` : ''}</button>
                  <button type="button" role="tab" aria-selected={panel === 'people'} onClick={() => onSwitch('people')}>People ({peopleCount})</button>
                </div>
              ) : (
                <h2 className="text-[15px] font-semibold">{PANEL_TITLES[panel]}</h2>
              )}
              <span className="flex-1" />
              <button type="button" className="m-icon-btn" aria-label="Close panel" onClick={onClose}><X size={18} /></button>
            </div>
            {children}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
