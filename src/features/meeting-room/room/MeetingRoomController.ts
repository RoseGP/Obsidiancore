/**
 * Meeting room lifecycle: pre-join preview, join (server token → LiveKit), camera / microphone / screen
 * sharing, device and permission recovery, reconnection, and leaving.
 *
 * Framework-free: the UI subscribes to immutable snapshots (useSyncExternalStore) and calls methods; the
 * controller owns every LiveKit object and listener. Each listener it adds is recorded with its remover, and
 * teardown runs the removers exactly once, so leaving, rejoining or unmounting never leaks listeners or
 * leaves capture running.
 *
 * Capture is only started by an explicit user action (turning the camera/microphone on, or joining with
 * them on). Before joining, the preview tracks are created with livekit-client's createLocalVideoTrack /
 * createLocalAudioTrack and those same tracks are published on join (no second permission prompt). Because
 * LiveKit created them, it also restarts them itself if the device disappears while published.
 */
import { DisconnectReason, Room, RoomEvent, Track, TrackEvent, createLocalAudioTrack, createLocalVideoTrack } from 'livekit-client';
import { createMeetingTokenClient, MeetingApiError, normalizeRoomCode, type MeetingTokenClient } from '../api/meetingTokenClient';
import {
  captureEnvironment, classifyCaptureError, classifyScreenShareError, issueFor, queryPermission, watchPermission,
  type CaptureEnvironment, type DeviceIssue, type DeviceKind, type PermissionStatus, type ScreenShareIssue,
} from '../media/deviceErrors';
import type {
  DeviceOption, DeviceState, LocalTrackLike, MeetingPhase, MeetingSnapshot, Notice, ParticipantLike, ParticipantView,
  PublicationLike, Quality, RoomLike, TrackRef,
} from './types';

export interface ControllerDeps {
  tokenClient: MeetingTokenClient;
  createRoom: () => RoomLike;
  createLocalVideoTrack: (options: { deviceId?: string; resolution?: { width: number; height: number; frameRate?: number } }) => Promise<LocalTrackLike>;
  createLocalAudioTrack: (options: { deviceId?: string }) => Promise<LocalTrackLike>;
  /** The browser globals the controller reads (window by default; a stand-in in tests). */
  env?: { navigator?: Navigator; isSecureContext?: boolean; document?: Document } | undefined;
  /** How often to ask again while waiting for the host to let you in. */
  waitingPollMs?: number;
}

const CAMERA_RESOLUTION = { width: 1280, height: 720, frameRate: 30 };
const SCREEN_OPTIONS = {
  audio: false,                 // tab/system audio is opt-in elsewhere; it can echo and isn't needed for slides/apps
  contentHint: 'detail' as const,
  selfBrowserSurface: 'exclude' as const,   // don't offer this tab (avoids the hall-of-mirrors effect)
  surfaceSwitching: 'include' as const,
};

const QUALITIES: Quality[] = ['excellent', 'good', 'poor', 'lost'];
const toQuality = (q: string): Quality => (QUALITIES.includes(q as Quality) ? (q as Quality) : 'unknown');
const sourceOf = (kind: DeviceKind) => (kind === 'camera' ? Track.Source.Camera : Track.Source.Microphone);
const mediaKindOf = (kind: DeviceKind): MediaDeviceKind => (kind === 'camera' ? 'videoinput' : 'audioinput');
const live = (t: { mediaStreamTrack?: MediaStreamTrack } | null | undefined) => !!t?.mediaStreamTrack && t.mediaStreamTrack.readyState !== 'ended';

function disconnectMessage(reason: number | undefined): Notice {
  switch (reason) {
    case DisconnectReason.PARTICIPANT_REMOVED: return { tone: 'warning', text: 'The host removed you from the meeting.' };
    case DisconnectReason.ROOM_DELETED: return { tone: 'info', text: 'The meeting has ended.' };
    case DisconnectReason.DUPLICATE_IDENTITY: return { tone: 'warning', text: 'You joined this meeting from another tab or device, so this one was disconnected.' };
    case DisconnectReason.SERVER_SHUTDOWN: return { tone: 'warning', text: 'The media server restarted. Rejoin to continue.' };
    case DisconnectReason.JOIN_FAILURE: return { tone: 'error', text: 'The connection to the meeting couldn\'t be completed. Rejoin to try again.' };
    default: return { tone: 'error', text: 'The connection to the meeting was lost. Rejoin to continue.' };
  }
}

