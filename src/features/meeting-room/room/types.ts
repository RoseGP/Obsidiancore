/**
 * Types for the meeting room: the immutable snapshot the UI renders, and the narrow structural view of
 * livekit-client the controller depends on (so tests can supply fakes; the real objects come from
 * livekit-client 2.x: Room, LocalParticipant, RemoteParticipant, TrackPublication, LocalTrack).
 */
import type { DeviceIssue, DeviceKind, PermissionStatus, ScreenShareIssue } from '../media/deviceErrors';

// ---------------------------------------------------------------------------
// livekit-client surface used by the controller
// ---------------------------------------------------------------------------

/** Track.Source values from livekit-client. */
export type SourceName = 'camera' | 'microphone' | 'screen_share' | 'screen_share_audio' | 'unknown';

export interface TrackLike {
  sid?: string;
  kind: 'audio' | 'video' | string;
  source: SourceName | string;
  isMuted: boolean;
  mediaStreamTrack: MediaStreamTrack;
  attach(element?: HTMLMediaElement): HTMLMediaElement;
  detach(element?: HTMLMediaElement): HTMLMediaElement | HTMLMediaElement[];
  on?(event: string, fn: (...args: any[]) => void): unknown;
  off?(event: string, fn: (...args: any[]) => void): unknown;
}

export interface LocalTrackLike extends TrackLike {
  stop(): void;
  mute(): Promise<unknown>;
  unmute(): Promise<unknown>;
  restartTrack(options?: unknown): Promise<void>;
}

export interface PublicationLike {
  trackSid: string;
  source: SourceName | string;
  kind: string;
  isMuted: boolean;
  track?: TrackLike;
  dimensions?: { width: number; height: number };
}

export interface ParticipantLike {
  identity: string;
  name?: string;
  isSpeaking: boolean;
  connectionQuality: string;
  getTrackPublication(source: SourceName): PublicationLike | undefined;
  trackPublications: Map<string, PublicationLike>;
}

export interface LocalParticipantLike extends ParticipantLike {
  setCameraEnabled(enabled: boolean, options?: unknown, publishOptions?: unknown): Promise<unknown>;
  setMicrophoneEnabled(enabled: boolean, options?: unknown, publishOptions?: unknown): Promise<unknown>;
  setScreenShareEnabled(enabled: boolean, options?: unknown, publishOptions?: unknown): Promise<unknown>;
  publishTrack(track: LocalTrackLike, options?: unknown): Promise<unknown>;
}

export interface RoomLike {
  state: string;
  localParticipant: LocalParticipantLike;
  remoteParticipants: Map<string, ParticipantLike>;
  canPlaybackAudio: boolean;
  on(event: string, fn: (...args: any[]) => void): unknown;
  off(event: string, fn: (...args: any[]) => void): unknown;
  connect(url: string, token: string, options?: unknown): Promise<void>;
  disconnect(stopTracks?: boolean): Promise<void>;
  startAudio(): Promise<void>;
  switchActiveDevice(kind: MediaDeviceKind, deviceId: string, exact?: boolean): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Snapshot rendered by the UI
// ---------------------------------------------------------------------------

export type MeetingPhase =
  | 'prejoin'       // preview and device choices; not connected
  | 'joining'       // asking the server for a token, then connecting to LiveKit
  | 'waiting'       // in the meeting's waiting room until the host lets you in
  | 'connected'
  | 'reconnecting'  // LiveKit lost the connection and is resuming it
  | 'leaving'
  | 'disconnected'; // the meeting ended or the connection was lost for good; capture is stopped

export interface DeviceOption { deviceId: string; label: string }

export interface DeviceState {
  kind: DeviceKind;
  permission: PermissionStatus;
  /** True only when a live capture track exists and (in a meeting) is published unmuted. */
  active: boolean;
  /** A toggle is in progress (prompt open, track starting or publishing). */
  pending: boolean;
  issue: DeviceIssue | null;
  /** The chosen device; null = the browser default. */
  deviceId: string | null;
  devices: DeviceOption[];
}

export interface ScreenState {
  supported: boolean;
  active: boolean;
  pending: boolean;
  issue: ScreenShareIssue | null;
}

export interface TrackRef {
  /** Stable while the same track is shown (LiveKit track sid, or a local id before publishing). */
  id: string;
  track: TrackLike;
  /** Source dimensions when LiveKit knows them (remote video), for aspect-correct presentation. */
  width?: number;
  height?: number;
}

export type Quality = 'excellent' | 'good' | 'poor' | 'lost' | 'unknown';

export interface ParticipantView {
  /** Stable React key: the LiveKit identity (the server's roster participant id). */
  key: string;
  name: string;
  isLocal: boolean;
  isSpeaking: boolean;
  quality: Quality;
  micPublished: boolean;
  micMuted: boolean;
  camera: TrackRef | null;
  screen: TrackRef | null;
  /** Remote microphone track, for playback. */
  audio: TrackRef | null;
  /** Arrival order in this session (local first), so tiles don't reshuffle when tracks change. */
  order: number;
}

export interface Notice { tone: 'info' | 'warning' | 'error'; text: string }

export interface MeetingSnapshot {
  phase: MeetingPhase;
  roomCode: string | null;
  /** A failure the user should act on (e.g. joining failed); cleared by the next action. */
  error: { code: string; message: string } | null;
  /** Transient status shown in a banner (reconnecting, someone stopped sharing, …). */
  notice: Notice | null;
  camera: DeviceState;
  microphone: DeviceState;
  screen: ScreenState;
  /** The local camera while previewing before joining. */
  preview: TrackRef | null;
  /** The local microphone track before joining (for the level meter / analysis). */
  previewAudio: TrackRef | null;
  participants: ParticipantView[];
  /** The browser blocked autoplay of remote audio; a click on "Start audio" fixes it. */
  audioBlocked: boolean;
}
