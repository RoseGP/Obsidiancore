/**
 * Browser side of meeting audio/video (LiveKit). The server decides who may connect (POST …/media-token);
 * this class connects with that token, publishes the local camera/microphone/screen, plays remote audio,
 * exposes remote video tracks, reports who is speaking, and carries meeting chat over the data channel.
 * Remote participants are identified by their roster id (the token identity), so the UI can match tiles.
 */
import { ConnectionQuality, ConnectionState, Room, RoomEvent, Track, type LocalTrackPublication, type Participant, type RemoteParticipant, type RemoteTrack } from 'livekit-client';

export type NetworkQuality = 'excellent' | 'good' | 'poor' | 'lost' | 'unknown';
const toQuality = (q: ConnectionQuality | undefined): NetworkQuality =>
  q === ConnectionQuality.Excellent ? 'excellent' : q === ConnectionQuality.Good ? 'good' : q === ConnectionQuality.Poor ? 'poor' : q === ConnectionQuality.Lost ? 'lost' : 'unknown';

export type MediaStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'not_configured' | 'failed' | 'disconnected';

export interface RemoteMedia {
  name: string;
  video: MediaStreamTrack | null;
  screen: MediaStreamTrack | null;
  micMuted: boolean;
  camOff: boolean;
  isSpeaking: boolean;
  /** LiveKit's estimate of this person's connection. */
  quality: NetworkQuality;
}

export interface ChatPacket { type: 'chat'; id: string; text: string; to?: string; senderName: string; sentAt: number }

interface Handlers {
  onRemote: (remote: Record<string, RemoteMedia>) => void;
  onStatus: (status: MediaStatus, message?: string) => void;
  onChat: (packet: ChatPacket, fromIdentity: string) => void;
  /** Your own connection quality (LiveKit ConnectionQualityChanged). */
  onLocalQuality?: (quality: NetworkQuality) => void;
}

export class MeetingMedia {
  private room: Room | null = null;
  private pubs: { audio?: LocalTrackPublication; video?: LocalTrackPublication; screen?: LocalTrackPublication } = {};
  private audioHost: HTMLDivElement | null = null;
  private audioEls = new Map<string, HTMLMediaElement>();

  constructor(private h: Handlers) {}

  get connected() { return this.room?.state === ConnectionState.Connected; }
  get identity() { return this.room?.localParticipant.identity ?? null; }