interface DeviceInternal {
  permission: PermissionStatus;
  pending: boolean;
  issue: DeviceIssue | null;
  deviceId: string | null;
  devices: DeviceOption[];
  /** What the user asked for: on or off. Used to tell a user mute from a device failure. */
  wanted: boolean;
}

export class MeetingRoomController {
  private readonly deps: Required<Pick<ControllerDeps, 'waitingPollMs'>> & ControllerDeps;
  private readonly env: CaptureEnvironment;
  private listeners = new Set<() => void>();
  private snapshot: MeetingSnapshot;

  private phase: MeetingPhase = 'prejoin';
  private roomCode: string | null = null;
  private error: MeetingSnapshot['error'] = null;
  private notice: Notice | null = null;
  private dev: Record<DeviceKind, DeviceInternal>;
  private screen = { pending: false, issue: null as ScreenShareIssue | null };
  private audioBlocked = false;

  private room: RoomLike | null = null;
  private roomCleanup: Array<() => void> = [];
  private preview: Record<DeviceKind, LocalTrackLike | null> = { camera: null, microphone: null };
  private previewCleanup: Record<DeviceKind, (() => void) | null> = { camera: null, microphone: null };
  private globalCleanup: Array<() => void> = [];
  private joinSeq = 0;
  private joinAbort: AbortController | null = null;
  private waitTimer: ReturnType<typeof setTimeout> | null = null;
  private stoppingScreen = false;
  private order = new Map<string, number>();
  private nextOrder = 1;
  private initialized = false;
  private disposed = false;

  constructor(deps: ControllerDeps) {
    this.deps = { waitingPollMs: 4000, ...deps };
    this.env = captureEnvironment(deps.env);
    const base = (kind: DeviceKind): DeviceInternal => {
      const blocked = this.env.blockedBy[kind];
      return { permission: 'unknown', pending: false, issue: blocked ? issueFor(blocked, kind) : null, deviceId: null, devices: [], wanted: false };
    };
    this.dev = { camera: base('camera'), microphone: base('microphone') };
    this.snapshot = this.build();
  }

  // ---------------------------------------------------------------------------
  // Store interface (useSyncExternalStore)
  // ---------------------------------------------------------------------------

  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getSnapshot = () => this.snapshot;
  get isDisposed() { return this.disposed; }
  /** Listener count on the current room, for tests and leak checks. */
  get roomListenerCount() { return this.roomCleanup.length; }

  private emit() {
    if (this.disposed) return;
    this.snapshot = this.build();
    this.listeners.forEach((fn) => fn());
  }

  // ---------------------------------------------------------------------------
  // Pre-join
  // ---------------------------------------------------------------------------

  /** Reads permissions and devices without prompting, and starts watching for changes. Safe to call twice. */
  async init() {
    if (this.initialized || this.disposed) return;
    this.initialized = true;
    const nav = this.deps.env?.navigator as any;
    for (const kind of ['camera', 'microphone'] as DeviceKind[]) {
      this.dev[kind].permission = await queryPermission(kind, nav);
      if (this.disposed) return;
      if (this.dev[kind].permission === 'denied' && !this.dev[kind].issue) this.dev[kind].issue = issueFor('denied', kind);
      const stop = await watchPermission(kind, nav, (s) => this.onPermissionChange(kind, s));
      if (this.disposed) { stop(); return; }
      this.globalCleanup.push(stop);
    }
    const md = nav?.mediaDevices as MediaDevices | undefined;
    if (md?.addEventListener) {
      const onChange = () => { void this.refreshDevices(true); };
      md.addEventListener('devicechange', onChange);
      this.globalCleanup.push(() => md.removeEventListener('devicechange', onChange));
    }
    await this.refreshDevices(false);
    this.emit();
  }

