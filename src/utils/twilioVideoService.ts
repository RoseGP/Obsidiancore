import Video, { Room, Participant, RemoteParticipant, RemoteTrackPublication, RemoteVideoTrack, RemoteAudioTrack } from 'twilio-video';

/**
 * Senior WebRTC Technical Lead: Highly modular, vanilla-style front-end helper interface for Twilio Programmable Video Room sessions.
 * Implements camera permission requests, local media binding, server handshakes, and dynamic remote feed attachments.
 */

export interface VideoSessionCallbacks {
  onConnected?: (room: Room) => void;
  onDisconnected?: (room: Room) => void;
  onParticipantConnected?: (participant: Participant) => void;
  onParticipantDisconnected?: (participant: Participant) => void;
  onMediaError?: (error: Error) => void;
}

export class TwilioVideoSession {
  private activeRoom: Room | null = null;
  private localVideoElement: HTMLVideoElement | null = null;
  private remoteVideoElement: HTMLVideoElement | null = null;
  private localAudioElement: HTMLAudioElement | null = null;
  private callbacks: VideoSessionCallbacks = {};

  constructor(
    localVideo: HTMLVideoElement,
    remoteVideo: HTMLVideoElement,
    localAudio?: HTMLAudioElement,
    callbacks?: VideoSessionCallbacks
  ) {
    this.localVideoElement = localVideo;
    this.remoteVideoElement = remoteVideo;
    if (localAudio) this.localAudioElement = localAudio;
    if (callbacks) this.callbacks = callbacks;
  }

  /**
   * Requests camera & mic permissions and joins a secure Twilio Video Room
   */
  public async joinSecureRoom(token: string, roomName: string): Promise<Room> {
    try {
      console.log(`[Twilio Video Frontend] Attempting WebRTC initialization with Room: "${roomName}"`);

      // Verify DOM mounts are fully active
      if (!this.localVideoElement || !this.remoteVideoElement) {
        throw new Error('Target HTML Video elements must be fully bound before joining a video consultation.');
      }

      // Check browser physical media device lists to guarantee availability
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Your browser environment does not support or grant standard MediaDevices / WebRTC interfaces.');
      }

      // Perform real Twilio Video SDK handshakes
      const room = await Video.connect(token, {
        name: roomName,
        audio: true,
        video: { width: 640, height: 480, frameRate: 24 },
        dominantSpeaker: true,
        networkQuality: { local: 1, remote: 1 }
      });

      this.activeRoom = room;
      console.log(`[Twilio Video Frontend] Handshake succeeded. Joined room ID: ${room.sid}. Session active.`);

      // Render local preview tracks inside our DOM video element
      this.attachLocalTracks(room);

      // Inspect any participants already active in this consultation session
      room.participants.forEach((participant) => {
        console.log(`[Twilio Video Frontend] Existing peer detected: "${participant.identity}"`);
        this.handleParticipantConnected(participant);
      });

      // Pin handlers for future remote joins & network occurrences
      room.on('participantConnected', (participant) => {
        console.log(`[Twilio Video Frontend] Remote peer connected: "${participant.identity}"`);
        this.handleParticipantConnected(participant);
        if (this.callbacks.onParticipantConnected) this.callbacks.onParticipantConnected(participant);
      });

      room.on('participantDisconnected', (participant) => {
        console.log(`[Twilio Video Frontend] Remote peer disconnected: "${participant.identity}"`);
        this.handleParticipantDisconnected(participant);
        if (this.callbacks.onParticipantDisconnected) this.callbacks.onParticipantDisconnected(participant);
      });

      room.on('disconnected', (disconnectedRoom) => {
        console.log('[Twilio Video Frontend] Room connection closed.');
        this.cleanupSession();
        if (this.callbacks.onDisconnected) this.callbacks.onDisconnected(disconnectedRoom);
      });

      if (this.callbacks.onConnected) this.callbacks.onConnected(room);
      return room;

    } catch (err: any) {
      console.error('[Twilio Video Frontend] WebRTC Initiation failed:', err.message);
      if (this.callbacks.onMediaError) this.callbacks.onMediaError(err);
      throw err;
    }
  }

  /**
   * Suspends and tears down all active streams, freeing resources
   */
  public disconnect(): void {
    if (this.activeRoom) {
      console.log('[Twilio Video Frontend] Programmatic teardown requested. Gracefully closing active room.');
      this.activeRoom.disconnect();
      this.activeRoom = null;
    }
    this.cleanupSession();
  }

  /**
   * Render local camera track onto our local PIP video feed element
   */
  private attachLocalTracks(room: Room): void {
    if (!this.localVideoElement) return;

    room.localParticipant.videoTracks.forEach((pub) => {
      if (pub.track) {
        console.log('[Twilio Video Frontend] Attaching local video preview DOM track.');
        pub.track.attach(this.localVideoElement!);
      }
    });
  }

  /**
   * Attaches subscription events for a newly joined participant or peer
   */
  private handleParticipantConnected(participant: Participant): void {
    // Process already published tracks immediately
    participant.tracks.forEach((publication: any) => {
      this.handleTrackPublication(publication as any, participant);
    });

    // Handle incoming dynamic publisher updates
    participant.on('trackSubscribed', (track) => {
      console.log(`[Twilio Video Frontend] WebRTC track subscription confirmed: "${track.kind}"`);
      this.attachRemoteTrack(track);
    });

    participant.on('trackUnsubscribed', (track) => {
      console.log(`[Twilio Video Frontend] WebRTC track unsubscribed: "${track.kind}"`);
      track.detach().forEach((el: any) => el.remove());
    });
  }

  /**
   * Dismounts remote views when a participant leaves
   */
  private handleParticipantDisconnected(participant: Participant): void {
    console.log(`[Twilio Video Frontend] Peer "${participant.identity}" disconnected. Detaching associated streams.`);
    participant.tracks.forEach((pub: any) => {
      if (pub.track) {
        pub.track.detach().forEach((el: any) => el.remove());
      }
    });

    if (this.remoteVideoElement) {
      this.remoteVideoElement.srcObject = null;
    }
  }

  /**
   * Checks for track publication states and binds active tracks
   */
  private handleTrackPublication(publication: RemoteTrackPublication, participant: Participant): void {
    if (publication.isSubscribed && publication.track) {
      this.attachRemoteTrack(publication.track);
    }

    publication.on('subscribed', (track) => {
      console.log(`[Twilio Video Frontend] Peer published track subscribed: "${track.kind}" from ${participant.identity}`);
      this.attachRemoteTrack(track);
    });
  }

  /**
   * Attaches low-level audio & video tracks to DOM containers
   */
  private attachRemoteTrack(track: any): void {
    if (!this.remoteVideoElement) return;

    if (track.kind === 'video') {
      console.log('[Twilio Video Frontend] Binding active remote video stream into primary container.');
      track.attach(this.remoteVideoElement);
    } else if (track.kind === 'audio') {
      console.log('[Twilio Video Frontend] Attaching remote audio stream context.');
      if (this.localAudioElement) {
        track.attach(this.localAudioElement);
      } else {
        const audioEl = track.attach();
        document.body.appendChild(audioEl);
      }
    }
  }

  /**
   * Local teardown to ensure webcams aren't left locked / active on close
   */
  private cleanupSession(): void {
    if (this.localVideoElement) {
      this.localVideoElement.srcObject = null;
    }
    if (this.remoteVideoElement) {
      this.remoteVideoElement.srcObject = null;
    }
    console.log('[Twilio Video Frontend] Local streams detached. Webcam indicator light released.');
  }
}
