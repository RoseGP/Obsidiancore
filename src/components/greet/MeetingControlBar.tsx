/**
 * Meeting control bar.
 *
 *   Bar (always visible): Microphone · Camera · Share screen (if supported) · Participants · Chat · Notes (sm+) · More · Leave
 *   More menu:            Video and layout · Panels · Participate (raise hand) · Reactions · Recording · Settings ·
 *                         Host controls (waiting room, mute everyone, lower hands, end for everyone)
 *
 * The bar only presents controls and calls the handlers it's given; all media/SDK behavior stays in
 * MeetingSessionContext. Menu follows the WAI-ARIA menu button pattern: Enter/Space/↓ opens and focuses
 * the first item, ↑ the last; arrows, Home and End move; Esc closes and returns focus to More; Tab,
 * an outside click or running an action closes it. On narrow screens the menu is a bottom sheet so it
 * is never clipped.
 */
import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpCircle, Briefcase, DoorOpen, NotebookPen, Disc, FileText, Hand, LayoutGrid, Lock, MessageSquare, Mic, MicOff, MonitorOff, MonitorUp, MoreHorizontal,
  Pause, PhoneOff, Play, Power, Settings, Sparkles, Square, Users, Video, VideoOff,
} from 'lucide-react';
import {
  buildMoreMenu, flattenMenu, meetingPermissions, nextMenuIndex, screenShareSupported,
  type FeatureHints, type MenuActionId, type OrgRole, type SidebarTab,
} from './meetingControls';
import type { PlanFeatures } from '../../lib/meetingPlans';

export interface MeetingControlBarProps {
  isHost: boolean;
  orgRole?: OrgRole;
  isMicMuted: boolean;
  isCamOff: boolean;
  isVideoPaused: boolean;
  isScreenSharing: boolean;
  participantsCount: number;
  chatCount: number;
  isSidebarOpen: boolean;
  activeSidebarTab: SidebarTab;
  layoutMode: 'grid' | 'speaker';
  isRecording: boolean;
  isRecordingPaused: boolean;
  recordingDurationSeconds: number;
  /** Overrides feature detection (tests). */
  canShareScreen?: boolean;
  /** Raise hand, waiting room and participant management (optional; omitted = feature hidden). */
  isHandRaised?: boolean;
  raisedHandsCount?: number;
  isWaitingRoomEnabled?: boolean;
  waitingCount?: number;
  onToggleRaiseHand?: () => void;
  onToggleWaitingRoom?: () => void;
  onMuteAll?: () => void;
  onLowerAllHands?: () => void;
  /** Plan features of this meeting; items the plan lacks are shown disabled with `featureHints`. */
  features?: Partial<PlanFeatures>;
  featureHints?: FeatureHints;
  isLocked?: boolean;
  onToggleLock?: () => void;
  onOpenUpgrade?: () => void;
  onToggleMic: () => void;
  onToggleCam: () => void;
  onToggleScreenShare: () => void;
  onTogglePanel: (tab: SidebarTab) => void;
  onTogglePauseVideo: () => void;
  onToggleLayout: () => void;
  onReaction: (emoji: string) => void;
  onStartRecording: () => void;
  onPauseResumeRecording: () => void;
  onStopRecording: () => void;
  onOpenSettings: () => void;
  onLeave: () => void;
  onEndForEveryone: () => void;
}

const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  pause: Pause, play: Play, layout: LayoutGrid, greet: Sparkles, transcript: FileText, crm: Briefcase, notes: NotebookPen,
  record: Disc, stop: Square, settings: Settings, end: Power, hand: Hand, waiting: DoorOpen, mute: MicOff, lock: Lock, upgrade: ArrowUpCircle,
};

const DIALOG_ACTIONS = new Set<MenuActionId>(['record-start', 'open-settings', 'end-for-everyone', 'open-upgrade']);

const focusRing = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900';