  async connect(url: string, token: string, local: MediaStream | null) {
    this.disconnect();
    const room = new Room({ adaptiveStream: true, dynacast: true });
    this.room = room;
    this.h.onStatus('connecting');
    room
      .on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub, p: RemoteParticipant) => {
        if (track.kind === Track.Kind.Audio) this.playAudio(`${p.identity}:${track.sid}`, track);
        this.emit();
      })
      .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack, _pub, p: RemoteParticipant) => {
        this.stopAudio(`${p.identity}:${track.sid}`, track);
        this.emit();
      })
      .on(RoomEvent.TrackMuted, () => this.emit())
      .on(RoomEvent.TrackUnmuted, () => this.emit())
      .on(RoomEvent.ParticipantConnected, () => this.emit())
      .on(RoomEvent.ParticipantDisconnected, () => this.emit())
      .on(RoomEvent.ActiveSpeakersChanged, () => this.emit())
      .on(RoomEvent.ConnectionQualityChanged, (q: ConnectionQuality, p: Participant) => {
        if (p.identity === room.localParticipant.identity) this.h.onLocalQuality?.(toQuality(q));
        else this.emit();
      })
      .on(RoomEvent.Reconnecting, () => this.h.onStatus('reconnecting', 'Reconnecting audio and video…'))
      .on(RoomEvent.Reconnected, () => this.h.onStatus('connected'))
      .on(RoomEvent.Disconnected, () => { this.h.onStatus('disconnected'); this.clearAudio(); })
      .on(RoomEvent.DataReceived, (payload: Uint8Array, p?: RemoteParticipant) => {
        try {
          const packet = JSON.parse(new TextDecoder().decode(payload)) as ChatPacket;
          if (packet?.type === 'chat' && typeof packet.text === 'string' && p) this.h.onChat(packet, p.identity);
        } catch { /* ignore malformed packets */ }
      });
    try {
      await room.connect(url, token);
    } catch (e) {
      this.room = null;
      this.h.onStatus('failed', `Couldn't connect audio and video: ${(e as Error).message || 'network error'}.`);
      return;
    }
    if (local) await this.publishLocal(local);
    this.h.onStatus('connected');
    this.emit();
  }

  private async publishLocal(stream: MediaStream) {
    const lp = this.room?.localParticipant;
    if (!lp) return;
    const [audio] = stream.getAudioTracks();
    const [video] = stream.getVideoTracks();
    try {
      if (audio) this.pubs.audio = await lp.publishTrack(audio, { source: Track.Source.Microphone });
      if (video) this.pubs.video = await lp.publishTrack(video, { source: Track.Source.Camera, simulcast: true });
      if (audio && !audio.enabled) await this.pubs.audio?.mute();
      if (video && !video.enabled) await this.pubs.video?.mute();
    } catch (e) {
      this.h.onStatus('connected', `Connected, but your camera or microphone couldn't be shared: ${(e as Error).message}.`);
    }
  }

  async setMicEnabled(on: boolean) { const p = this.pubs.audio; if (p) await (on ? p.unmute() : p.mute()); }
  async setCamEnabled(on: boolean) { const p = this.pubs.video; if (p) await (on ? p.unmute() : p.mute()); }

  async publishScreen(track: MediaStreamTrack) {
    const lp = this.room?.localParticipant;
    if (!lp) return;
    await this.unpublishScreen();
    this.pubs.screen = await lp.publishTrack(track, { source: Track.Source.ScreenShare });
  }
  async unpublishScreen() {
    const lp = this.room?.localParticipant, pub = this.pubs.screen;
    this.pubs.screen = undefined;
    if (lp && pub?.track) await lp.unpublishTrack(pub.track, false);
  }

  /** Meeting chat over LiveKit's reliable data channel; `to` = one participant's roster id for a private message. */
  async sendChat(packet: ChatPacket) {
    const lp = this.room?.localParticipant;
    if (!lp) return false;
    await lp.publishData(new TextEncoder().encode(JSON.stringify(packet)), { reliable: true, ...(packet.to ? { destinationIdentities: [packet.to] } : {}) });
    return true;
  }

  disconnect() {
    const room = this.room;
    this.room = null;
    this.pubs = {};
    this.clearAudio();
    if (room) room.disconnect().catch(() => {});
  }

  private emit() {
    const room = this.room;
    if (!room) return this.h.onRemote({});
    const speaking = new Set(room.activeSpeakers.map((p: Participant) => p.identity));
    const out: Record<string, RemoteMedia> = {};
    room.remoteParticipants.forEach((p) => {
      const cam = p.getTrackPublication(Track.Source.Camera);
      const mic = p.getTrackPublication(Track.Source.Microphone);
      const scr = p.getTrackPublication(Track.Source.ScreenShare);
      out[p.identity] = {
        name: p.name || p.identity,
        video: cam?.track && !cam.isMuted ? cam.track.mediaStreamTrack : null,
        screen: scr?.track ? scr.track.mediaStreamTrack : null,
        micMuted: !mic || mic.isMuted,
        camOff: !cam || cam.isMuted,
        isSpeaking: speaking.has(p.identity),
        quality: toQuality(p.connectionQuality),
      };
    });
    this.h.onRemote(out);
  }

  private playAudio(key: string, track: RemoteTrack) {
    if (typeof document === 'undefined') return;
    if (!this.audioHost) {
      this.audioHost = document.createElement('div');
      this.audioHost.hidden = true;
      this.audioHost.setAttribute('data-meeting-audio', '');
      document.body.appendChild(this.audioHost);
    }
    const el = track.attach();
    this.audioEls.set(key, el);
    this.audioHost.appendChild(el);
  }
  private stopAudio(key: string, track: RemoteTrack) {
    const el = this.audioEls.get(key);
    if (el) { track.detach(el); el.remove(); this.audioEls.delete(key); }
  }
  private clearAudio() {
    this.audioEls.forEach((el) => el.remove());
    this.audioEls.clear();
    this.audioHost?.remove();
    this.audioHost = null;
  }
}