  /** The user turned the camera on/off (pre-join preview or in the meeting). */
  async setCameraEnabled(on: boolean) { return this.setDeviceEnabled('camera', on); }
  /** The user turned the microphone on/off. */
  async setMicrophoneEnabled(on: boolean) { return this.setDeviceEnabled('microphone', on); }
  toggleCamera() { return this.setDeviceEnabled('camera', !this.snapshot.camera.active); }
  toggleMicrophone() { return this.setDeviceEnabled('microphone', !this.snapshot.microphone.active); }

  /** Try again after a failure (e.g. the user allowed access in site settings or plugged a device in). */
  async retry(kind: DeviceKind) {
    this.dev[kind].issue = null;
    this.dev[kind].permission = await queryPermission(kind, this.deps.env?.navigator as any);
    return this.setDeviceEnabled(kind, true);
  }

  async selectDevice(kind: DeviceKind, deviceId: string | null) {
    const d = this.dev[kind];
    d.deviceId = deviceId || null;
    this.emit();
    try {
      if (this.room) {
        if (deviceId) await this.room.switchActiveDevice(mediaKindOf(kind), deviceId, true);
      } else if (this.preview[kind]) {
        await this.preview[kind]!.restartTrack(deviceId ? { deviceId: { exact: deviceId } } : {});
      }
      d.issue = null;
    } catch (e) {
      d.issue = classifyCaptureError(e, kind);
    }
    this.emit();
  }

  private async setDeviceEnabled(kind: DeviceKind, on: boolean) {
    if (this.disposed) return;
    const d = this.dev[kind];
    if (on && this.env.blockedBy[kind]) { d.issue = issueFor(this.env.blockedBy[kind]!, kind); this.emit(); return; }
    if (d.pending) return;
    d.wanted = on;
    d.pending = true;
    if (on) d.issue = null;
    this.error = null;
    this.emit();
    try {
      if (this.room && (this.phase === 'connected' || this.phase === 'reconnecting')) {
        const lp = this.room.localParticipant;
        const options = d.deviceId ? { deviceId: { exact: d.deviceId } } : {};
        if (kind === 'camera') await lp.setCameraEnabled(on, on ? { ...options, resolution: CAMERA_RESOLUTION } : undefined, { simulcast: true });
        else await lp.setMicrophoneEnabled(on, on ? options : undefined);
      } else if (!this.room) {
        // Pre-join, joining, waiting for the host, or after a disconnect: the local preview.
        if (on) await this.startPreview(kind);
        else this.stopPreview(kind);
      }
      if (on) d.permission = 'granted';
    } catch (e) {
      d.wanted = false;
      d.issue = classifyCaptureError(e, kind);
      if (d.issue.code === 'denied') d.permission = 'denied';
    } finally {
      d.pending = false;
      this.emit();
    }
  }

  private async startPreview(kind: DeviceKind) {
    if (this.preview[kind] && live(this.preview[kind])) return;
    this.stopPreview(kind);
    const deviceId = this.dev[kind].deviceId ?? undefined;
    const track = kind === 'camera'
      ? await this.deps.createLocalVideoTrack({ deviceId, resolution: CAMERA_RESOLUTION })
      : await this.deps.createLocalAudioTrack({ deviceId });
    if (this.disposed || this.room || !this.dev[kind].wanted) { track.stop(); return; }
    this.preview[kind] = track;
    const onEnded = () => {
      if (this.preview[kind] !== track) return;
      this.stopPreview(kind);
      this.dev[kind].wanted = false;
      this.dev[kind].issue = issueFor('ended', kind);
      this.emit();
    };
    track.on?.(TrackEvent.Ended, onEnded);
    this.previewCleanup[kind] = () => { track.off?.(TrackEvent.Ended, onEnded); };
    // Labels become available once permission is granted.
    void this.refreshDevices(false).then(() => this.emit());
  }

