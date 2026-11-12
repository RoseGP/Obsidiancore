/**
 * Test doubles for the meeting room: a LiveKit-like Room / participants / tracks (only the surface the
 * controller uses, with the same event names and semantics as livekit-client 2.x), the server token client,
 * and the browser's permissions / mediaDevices.
 */
import { MeetingApiError, type JoinResult, type MeetingTokenClient } from '../api/meetingTokenClient';
import { MeetingRoomController, type ControllerDeps } from '../room/MeetingRoomController';
import type { LocalParticipantLike, LocalTrackLike, ParticipantLike, PublicationLike, RoomLike } from '../room/types';

export const domError = (name: string, message = '') => Object.assign(new Error(message || name), { name });

type Fn = (...a: any[]) => void;
class Emitter {
  private map = new Map<string, Set<Fn>>();
  on(e: string, f: Fn) { if (!this.map.has(e)) this.map.set(e, new Set()); this.map.get(e)!.add(f); return this; }
  off(e: string, f: Fn) { this.map.get(e)?.delete(f); return this; }
  emit(e: string, ...a: any[]) { [...(this.map.get(e) ?? [])].forEach((f) => f(...a)); }
  listenerCount() { let n = 0; this.map.forEach((s) => { n += s.size; }); return n; }
}

let trackSeq = 0;
export class FakeTrack extends Emitter implements LocalTrackLike {
  sid: string;
  isMuted = false;
  mediaStreamTrack: MediaStreamTrack;
  stopped = false;
  restarts: unknown[] = [];
  constructor(public kind: 'audio' | 'video', public source: string) {
    super();
    this.sid = `TR_${++trackSeq}`;
    this.mediaStreamTrack = { readyState: 'live', enabled: true, kind } as unknown as MediaStreamTrack;
  }
  attach(el?: HTMLMediaElement) { return el ?? ({} as HTMLMediaElement); }
  detach() { return [] as HTMLMediaElement[]; }
  stop() { this.stopped = true; (this.mediaStreamTrack as any).readyState = 'ended'; }
  async mute() { this.isMuted = true; return this; }
  async unmute() { this.isMuted = false; return this; }
  async restartTrack(options?: unknown) { this.restarts.push(options); }
  /** The device went away (unplugged, revoked). */
  end() { (this.mediaStreamTrack as any).readyState = 'ended'; this.emit('ended', this); }
}

export class FakePublication implements PublicationLike {
  trackSid: string; kind: string; isMuted = false;
  constructor(public source: string, public track?: FakeTrack, public dimensions?: { width: number; height: number }) {
    this.trackSid = track?.sid ?? `PUB_${++trackSeq}`;
    this.kind = track?.kind ?? (source === 'camera' || source === 'screen_share' ? 'video' : 'audio');
  }
}

export class FakeParticipant implements ParticipantLike {
  isSpeaking = false;
  connectionQuality = 'good';
  trackPublications = new Map<string, FakePublication>();
  constructor(public identity: string, public name?: string) {}
  getTrackPublication(source: string) { return [...this.trackPublications.values()].find((p) => p.source === source); }
  add(pub: FakePublication) { this.trackPublications.set(pub.trackSid, pub); return pub; }
  remove(source: string) { const p = this.getTrackPublication(source); if (p) this.trackPublications.delete(p.trackSid); return p; }
}

export class FakeLocalParticipant extends FakeParticipant implements LocalParticipantLike {
  calls: string[] = [];
  /** Next capture failure per source. */
  failNext: Partial<Record<'camera' | 'microphone' | 'screen_share', Error>> = {};
  published: Array<{ track: FakeTrack; options: any }> = [];
  constructor(private room: FakeRoom) { super('pt_local', 'Ada (you)'); }