/** Icon button with a visible tooltip on hover and keyboard focus. */
function ControlButton(props: {
  id: string; label: string; tooltip?: string; onClick: () => void; pressed?: boolean; tone?: 'default' | 'off' | 'active' | 'danger';
  icon: React.ReactNode; badge?: React.ReactNode; text?: string; buttonRef?: React.Ref<HTMLButtonElement>; wrapperClass?: string;
  extra?: React.ButtonHTMLAttributes<HTMLButtonElement>;
}) {
  const { tone = 'default' } = props;
  const toneClass = {
    default: 'bg-neutral-800 hover:bg-neutral-700 text-neutral-100',
    off: 'bg-rose-600 hover:bg-rose-500 text-white',
    active: 'bg-indigo-600 hover:bg-indigo-500 text-white',
    danger: 'bg-rose-600 hover:bg-rose-500 text-white',
  }[tone];
  return (
    <div className={`relative group ${props.wrapperClass || ''}`}>
      <button
        id={props.id}
        ref={props.buttonRef}
        type="button"
        onClick={props.onClick}
        aria-label={props.label}
        aria-pressed={props.pressed}
        className={`relative flex items-center justify-center gap-1.5 h-11 min-w-10 px-2 sm:min-w-11 sm:px-3 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${toneClass} ${focusRing}`}
        {...props.extra}
      >
        {props.icon}
        {props.text && <span className="hidden lg:inline">{props.text}</span>}
        {props.badge}
      </button>
      <span aria-hidden="true" className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 whitespace-nowrap rounded-md bg-neutral-950 px-2 py-1 text-[11px] text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-has-[:focus-visible]:opacity-100 z-50">
        {props.tooltip || props.label}
      </span>
    </div>
  );
}