  private stopPreview(kind: DeviceKind) {
    this.previewCleanup[kind]?.();
    this.previewCleanup[kind] = null;
    const t = this.preview[kind];
    this.preview[kind] = null;
    if (t) { try { t.stop(); } catch { /* already stopped */ } }
  }

  // ---------------------------------------------------------------------------
  // Join
  // ---------------------------------------------------------------------------

  async join(roomCodeInput: string) {
    if (this.disposed || this.phase === 'joining' || this.phase === 'waiting' || this.phase === 'connected' || this.phase === 'reconnecting') return;
    const code = normalizeRoomCode(roomCodeInput);
    if (!code) { this.error = { code: 'invalid_input', message: 'That meeting code isn\'t valid. Codes look like abc-defg-hij.' }; this.emit(); return; }
    this.roomCode = code;
    this.error = null;
    this.notice = null;
    this.phase = 'joining';
    const seq = ++this.joinSeq;
    this.joinAbort?.abort();
    this.joinAbort = new AbortController();
    this.emit();
    await this.requestToken(seq);
  }

  /** Stop joining (or stop waiting for the host) and go back to the pre-join screen. */
  async cancelJoin() {
    if (this.phase !== 'joining' && this.phase !== 'waiting') return;
    this.joinSeq++;
    this.joinAbort?.abort();
    this.clearWaitTimer();
    const code = this.roomCode;
    this.phase = 'prejoin';
    this.emit();
    if (code) await this.deps.tokenClient.leave(code);
  }

  private async requestToken(seq: number) {
    const code = this.roomCode!;
    try {
      const r = await this.deps.tokenClient.join(code, this.joinAbort?.signal);
      if (seq !== this.joinSeq || this.disposed) return;
      if (r.kind === 'waiting') {
        this.phase = 'waiting';
        this.emit();
        this.clearWaitTimer();
        this.waitTimer = setTimeout(() => { this.waitTimer = null; if (seq === this.joinSeq) void this.requestToken(seq); }, this.deps.waitingPollMs);
        return;
      }
      await this.connect(seq, r.url, r.token);
    } catch (e) {
      if (seq !== this.joinSeq || this.disposed || (e as Error)?.name === 'AbortError') return;
      const err = e instanceof MeetingApiError ? e : new MeetingApiError('Couldn\'t join the meeting. Try again.', 0, 'unknown');
      this.phase = 'prejoin';
      this.error = { code: err.code, message: err.message };
      this.emit();
    }
  }

  private async connect(seq: number, url: string, token: string) {
    const room = this.deps.createRoom();
    this.room = room;
    this.attachRoomListeners(room);
    try {
      await room.connect(url, token, { autoSubscribe: true });
    } catch (e) {
      if (this.room === room) this.teardownRoom(false);
      if (seq !== this.joinSeq || this.disposed) return;
      this.phase = 'prejoin';
      this.error = { code: 'connect_failed', message: `Couldn't connect to the meeting's audio and video${(e as Error)?.message ? ` (${(e as Error).message})` : ''}. Check your network and try again.` };
      this.emit();
      return;
    }
    if (seq !== this.joinSeq || this.disposed || this.room !== room) { if (this.room === room) this.teardownRoom(true); else await room.disconnect(true).catch(() => {}); return; }
    this.phase = 'connected';
    this.audioBlocked = !room.canPlaybackAudio;
    this.observe(room.localParticipant);
    room.remoteParticipants.forEach((p) => this.observe(p));
    this.emit();
    await this.publishPreviews(room);
    this.emit();
  }

