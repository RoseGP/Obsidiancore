/**
 * Meeting control bar: the parts that don't depend on React (permissions, the More-menu model and
 * keyboard navigation), so they can be tested directly.
 *
 * Primary controls (always in the bar): microphone, camera, screen share (when the browser supports it),
 * participants, chat, More, Leave. Everything else lives in the More menu, grouped in sections.
 */

export type OrgRole = 'OWNER' | 'ADMIN' | 'MANAGER' | 'SALES_REP' | 'MARKETER' | 'READ_ONLY' | null;

export interface MeetingPermissions {
  /** End the meeting for every participant. */
  canEndForEveryone: boolean;
  /** Start, pause, resume and stop the meeting recording. */
  canRecord: boolean;
  /** Admit from the waiting room, mute or remove participants, lower hands. */
  canManageParticipants: boolean;
  /** Short explanation shown on host-only items for everyone else. */
  hostOnlyReason: string;
}

/**
 * Host of the meeting, or an administrator of the organization (OWNER / ADMIN), may end the meeting for
 * everyone and control recording. Other participants can leave, and see why host-only items are disabled.
 */
export function meetingPermissions(input: { isHost: boolean; orgRole?: OrgRole }): MeetingPermissions {
  const isAdmin = input.orgRole === 'OWNER' || input.orgRole === 'ADMIN';
  const privileged = !!input.isHost || isAdmin;
  return { canEndForEveryone: privileged, canRecord: privileged, canManageParticipants: privileged, hostOnlyReason: 'Only the host or an admin can do this' };
}

export function screenShareSupported(nav: Navigator | undefined = typeof navigator !== 'undefined' ? navigator : undefined): boolean {
  return !!(nav && nav.mediaDevices && typeof (nav.mediaDevices as any).getDisplayMedia === 'function');
}

export type SidebarTab = 'chat' | 'greet' | 'participants' | 'crm' | 'transcript';

export interface MeetingControlState {
  isHost: boolean;
  isVideoPaused: boolean;
  isCamOff: boolean;
  layoutMode: 'grid' | 'speaker';
  isSidebarOpen: boolean;
  activeSidebarTab: SidebarTab;
  isRecording: boolean;
  isRecordingPaused: boolean;
  /** Optional so older callers keep working; default false / 0. */
  isHandRaised?: boolean;
  isWaitingRoomEnabled?: boolean;
  raisedHandsCount?: number;
}

export type MenuActionId =
  | 'toggle-pause-video' | 'toggle-layout'
  | 'open-greet' | 'open-transcript' | 'open-crm'
  | `react:${string}`
  | 'record-start' | 'record-pause-resume' | 'record-stop'
  | 'open-settings'
  | 'toggle-raise-hand'
  | 'toggle-waiting-room' | 'mute-all' | 'lower-all-hands'
  | 'end-for-everyone';

export interface MenuItem {
  id: MenuActionId;
  label: string;
  /** checkbox items expose aria-checked */
  checked?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  danger?: boolean;
  /** rendered as a compact inline button (emoji reactions) */
  compact?: boolean;
  icon?: string;
}

export interface MenuSection { id: string; title: string; items: MenuItem[] }

export const REACTIONS = ['👏', '👍', '❤️', '🎉', '💡', '🚀', '🔥'];

export function buildMoreMenu(state: MeetingControlState, perms: MeetingPermissions): MenuSection[] {
  const panelOpen = (tab: SidebarTab) => state.isSidebarOpen && state.activeSidebarTab === tab;
  const sections: MenuSection[] = [
    {
      id: 'view', title: 'Video and layout', items: [
        { id: 'toggle-pause-video', label: state.isVideoPaused ? 'Resume my video' : 'Pause my video', checked: state.isVideoPaused, disabled: state.isCamOff, disabledReason: state.isCamOff ? 'Turn your camera on first' : undefined, icon: 'pause' },
        { id: 'toggle-layout', label: 'Speaker spotlight view', checked: state.layoutMode === 'speaker', icon: 'layout' },
      ],
    },
    {
      id: 'panels', title: 'Panels', items: [
        { id: 'open-greet', label: 'Meet & Greet', checked: panelOpen('greet'), icon: 'greet' },
        { id: 'open-transcript', label: 'Transcript', checked: panelOpen('transcript'), icon: 'transcript' },
        { id: 'open-crm', label: 'CRM records', checked: panelOpen('crm'), icon: 'crm' },
      ],
    },
    {
      id: 'participate', title: 'Participate', items: [
        { id: 'toggle-raise-hand', label: state.isHandRaised ? 'Lower my hand' : 'Raise my hand', checked: !!state.isHandRaised, icon: 'hand' },
      ],
    },
    {
      id: 'reactions', title: 'Send a reaction',
      items: REACTIONS.map((e) => ({ id: `react:${e}` as MenuActionId, label: e, compact: true })),
    },
    {
      id: 'recording', title: 'Recording',
      items: state.isRecording
        ? [
            { id: 'record-pause-resume', label: state.isRecordingPaused ? 'Resume recording' : 'Pause recording', disabled: !perms.canRecord, disabledReason: perms.canRecord ? undefined : perms.hostOnlyReason, icon: state.isRecordingPaused ? 'play' : 'pause' },
            { id: 'record-stop', label: 'Stop and save recording', disabled: !perms.canRecord, disabledReason: perms.canRecord ? undefined : perms.hostOnlyReason, icon: 'stop' },
          ]
        : [{ id: 'record-start', label: 'Record meeting', disabled: !perms.canRecord, disabledReason: perms.canRecord ? undefined : perms.hostOnlyReason, icon: 'record' }],
    },
    { id: 'settings', title: 'Settings', items: [{ id: 'open-settings', label: 'Audio and video settings', icon: 'settings' }] },
  ];
  // Host-only section is only shown to people who can use it: Leave stays the primary exit for everyone.
  const hostItems: MenuItem[] = [];
  if (perms.canManageParticipants) {
    hostItems.push(
      { id: 'toggle-waiting-room', label: 'Waiting room', checked: !!state.isWaitingRoomEnabled, icon: 'waiting' },
      { id: 'mute-all', label: 'Mute everyone else', icon: 'mute' },
    );
    if ((state.raisedHandsCount ?? 0) > 0) {
      hostItems.push({ id: 'lower-all-hands', label: `Lower all hands (${state.raisedHandsCount})`, icon: 'hand' });
    }
  }
  if (perms.canEndForEveryone) {
    hostItems.push({ id: 'end-for-everyone', label: 'End meeting for everyone', danger: true, icon: 'end' });
  }
  if (hostItems.length) sections.push({ id: 'host', title: 'Host controls', items: hostItems });
  return sections;
}

/** Flattened, in visual order: what arrow keys move through (disabled items stay focusable, per ARIA APG). */
export function flattenMenu(sections: MenuSection[]): MenuItem[] {
  return sections.flatMap((s) => s.items);
}

/** Next focus index for a menu key press; returns null for keys the menu doesn't handle. */
export function nextMenuIndex(key: string, current: number, count: number): number | null {
  if (count === 0) return null;
  switch (key) {
    case 'ArrowDown': case 'ArrowRight': return current < 0 ? 0 : (current + 1) % count;
    case 'ArrowUp': case 'ArrowLeft': return current < 0 ? count - 1 : (current - 1 + count) % count;
    case 'Home': return 0;
    case 'End': return count - 1;
    default: return null;
  }
}