  private async setEnabled(source: 'camera' | 'microphone', on: boolean) {
    this.calls.push(`${source}:${on}`);
    const err = this.failNext[source]; delete this.failNext[source];
    if (err) { this.room.emit('mediaDevicesError', err, source === 'camera' ? 'videoinput' : 'audioinput'); throw err; }
    let pub = this.getTrackPublication(source);
    if (on) {
      if (pub?.track) { await pub.track.unmute(); pub.isMuted = false; this.room.emit('trackUnmuted', pub, this); return pub; }
      pub = this.add(new FakePublication(source, new FakeTrack(source === 'camera' ? 'video' : 'audio', source)));
      this.room.emit('localTrackPublished', pub, this);
      return pub;
    }
    if (pub?.track) { await pub.track.mute(); pub.isMuted = true; this.room.emit('trackMuted', pub, this); }
    return pub;
  }
  setCameraEnabled(on: boolean) { return this.setEnabled('camera', on); }
  setMicrophoneEnabled(on: boolean) { return this.setEnabled('microphone', on); }
  async setScreenShareEnabled(on: boolean) {
    this.calls.push(`screen_share:${on}`);
    const err = this.failNext.screen_share; delete this.failNext.screen_share;
    if (err) throw err;
    if (on) { const pub = this.add(new FakePublication('screen_share', new FakeTrack('video', 'screen_share'))); this.room.emit('localTrackPublished', pub, this); return pub; }
    this.unpublishScreen();
    return undefined;
  }
  /** What LiveKit does on its own when the browser's "Stop sharing" ends the capture. */
  unpublishScreen() {
    const pub = this.remove('screen_share');
    if (pub) { pub.track?.stop(); this.room.emit('localTrackUnpublished', pub, this); }
  }
  async publishTrack(track: LocalTrackLike, options?: any) {
    const t = track as FakeTrack;
    this.published.push({ track: t, options });
    const pub = this.add(new FakePublication(options?.source ?? t.source, t));
    this.room.emit('localTrackPublished', pub, this);
    return pub;
  }
}

export class FakeRoom extends Emitter implements RoomLike {
  state = 'disconnected';
  localParticipant: FakeLocalParticipant;
  remoteParticipants = new Map<string, FakeParticipant>();
  canPlaybackAudio = true;
  connectError: Error | null = null;
  disconnects: boolean[] = [];
  connects: Array<{ url: string; token: string }> = [];
  switches: Array<[string, string]> = [];
  constructor() { super(); this.localParticipant = new FakeLocalParticipant(this); }
  async connect(url: string, token: string) {
    this.connects.push({ url, token });
    if (this.connectError) throw this.connectError;
    this.state = 'connected';
  }
  async disconnect(stopTracks = true) {
    this.disconnects.push(stopTracks);
    this.state = 'disconnected';
    if (stopTracks) this.localParticipant.trackPublications.forEach((p) => p.track?.stop());
    this.emit('disconnected', 1);
  }
  async startAudio() { this.canPlaybackAudio = true; this.emit('audioPlaybackChanged', true); }
  async switchActiveDevice(kind: MediaDeviceKind, id: string) { this.switches.push([kind, id]); this.emit('activeDeviceChanged', kind, id); return true; }

  addRemote(identity: string, name: string) {
    const p = new FakeParticipant(identity, name);
    this.remoteParticipants.set(identity, p);
    this.emit('participantConnected', p);
    return p;
  }
  removeRemote(identity: string) {
    const p = this.remoteParticipants.get(identity);
    this.remoteParticipants.delete(identity);
    this.emit('participantDisconnected', p);
  }
  publishRemote(p: FakeParticipant, source: string, dims?: { width: number; height: number }) {
    const pub = p.add(new FakePublication(source, new FakeTrack(source === 'microphone' ? 'audio' : 'video', source), dims));
    this.emit('trackSubscribed', pub.track, pub, p);
    return pub;
  }
}

export class FakeTokenClient implements MeetingTokenClient {
  results: Array<JoinResult | Error> = [];
  joins: string[] = [];
  leaves: string[] = [];
  async join(code: string) {
    this.joins.push(code);
    const r = this.results.length > 1 ? this.results.shift()! : this.results[0];
    if (!r) throw new MeetingApiError('No meeting is running with that code.', 404, 'meeting_not_found');
    if (r instanceof Error) throw r;
    return r;
  }
  async leave(code: string) { this.leaves.push(code); }
}