  /** Publishes only what the user turned on before joining; ownership of those tracks moves to the room. */
  private async publishPreviews(room: RoomLike) {
    const lp = room.localParticipant;
    for (const kind of ['microphone', 'camera'] as DeviceKind[]) {
      const track = this.preview[kind];
      if (!track) continue;
      this.previewCleanup[kind]?.();
      this.previewCleanup[kind] = null;
      this.preview[kind] = null;
      if (!this.dev[kind].wanted || !live(track)) { try { track.stop(); } catch { /* ignore */ } continue; }
      this.dev[kind].pending = true;
      this.emit();
      try {
        await lp.publishTrack(track, kind === 'camera' ? { source: Track.Source.Camera, simulcast: true } : { source: Track.Source.Microphone });
      } catch (e) {
        try { track.stop(); } catch { /* ignore */ }
        this.dev[kind].wanted = false;
        this.dev[kind].issue = { ...issueFor('unknown', kind), message: `Connected, but your ${kind} couldn't be shared: ${(e as Error)?.message || 'publishing failed'}. Try turning it on again.` };
      } finally {
        this.dev[kind].pending = false;
      }
    }
  }

  private attachRoomListeners(room: RoomLike) {
    const on = (event: string, fn: (...args: any[]) => void) => { room.on(event, fn); this.roomCleanup.push(() => { room.off(event, fn); }); };
    const refresh = () => this.emit();
    for (const ev of [
      RoomEvent.TrackPublished, RoomEvent.TrackUnpublished, RoomEvent.TrackSubscribed, RoomEvent.TrackUnsubscribed,
      RoomEvent.TrackMuted, RoomEvent.TrackUnmuted, RoomEvent.LocalTrackPublished, RoomEvent.ActiveSpeakersChanged,
      RoomEvent.ConnectionQualityChanged, RoomEvent.ParticipantNameChanged, RoomEvent.TrackStreamStateChanged,
    ]) on(ev, refresh);
    on(RoomEvent.ParticipantConnected, (p: ParticipantLike) => { this.observe(p); this.emit(); });
    on(RoomEvent.ParticipantDisconnected, () => this.emit());
    on(RoomEvent.TrackMuted, (pub: PublicationLike, p: ParticipantLike) => this.onLocalMuteChange(pub, p, true));
    on(RoomEvent.TrackUnmuted, (pub: PublicationLike, p: ParticipantLike) => this.onLocalMuteChange(pub, p, false));
    on(RoomEvent.LocalTrackUnpublished, (pub: PublicationLike) => {
      if (pub.source === Track.Source.ScreenShare && !this.stoppingScreen) {
        // Ended from the browser's own "Stop sharing" control (LiveKit unpublishes it on TrackEnded).
        this.notice = { tone: 'info', text: 'You stopped sharing your screen.' };
      }
      this.emit();
    });
    on(RoomEvent.MediaDevicesError, (err: unknown, kind?: MediaDeviceKind) => {
      const k: DeviceKind | null = kind === 'videoinput' ? 'camera' : kind === 'audioinput' ? 'microphone' : null;
      if (!k) return;
      this.dev[k].issue = classifyCaptureError(err, k);
      this.emit();
    });
    on(RoomEvent.MediaDevicesChanged, () => { void this.refreshDevices(true); });
    on(RoomEvent.ActiveDeviceChanged, (kind: MediaDeviceKind, deviceId: string) => {
      const k: DeviceKind | null = kind === 'videoinput' ? 'camera' : kind === 'audioinput' ? 'microphone' : null;
      if (k && deviceId && deviceId !== 'default') { this.dev[k].deviceId = deviceId; this.emit(); }
    });
    on(RoomEvent.AudioPlaybackStatusChanged, () => { this.audioBlocked = !room.canPlaybackAudio; this.emit(); });
    on(RoomEvent.Reconnecting, () => { this.phase = 'reconnecting'; this.notice = { tone: 'warning', text: 'Connection lost. Reconnecting…' }; this.emit(); });
    on(RoomEvent.SignalReconnecting, () => { this.phase = 'reconnecting'; this.notice = { tone: 'warning', text: 'Connection unstable. Reconnecting…' }; this.emit(); });
    on(RoomEvent.Reconnected, () => { this.phase = 'connected'; this.notice = { tone: 'info', text: 'Reconnected.' }; this.emit(); });
    on(RoomEvent.Disconnected, (reason?: number) => this.onDisconnected(room, reason));
  }

