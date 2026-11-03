/**
 * Floating bottom control bar: the six essentials plus More.
 * Mic · Camera · Share screen | Participants · Chat · More | Leave
 */
import React, { useRef } from 'react';
import { MessageSquare, Mic, MicOff, MonitorOff, MonitorUp, MoreVertical, PhoneOff, Users, Video, VideoOff } from 'lucide-react';
import { MoreOptionsMenu, type MenuGroup } from './MoreOptionsMenu';

export interface MeetingToolbarProps {
  micMuted: boolean;
  camOff: boolean;
  sharing: boolean;
  peopleCount: number;
  unreadChat: number;
  panel: string | null;
  moreOpen: boolean;
  moreGroups: MenuGroup[];
  onToggleMic: () => void;
  onToggleCam: () => void;
  onToggleShare: () => void;
  onTogglePeople: () => void;
  onToggleChat: () => void;
  onMoreOpenChange: (open: boolean) => void;
  onLeave: () => void;
}

function Ctl({ tip, label, state, pressed, expanded, controls, onClick, children, badge }: {
  tip: string; label: string; state?: 'on' | 'off'; pressed?: boolean; expanded?: boolean; controls?: string;
  onClick: () => void; children: React.ReactNode; badge?: number;
}) {
  return (
    <button type="button" className="m-ctl m-tip" data-tip={tip} aria-label={label} data-state={state}
      aria-pressed={pressed} aria-expanded={expanded} aria-controls={controls} onClick={onClick}>
      {children}
      {badge ? <span className="m-ctl-badge" aria-hidden>{badge > 99 ? '99+' : badge}</span> : null}
    </button>
  );
}

export function MeetingToolbar(p: MeetingToolbarProps) {
  const moreBtn = useRef<HTMLButtonElement>(null);
  return (
    <div className="relative">
      <div role="toolbar" aria-label="Meeting controls" className="m-toolbar m-glass">
        <Ctl tip={p.micMuted ? 'Unmute (M)' : 'Mute (M)'} label={p.micMuted ? 'Unmute microphone' : 'Mute microphone'}
          state={p.micMuted ? 'off' : undefined} pressed={!p.micMuted} onClick={p.onToggleMic}>
          {p.micMuted ? <MicOff size={21} /> : <Mic size={21} />}
        </Ctl>
        <Ctl tip={p.camOff ? 'Start video (V)' : 'Stop video (V)'} label={p.camOff ? 'Turn camera on' : 'Turn camera off'}
          state={p.camOff ? 'off' : undefined} pressed={!p.camOff} onClick={p.onToggleCam}>
          {p.camOff ? <VideoOff size={21} /> : <Video size={21} />}
        </Ctl>
        <Ctl tip={p.sharing ? 'Stop sharing (S)' : 'Share screen (S)'} label={p.sharing ? 'Stop sharing your screen' : 'Share your screen'}
          state={p.sharing ? 'on' : undefined} pressed={p.sharing} onClick={p.onToggleShare}>
          {p.sharing ? <MonitorOff size={21} /> : <MonitorUp size={21} />}
        </Ctl>
        <span className="m-toolbar-sep" aria-hidden />
        <Ctl tip="Participants (P)" label={`Participants, ${p.peopleCount}`} state={p.panel === 'people' ? 'on' : undefined}
          pressed={p.panel === 'people'} controls="meeting-side-panel" onClick={p.onTogglePeople} badge={p.peopleCount}>
          <Users size={21} />
        </Ctl>
        <Ctl tip="Chat (C)" label={p.unreadChat ? `Chat, ${p.unreadChat} unread` : 'Chat'} state={p.panel === 'chat' ? 'on' : undefined}
          pressed={p.panel === 'chat'} controls="meeting-side-panel" onClick={p.onToggleChat} badge={p.unreadChat || undefined}>
          <MessageSquare size={21} />
        </Ctl>
        <button ref={moreBtn} type="button" className="m-ctl m-tip" data-tip="More options (.)" aria-label="More options"
          aria-haspopup="menu" aria-expanded={p.moreOpen} aria-controls="meeting-more-menu" onClick={() => p.onMoreOpenChange(!p.moreOpen)}>
          <MoreVertical size={21} />
        </button>
        <span className="m-toolbar-sep" aria-hidden />
        <button type="button" className="m-ctl-leave m-tip" data-tip="Leave meeting" aria-label="Leave meeting" onClick={p.onLeave}>
          <PhoneOff size={20} aria-hidden />
          <span className="m-leave-label">Leave</span>
        </button>
      </div>
      <MoreOptionsMenu open={p.moreOpen} groups={p.moreGroups} anchorRef={moreBtn} onClose={() => p.onMoreOpenChange(false)} />
    </div>
  );
}