export const TOKEN: JoinResult = { kind: 'token', url: 'wss://livekit.example.test', token: 'jwt-for-tests', expiresAt: Date.now() + 3600_000, participantId: 'pt_local' };

export function fakeEnv(opts: { secure?: boolean; permission?: Record<string, string>; devices?: Array<{ kind: string; deviceId: string; label?: string }>; displayMedia?: boolean } = {}) {
  const permStatus: Record<string, any> = {};
  const perms = opts.permission ?? { camera: 'prompt', microphone: 'prompt' };
  const mdListeners = new Set<Fn>();
  let devices = opts.devices ?? [{ kind: 'videoinput', deviceId: 'cam-1', label: '' }, { kind: 'audioinput', deviceId: 'mic-1', label: '' }];
  const env = {
    isSecureContext: opts.secure ?? true,
    document: { permissionsPolicy: { allowsFeature: () => true } } as any,
    navigator: {
      permissions: {
        async query({ name }: { name: string }) {
          if (!permStatus[name]) {
            const listeners = new Set<Fn>();
            permStatus[name] = {
              state: perms[name] ?? 'prompt', onchange: null,
              addEventListener: (_: string, f: Fn) => listeners.add(f), removeEventListener: (_: string, f: Fn) => listeners.delete(f),
              listeners, set(s: string) { this.state = s; listeners.forEach((f) => f()); },
            };
          }
          return permStatus[name];
        },
      },
      mediaDevices: {
        getUserMedia: async () => { throw new Error('not used: the controller captures through LiveKit'); },
        ...(opts.displayMedia === false ? {} : { getDisplayMedia: async () => { throw new Error('not used'); } }),
        enumerateDevices: async () => devices.map((d) => ({ ...d, label: d.label ?? '', groupId: '', toJSON() { return this; } })),
        addEventListener: (_: string, f: Fn) => mdListeners.add(f),
        removeEventListener: (_: string, f: Fn) => mdListeners.delete(f),
      },
    } as any,
  };
  return {
    env,
    setPermission: (name: string, state: string) => permStatus[name]?.set(state),
    permissionListeners: (name: string) => permStatus[name]?.listeners.size ?? 0,
    deviceChangeListeners: () => mdListeners.size,
    setDevices: (d: typeof devices) => { devices = d; mdListeners.forEach((f) => f()); },
  };
}

export function setup(opts: { env?: ReturnType<typeof fakeEnv>; videoError?: Error[]; audioError?: Error[] } = {}) {
  const env = opts.env ?? fakeEnv();
  const tokens = new FakeTokenClient();
  tokens.results = [TOKEN];
  const rooms: FakeRoom[] = [];
  const created = { video: [] as FakeTrack[], audio: [] as FakeTrack[] };
  const videoErrors = [...(opts.videoError ?? [])];
  const audioErrors = [...(opts.audioError ?? [])];
  let nextConnectError: Error | null = null;
  const deps: ControllerDeps = {
    tokenClient: tokens,
    createRoom: () => { const r = new FakeRoom(); r.connectError = nextConnectError; nextConnectError = null; rooms.push(r); return r; },
    createLocalVideoTrack: async () => { const e = videoErrors.shift(); if (e) throw e; const t = new FakeTrack('video', 'camera'); created.video.push(t); return t; },
    createLocalAudioTrack: async () => { const e = audioErrors.shift(); if (e) throw e; const t = new FakeTrack('audio', 'microphone'); created.audio.push(t); return t; },
    env: env.env,
    waitingPollMs: 5,
  };
  const c = new MeetingRoomController(deps);
  return { c, env, tokens, rooms, created, room: () => rooms[rooms.length - 1], deps, videoErrors, audioErrors,
    failNextConnect: (e: Error) => { nextConnectError = e; } };
}

export const flush = () => new Promise((r) => setTimeout(r, 15));