  private observe(p: ParticipantLike) {
    if (!this.order.has(p.identity)) this.order.set(p.identity, this.nextOrder++);
  }

  /** LiveKit mutes a local camera/mic it couldn't restart (device gone, access revoked): show it, don't hide it. */
  private onLocalMuteChange(pub: PublicationLike, p: ParticipantLike, muted: boolean) {
    if (!this.room || p.identity !== this.room.localParticipant.identity) return;
    const kind: DeviceKind | null = pub.source === Track.Source.Camera ? 'camera' : pub.source === Track.Source.Microphone ? 'microphone' : null;
    if (!kind) return;
    const d = this.dev[kind];
    if (muted && d.wanted && !d.pending) {
      d.wanted = false;
      d.issue = d.permission === 'denied' ? issueFor('denied', kind) : issueFor('ended', kind);
      this.emit();
    } else if (!muted && d.issue?.code === 'ended') {
      d.issue = null;
      this.emit();
    }
  }

  private onPermissionChange(kind: DeviceKind, s: PermissionStatus) {
    const d = this.dev[kind];
    d.permission = s;
    if (s === 'denied' && (d.wanted || this.preview[kind])) {
      d.issue = issueFor('denied', kind);
      if (this.preview[kind]) { this.stopPreview(kind); d.wanted = false; }
    } else if (s !== 'denied' && d.issue?.code === 'denied') {
      d.issue = null;
    }
    this.emit();
  }

  private onDisconnected(room: RoomLike, reason?: number) {
    if (this.room !== room) return;
    if (this.phase === 'leaving') return; // our own leave() handles the rest
    const code = this.roomCode;
    this.teardownRoom(true);
    this.phase = 'disconnected';
    this.notice = disconnectMessage(reason);
    this.emit();
    // Keep the roster in step, except when another tab of ours took over the same seat.
    if (code && reason !== DisconnectReason.DUPLICATE_IDENTITY && reason !== DisconnectReason.ROOM_DELETED) void this.deps.tokenClient.leave(code);
  }

  // ---------------------------------------------------------------------------
  // Screen sharing
  // ---------------------------------------------------------------------------

  async setScreenShareEnabled(on: boolean) {
    const room = this.room;
    if (!room || this.phase !== 'connected' || this.screen.pending) return;
    if (on && !this.env.screen) {
      this.screen.issue = classifyScreenShareError({ name: 'NotSupportedError' });
      this.emit();
      return;
    }
    this.screen.pending = true;
    this.screen.issue = null;
    this.stoppingScreen = !on;
    this.emit();
    try {
      await room.localParticipant.setScreenShareEnabled(on, on ? SCREEN_OPTIONS : undefined);
    } catch (e) {
      const issue = classifyScreenShareError(e);
      this.screen.issue = issue.quiet ? null : issue;
      if (issue.quiet) this.notice = { tone: 'info', text: issue.message };
    } finally {
      this.screen.pending = false;
      this.stoppingScreen = false;
      this.emit();
    }
  }
  toggleScreenShare() { return this.setScreenShareEnabled(!this.snapshot.screen.active); }

  // ---------------------------------------------------------------------------
  // Audio playback, notices
  // ---------------------------------------------------------------------------

  /** Browsers block audio until the user interacts; call from a click. */
  async startAudio() {
    if (!this.room) return;
    try { await this.room.startAudio(); } catch { /* still blocked */ }
    this.audioBlocked = !this.room.canPlaybackAudio;
    this.emit();
  }
  dismissNotice() { this.notice = null; this.emit(); }
  dismissError() { this.error = null; this.emit(); }

  /** From the disconnected screen: back to the device check, keeping the meeting code. */
  backToPrejoin() {
    if (this.phase !== 'disconnected') return;
    this.phase = 'prejoin';
    this.emit();
  }

  // ---------------------------------------------------------------------------
  // Leave and teardown
  // ---------------------------------------------------------------------------