export default function MeetingControlBar(p: MeetingControlBarProps) {
  const perms = useMemo(() => meetingPermissions({ isHost: p.isHost, orgRole: p.orgRole }), [p.isHost, p.orgRole]);
  const canShare = p.canShareScreen ?? screenShareSupported();
  const sections = useMemo(() => buildMoreMenu({
    isHost: p.isHost, isVideoPaused: p.isVideoPaused, isCamOff: p.isCamOff, layoutMode: p.layoutMode,
    isSidebarOpen: p.isSidebarOpen, activeSidebarTab: p.activeSidebarTab, isRecording: p.isRecording, isRecordingPaused: p.isRecordingPaused,
    isHandRaised: p.isHandRaised, isWaitingRoomEnabled: p.isWaitingRoomEnabled, raisedHandsCount: p.raisedHandsCount,
    features: p.features, featureHints: p.featureHints, isLocked: p.isLocked,
  }, perms).map((s) => ({
    ...s,
    // Hide items whose handler wasn't provided, so the menu never offers something that does nothing.
    items: s.items.filter((i) =>
      (i.id !== 'toggle-raise-hand' || !!p.onToggleRaiseHand) &&
      (i.id !== 'toggle-waiting-room' || !!p.onToggleWaitingRoom) &&
      (i.id !== 'mute-all' || !!p.onMuteAll) &&
      (i.id !== 'lower-all-hands' || !!p.onLowerAllHands) &&
      (i.id !== 'toggle-lock' || !!p.onToggleLock) &&
      (i.id !== 'open-upgrade' || !!p.onOpenUpgrade)),
  })).filter((s) => s.items.length > 0), [p.isHost, p.isVideoPaused, p.isCamOff, p.layoutMode, p.isSidebarOpen, p.activeSidebarTab, p.isRecording, p.isRecordingPaused,
    p.isHandRaised, p.isWaitingRoomEnabled, p.raisedHandsCount, p.onToggleRaiseHand, p.onToggleWaitingRoom, p.onMuteAll, p.onLowerAllHands,
    p.features, p.featureHints, p.isLocked, p.onToggleLock, p.onOpenUpgrade, perms]);
  const items = useMemo(() => flattenMenu(sections), [sections]);

  const [open, setOpen] = useState(false);
  const [focusIdx, setFocusIdx] = useState(-1);
  const moreRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const menuId = useId();
  const [pos, setPos] = useState<{ sheet: boolean; right: number; bottom: number; maxHeight: number }>({ sheet: false, right: 8, bottom: 80, maxHeight: 400 });

  // ---- state announcements for screen readers ----
  const [announcement, setAnnouncement] = useState('');
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    setAnnouncement(`Microphone ${p.isMicMuted ? 'off' : 'on'}. Camera ${p.isCamOff ? 'off' : 'on'}.${p.isScreenSharing ? ' Sharing your screen.' : ''}${p.isRecording ? (p.isRecordingPaused ? ' Recording paused.' : ' Recording.') : ''}${p.isHandRaised ? ' Your hand is raised.' : ''}`);
  }, [p.isMicMuted, p.isCamOff, p.isScreenSharing, p.isRecording, p.isRecordingPaused, p.isHandRaised]);

  // ---- menu positioning: fixed, so no ancestor can clip it ----
  const place = useCallback(() => {
    const b = moreRef.current?.getBoundingClientRect();
    const w = window.innerWidth, h = window.innerHeight;
    if (!b || w < 640) { setPos({ sheet: true, right: 0, bottom: 0, maxHeight: Math.round(h * 0.7) }); return; }
    setPos({ sheet: false, right: Math.max(8, w - b.right), bottom: Math.max(8, h - b.top + 8), maxHeight: Math.max(160, b.top - 16) });
  }, []);
  useLayoutEffect(() => { if (open) place(); }, [open, place]);
  useEffect(() => {
    if (!open) return;
    const onResize = () => place();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [open, place]);

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false); setFocusIdx(-1);
    if (returnFocus) requestAnimationFrame(() => moreRef.current?.focus());
  }, []);

  const openMenu = (focus: 'first' | 'last') => {
    setOpen(true);
    setFocusIdx(focus === 'first' ? 0 : items.length - 1);
  };

  // Focus follows focusIdx while open.
  useEffect(() => { if (open && focusIdx >= 0) itemRefs.current[focusIdx]?.focus(); }, [open, focusIdx]);

  // Outside click / tap closes (without stealing focus from whatever was clicked).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent | MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || moreRef.current?.contains(t)) return;
      close(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('mousedown', onDown, true);
    return () => { document.removeEventListener('pointerdown', onDown, true); document.removeEventListener('mousedown', onDown, true); };
  }, [open, close]);

  const run = (id: MenuActionId) => {
    const item = items.find((i) => i.id === id);
    if (!item || item.disabled) return; // disabled items explain themselves and stay open
    // Actions that open a dialog keep focus there; everything else returns focus to More.
    close(!DIALOG_ACTIONS.has(id));
    if (id.startsWith('react:')) return p.onReaction(id.slice(6));
    switch (id) {
      case 'toggle-pause-video': return p.onTogglePauseVideo();
      case 'toggle-layout': return p.onToggleLayout();
      case 'open-greet': return p.onTogglePanel('greet');
      case 'open-transcript': return p.onTogglePanel('transcript');
      case 'open-crm': return p.onTogglePanel('crm');
      case 'open-notes': return p.onTogglePanel('notes');
      case 'record-start': return p.onStartRecording();
      case 'record-pause-resume': return p.onPauseResumeRecording();
      case 'record-stop': return p.onStopRecording();
      case 'open-settings': return p.onOpenSettings();
      case 'toggle-raise-hand': return p.onToggleRaiseHand?.();
      case 'toggle-waiting-room': return p.onToggleWaitingRoom?.();
      case 'mute-all': return p.onMuteAll?.();
      case 'lower-all-hands': return p.onLowerAllHands?.();
      case 'toggle-lock': return p.onToggleLock?.();
      case 'open-upgrade': return p.onOpenUpgrade?.();
      case 'end-for-everyone': return p.onEndForEveryone();
    }
  };

  const onMoreKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openMenu('first'); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); openMenu('last'); }
  };

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); return; }
    if (e.key === 'Tab') { close(false); return; }
    const n = nextMenuIndex(e.key, focusIdx, items.length);
    if (n !== null) { e.preventDefault(); setFocusIdx(n); }
  };

  const panelPressed = (tab: SidebarTab) => p.isSidebarOpen && p.activeSidebarTab === tab;
  let flatIndex = -1;

  return (
    <footer aria-label="Meeting controls" className="relative min-h-16 px-1.5 sm:px-4 py-2 rounded-2xl bg-slate-900/95 border border-white/10 backdrop-blur-xl flex items-center justify-between gap-2 shrink-0 z-30 shadow-2xl">
      <p className="sr-only" aria-live="polite" role="status">{announcement}</p>

      {/* Status: recording indicator (visible to everyone; a recording must never be hidden) */}
      <div className="hidden md:flex items-center min-w-0 w-40">
        {p.isRecording && (
          <span className={`inline-flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-bold ${p.isRecordingPaused ? 'bg-amber-500/20 text-amber-200' : 'bg-rose-600/25 text-rose-100'}`}>
            <span aria-hidden="true" className={`h-2 w-2 rounded-full ${p.isRecordingPaused ? 'bg-amber-300' : 'bg-rose-400 animate-pulse'}`} />
            {p.isRecordingPaused ? 'Recording paused' : 'Recording'} <span className="font-mono">{fmt(p.recordingDurationSeconds)}</span>
          </span>
        )}
        {!p.isRecording && p.isHandRaised && p.onToggleRaiseHand && (
          <button type="button" onClick={p.onToggleRaiseHand} className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold bg-amber-500/20 text-amber-200 hover:bg-amber-500/30 cursor-pointer ${focusRing}`}>
            <Hand className="h-3.5 w-3.5" /> Hand raised · lower
          </button>
        )}
      </div>

      {/* Primary controls */}
      <div role="toolbar" aria-label="Meeting" className="flex items-center gap-1 sm:gap-2 mx-auto md:mx-0">
        <ControlButton id="btn-toggle-mic" onClick={p.onToggleMic} tone={p.isMicMuted ? 'off' : 'default'}
          label={p.isMicMuted ? 'Turn on microphone' : 'Turn off microphone'} tooltip={p.isMicMuted ? 'Microphone is off · turn on' : 'Microphone is on · turn off'}
          icon={p.isMicMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5 text-emerald-400" />} text={p.isMicMuted ? 'Unmute' : 'Mute'} />
        <ControlButton id="btn-toggle-cam" onClick={p.onToggleCam} tone={p.isCamOff ? 'off' : 'default'}
          label={p.isCamOff ? 'Turn on camera' : 'Turn off camera'} tooltip={p.isCamOff ? 'Camera is off · turn on' : 'Camera is on · turn off'}
          icon={p.isCamOff ? <VideoOff className="h-5 w-5" /> : <Video className="h-5 w-5 text-indigo-300" />} text={p.isCamOff ? 'Start video' : 'Stop video'} />
        {canShare && (
          <ControlButton id="btn-share-screen" onClick={p.onToggleScreenShare} tone={p.isScreenSharing ? 'active' : 'default'} pressed={p.isScreenSharing}
            label="Share screen" tooltip={p.isScreenSharing ? 'You are sharing · stop sharing' : 'Share your screen'}
            icon={p.isScreenSharing ? <MonitorOff className="h-5 w-5" /> : <MonitorUp className="h-5 w-5" />} text={p.isScreenSharing ? 'Stop sharing' : 'Share'} />
        )}
        <ControlButton id="btn-tab-people" onClick={() => p.onTogglePanel('participants')} tone={panelPressed('participants') ? 'active' : 'default'} pressed={panelPressed('participants')}
          label={`Participants (${p.participantsCount})${perms.canManageParticipants && p.waitingCount ? `, ${p.waitingCount} waiting` : ''}`}
          tooltip={perms.canManageParticipants && p.waitingCount ? `${p.waitingCount} waiting to join` : undefined}
          icon={<Users className="h-5 w-5" />}
          badge={perms.canManageParticipants && p.waitingCount
            ? <span aria-hidden="true" className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-amber-400 text-[10px] leading-5 font-mono font-bold text-neutral-950 text-center animate-pulse">{p.waitingCount}</span>
            : <span aria-hidden="true" className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-neutral-600 text-[10px] leading-5 font-mono text-white text-center">{p.participantsCount}</span>} />
        <ControlButton id="btn-tab-chat" onClick={() => p.onTogglePanel('chat')} tone={panelPressed('chat') ? 'active' : 'default'} pressed={panelPressed('chat')}
          label={p.chatCount ? `Chat (${p.chatCount} messages)` : 'Chat'} icon={<MessageSquare className="h-5 w-5" />}
          badge={p.chatCount > 0 ? <span aria-hidden="true" className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-indigo-400 text-[10px] leading-5 font-mono text-neutral-950 text-center">{p.chatCount > 99 ? '99+' : p.chatCount}</span> : undefined} />
        <ControlButton id="btn-tab-notes" wrapperClass="hidden sm:block" onClick={() => p.onTogglePanel('notes')} tone={panelPressed('notes') ? 'active' : 'default'} pressed={panelPressed('notes')}
          label="Meeting notes" tooltip="Meeting notes (saved to the CRM)" icon={<NotebookPen className="h-5 w-5" />} />
        <ControlButton id="btn-more" buttonRef={moreRef} onClick={() => (open ? close(true) : openMenu('first'))} tone={open ? 'active' : 'default'}
          label="More options" icon={<MoreHorizontal className="h-5 w-5" />}
          extra={{ 'aria-haspopup': 'menu', 'aria-expanded': open, 'aria-controls': open ? menuId : undefined, onKeyDown: onMoreKeyDown }} />
        <ControlButton id="btn-leave-meeting" onClick={p.onLeave} tone="danger" label="Leave meeting" tooltip="Leave the meeting (it continues for others)"
          icon={<PhoneOff className="h-5 w-5" />} text="Leave" />
      </div>

      <div className="hidden md:block w-40" aria-hidden="true" />

      {open && (
        <>
          {pos.sheet && <div className="fixed inset-0 z-[60] bg-black/50" aria-hidden="true" />}
          <div
            ref={menuRef}
            id={menuId}
            role="menu"
            aria-label="More options"
            onKeyDown={onMenuKeyDown}
            style={pos.sheet ? { maxHeight: pos.maxHeight } : { right: pos.right, bottom: pos.bottom, maxHeight: pos.maxHeight }}
            className={`fixed z-[61] overflow-y-auto overscroll-contain bg-neutral-900 border border-white/10 shadow-2xl text-neutral-100 p-2 ${
              pos.sheet ? 'inset-x-0 bottom-0 rounded-t-2xl pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))]' : 'w-72 rounded-2xl'
            }`}
          >
            {pos.sheet && <div aria-hidden="true" className="mx-auto mb-2 h-1 w-10 rounded-full bg-neutral-600" />}
            {sections.map((s) => {
              const headingId = `${menuId}-${s.id}`;
              const compact = s.items.every((i) => i.compact);
              return (
                <div key={s.id} role="group" aria-labelledby={headingId} className="py-1 border-b border-white/5 last:border-b-0">
                  <p id={headingId} className="px-2 pt-1 pb-1 text-[11px] font-semibold text-neutral-400">{s.title}</p>
                  <div className={compact ? 'flex flex-wrap gap-1 px-1' : 'space-y-0.5'}>
                    {s.items.map((item) => {
                      flatIndex += 1;
                      const idx = flatIndex;
                      const Icon = item.icon ? ICONS[item.icon] : null;
                      const isCheck = item.checked !== undefined;
                      return (
                        <button
                          key={item.id}
                          ref={(el) => { itemRefs.current[idx] = el; }}
                          type="button"
                          role={isCheck ? 'menuitemcheckbox' : 'menuitem'}
                          aria-checked={isCheck ? item.checked : undefined}
                          aria-disabled={item.disabled || undefined}
                          aria-label={item.compact ? `React with ${item.label}` : undefined}
                          aria-describedby={item.disabledReason ? `${headingId}-${idx}-why` : undefined}
                          tabIndex={-1}
                          data-menu-id={item.id}
                          onClick={() => run(item.id)}
                          onMouseEnter={() => setFocusIdx(idx)}
                          className={`${item.compact ? 'h-11 w-11 text-xl justify-center' : 'w-full min-h-11 px-2.5 text-sm'} flex items-center gap-2.5 rounded-lg text-left ${focusRing} ${
                            item.disabled ? 'opacity-50 cursor-not-allowed' : item.danger ? 'text-rose-300 hover:bg-rose-600/20 focus:bg-rose-600/20 cursor-pointer' : 'hover:bg-white/5 focus:bg-white/10 cursor-pointer'
                          }`}
                        >
                          {item.compact ? item.label : (
                            <>
                              {Icon && <Icon className="h-4 w-4 shrink-0" />}
                              <span className="flex-1">
                                {item.label}
                                {item.disabledReason && <span id={`${headingId}-${idx}-why`} className="block text-[11px] text-neutral-400">{item.disabledReason}</span>}
                              </span>
                              {isCheck && <span aria-hidden="true" className={`text-[11px] ${item.checked ? 'text-emerald-300' : 'text-neutral-500'}`}>{item.checked ? 'On' : 'Off'}</span>}
                            </>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </footer>
  );
}

/** Confirmation before ending the meeting for everyone (role="alertdialog"; Esc or Cancel keeps the meeting running). */
export function EndMeetingConfirmDialog(props: { open: boolean; isRecording: boolean; participantsCount: number; onCancel: () => void; onConfirm: () => void }) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const titleId = useId(), descId = useId();
  useEffect(() => {
    if (!props.open) return;
    const t = setTimeout(() => cancelRef.current?.focus(), 0);
    // Esc works wherever focus is while the dialog is open.
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); props.onCancel(); } };
    document.addEventListener('keydown', onKey);
    return () => { clearTimeout(t); document.removeEventListener('keydown', onKey); };
  }, [props.open, props.onCancel]);
  if (!props.open) return null;
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Tab') { // keep focus inside the two buttons
      e.preventDefault();
      (document.activeElement === cancelRef.current ? confirmRef : cancelRef).current?.focus();
    }
  };
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onKeyDown={onKeyDown}>
      <div role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descId}
        className="obsidian w-full max-w-sm p-6 rounded-3xl bg-[var(--obsidian-1)] border border-white/15 shadow-2xl space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-rose-600/20 text-rose-400"><Power className="h-5 w-5" /></div>
          <h3 id={titleId} className="text-base font-bold text-white">End the meeting for everyone?</h3>
        </div>
        <p id={descId} className="text-sm text-neutral-300 leading-relaxed">
          All {props.participantsCount} participants will be removed and the meeting closes.
          {props.isRecording ? ' The recording will be stopped and saved.' : ''} To leave without ending it for others, choose Leave instead.
        </p>
        <div className="flex gap-2 pt-1">
          <button ref={cancelRef} type="button" onClick={props.onCancel} className={`flex-1 min-h-11 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-white text-sm font-semibold ${focusRing}`}>Keep meeting</button>
          <button ref={confirmRef} type="button" onClick={props.onConfirm} className={`flex-1 min-h-11 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-sm font-bold ${focusRing}`}>End for everyone</button>
        </div>
      </div>
    </div>
  );
}