  /** Stops capture, unpublishes, disconnects, tells the server, and returns to the pre-join screen. Idempotent. */
  async leave() {
    if (this.phase === 'leaving') return;
    if (this.phase === 'joining' || this.phase === 'waiting') { await this.cancelJoin(); this.stopPreview('camera'); this.stopPreview('microphone'); this.resetDevices(); this.emit(); return; }
    if (!this.room) { this.stopPreview('camera'); this.stopPreview('microphone'); this.resetDevices(); this.phase = 'prejoin'; this.emit(); return; }
    const code = this.roomCode;
    this.phase = 'leaving';
    this.joinSeq++;
    this.emit();
    this.teardownRoom(true);
    this.stopPreview('camera');
    this.stopPreview('microphone');
    this.resetDevices();
    if (code) await this.deps.tokenClient.leave(code);
    if (this.disposed) return;
    this.phase = 'prejoin';
    this.notice = { tone: 'info', text: 'You left the meeting.' };
    this.emit();
  }

  /** Unmount: leave if needed, stop everything, remove every listener. Safe to call more than once. */
  dispose() {
    if (this.disposed) return;
    const code = this.room ? this.roomCode : null;
    this.joinSeq++;
    this.joinAbort?.abort();
    this.clearWaitTimer();
    this.teardownRoom(true);
    this.stopPreview('camera');
    this.stopPreview('microphone');
    this.globalCleanup.splice(0).forEach((fn) => { try { fn(); } catch { /* ignore */ } });
    this.disposed = true;
    this.listeners.clear();
    if (code) void this.deps.tokenClient.leave(code);
  }

  /** Removes our listeners first (so the disconnect isn't treated as a failure), stops local tracks, disconnects. */
  private teardownRoom(disconnect: boolean) {
    const room = this.room;
    this.room = null;
    this.roomCleanup.splice(0).forEach((fn) => { try { fn(); } catch { /* ignore */ } });
    this.clearWaitTimer();
    this.audioBlocked = false;
    this.screen = { pending: false, issue: null };
    this.order.clear();
    this.nextOrder = 1;
    if (!room) return;
    room.localParticipant.trackPublications.forEach((pub) => {
      const t = pub.track as LocalTrackLike | undefined;
      try { t?.stop?.(); } catch { /* already stopped */ }
    });
    if (disconnect) room.disconnect(true).catch(() => {});
  }

  private resetDevices() {
    for (const kind of ['camera', 'microphone'] as DeviceKind[]) {
      const d = this.dev[kind];
      d.wanted = false;
      d.pending = false;
      if (d.issue?.code === 'ended') d.issue = null;
    }
  }

  private clearWaitTimer() { if (this.waitTimer) { clearTimeout(this.waitTimer); this.waitTimer = null; } }

  // ---------------------------------------------------------------------------
  // Devices
  // ---------------------------------------------------------------------------

  private async refreshDevices(handleRemoval: boolean) {
    const md = (this.deps.env?.navigator as any)?.mediaDevices as MediaDevices | undefined;
    if (!md?.enumerateDevices) return;
    let list: MediaDeviceInfo[] = [];
    try { list = await md.enumerateDevices(); } catch { return; }
    if (this.disposed) return;
    for (const kind of ['camera', 'microphone'] as DeviceKind[]) {
      const d = this.dev[kind];
      const of = list.filter((x) => x.kind === mediaKindOf(kind) && x.deviceId);
      d.devices = of.map((x, i) => ({ deviceId: x.deviceId, label: x.label || `${kind === 'camera' ? 'Camera' : 'Microphone'} ${i + 1}` }));
      if (handleRemoval && d.deviceId && !of.some((x) => x.deviceId === d.deviceId)) {
        // The chosen device was unplugged: fall back to the default one and say so.
        d.deviceId = null;
        this.notice = { tone: 'warning', text: `Your selected ${kind} was disconnected. Using the default ${kind}.` };
        const fallback = of[0]?.deviceId;
        try {
          if (this.room && fallback) await this.room.switchActiveDevice(mediaKindOf(kind), fallback);
          else if (this.preview[kind]) await this.preview[kind]!.restartTrack({});
        } catch (e) { d.issue = classifyCaptureError(e, kind); }
      }
      if (handleRemoval && of.length === 0 && (d.wanted || this.preview[kind])) d.issue = issueFor('not_found', kind);
    }
    if (handleRemoval) this.emit();
  }

  // ---------------------------------------------------------------------------
  // Snapshot
  // ---------------------------------------------------------------------------

  private build(): MeetingSnapshot {
    const room = this.room;
    const lp = room?.localParticipant;
    const deviceState = (kind: DeviceKind): DeviceState => {
      const d = this.dev[kind];
      let active = false;
      if (lp && (this.phase === 'connected' || this.phase === 'reconnecting')) {
        const pub = lp.getTrackPublication(sourceOf(kind));
        active = !!pub?.track && !pub.isMuted && live(pub.track);
      } else {
        const t = this.preview[kind];
        active = !!t && !t.isMuted && live(t);
      }
      return { kind, permission: d.permission, active, pending: d.pending, issue: d.issue, deviceId: d.deviceId, devices: d.devices };
    };
    const screenPub = lp?.getTrackPublication(Track.Source.ScreenShare);
    const ref = (id: string, t: LocalTrackLike | null): TrackRef | null => (t && live(t) ? { id, track: t } : null);
    return {
      phase: this.phase,
      roomCode: this.roomCode,
      error: this.error,
      notice: this.notice,
      camera: deviceState('camera'),
      microphone: deviceState('microphone'),
      screen: { supported: this.env.screen, active: !!screenPub?.track && !screenPub.isMuted && live(screenPub.track), pending: this.screen.pending, issue: this.screen.issue },
      preview: ref('preview-camera', this.preview.camera),
      previewAudio: ref('preview-microphone', this.preview.microphone),
      participants: room && (this.phase === 'connected' || this.phase === 'reconnecting') ? this.buildParticipants(room) : [],
      audioBlocked: this.audioBlocked,
    };
  }

  private buildParticipants(room: RoomLike): ParticipantView[] {
    const trackRef = (pub: PublicationLike | undefined): TrackRef | null =>
      pub?.track && !pub.isMuted && live(pub.track) ? { id: pub.trackSid || `${pub.source}`, track: pub.track, width: pub.dimensions?.width, height: pub.dimensions?.height } : null;
    const view = (p: ParticipantLike, isLocal: boolean): ParticipantView => {
      this.observe(p);
      const mic = p.getTrackPublication(Track.Source.Microphone);
      return {
        key: p.identity,
        name: p.name || (isLocal ? 'You' : 'Guest'),
        isLocal,
        isSpeaking: p.isSpeaking,
        quality: toQuality(p.connectionQuality),
        micPublished: !!mic,
        micMuted: !mic || mic.isMuted,
        camera: trackRef(p.getTrackPublication(Track.Source.Camera)),
        screen: trackRef(p.getTrackPublication(Track.Source.ScreenShare)),
        audio: isLocal ? null : trackRef(mic),
        order: this.order.get(p.identity) ?? Number.MAX_SAFE_INTEGER,
      };
    };
    const out = [view(room.localParticipant, true)];
    room.remoteParticipants.forEach((p) => out.push(view(p, false)));
    return out.sort((a, b) => a.order - b.order);
  }
}

/** The production wiring: livekit-client, the app's token endpoints and the browser globals. */
export function createMeetingRoomController(overrides: Partial<ControllerDeps> = {}) {
  return new MeetingRoomController({
    tokenClient: createMeetingTokenClient(),
    createRoom: () => new Room({ adaptiveStream: true, dynacast: true }) as unknown as RoomLike,
    createLocalVideoTrack: (o) => createLocalVideoTrack(o as Parameters<typeof createLocalVideoTrack>[0]) as unknown as Promise<LocalTrackLike>,
    createLocalAudioTrack: (o) => createLocalAudioTrack(o as Parameters<typeof createLocalAudioTrack>[0]) as unknown as Promise<LocalTrackLike>,
    env: typeof window !== 'undefined' ? window : undefined,
    ...overrides,
  });
}
