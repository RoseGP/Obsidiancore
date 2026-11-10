/**
 * Real audio/video through LiveKit. The meeting session (sessions.ts) stays the source of truth:
 *
 * - Tokens are issued only to people the roster has let in (status "in"), for that meeting's room only,
 *   and expire when the meeting's plan time limit does. Waiting, removed or denied people get no token.
 * - When a meeting ends (host, administrator or time limit), the LiveKit room is deleted, which
 *   disconnects everyone: the plan's time limit applies to the media too.
 * - When the host removes someone, they're removed from the LiveKit room as well.
 *
 * Environment: LIVEKIT_URL (wss://…), LIVEKIT_API_KEY, LIVEKIT_API_SECRET. Without them, the token endpoint
 * answers 503 media_not_configured and the app says video between people isn't connected.
 */
import { AccessToken, EgressClient, EncodedFileOutput, EncodedFileType, RoomServiceClient, S3Upload, TrackType } from 'livekit-server-sdk';

export interface MediaConfig { url: string; apiKey: string; apiSecret: string }

export function mediaConfig(): MediaConfig | null {
  const url = (process.env.LIVEKIT_URL || '').trim();
  const apiKey = (process.env.LIVEKIT_API_KEY || '').trim();
  const apiSecret = (process.env.LIVEKIT_API_SECRET || '').trim();
  return url && apiKey && apiSecret ? { url, apiKey, apiSecret } : null;
}

/** The parts of RoomServiceClient we use (tests inject a stand-in). */
export interface RoomService {
  deleteRoom(room: string): Promise<void>;
  removeParticipant(room: string, identity: string): Promise<void>;
  /** Optional in test stand-ins; the real RoomServiceClient has both. */
  getParticipant?(room: string, identity: string): Promise<{ tracks: Array<{ sid: string; type: number; muted?: boolean }> }>;
  mutePublishedTrack?(room: string, identity: string, trackSid: string, muted: boolean): Promise<unknown>;
}
let roomServiceOverride: RoomService | null = null;
export function setRoomServiceForTests(svc: RoomService | null) { roomServiceOverride = svc; }

const apiHost = (cfg: MediaConfig) => cfg.url.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
function roomService(cfg: MediaConfig): RoomService {
  if (roomServiceOverride) return roomServiceOverride;
  return new RoomServiceClient(apiHost(cfg), cfg.apiKey, cfg.apiSecret) as unknown as RoomService;
}

export async function createMediaToken(input: {
  room: string; identity: string; name: string; role: 'host' | 'cohost' | 'guest'; canManage: boolean; expiresAt: number;
}): Promise<{ url: string; token: string; expiresAt: number } | null> {
  const cfg = mediaConfig();
  if (!cfg) return null;
  // Valid until the meeting's time limit (at least a minute so a last-second join can connect).
  const ttlSeconds = Math.max(60, Math.ceil((input.expiresAt - Date.now()) / 1000));
  const at = new AccessToken(cfg.apiKey, cfg.apiSecret, {
    identity: input.identity, name: input.name, ttl: ttlSeconds,
    metadata: JSON.stringify({ role: input.role }),
  });
  at.addGrant({
    room: input.room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true,
    // Hosts, co-hosts and organization admins may mute or remove others through LiveKit as well.
    roomAdmin: input.canManage,
  });
  return { url: cfg.url, token: await at.toJwt(), expiresAt: Date.now() + ttlSeconds * 1000 };
}

/** Best effort: the session has already ended; a LiveKit outage must not undo that. */
export async function closeMediaRoom(room: string): Promise<void> {
  const cfg = mediaConfig();
  if (!cfg) return;
  try { await roomService(cfg).deleteRoom(room); }
  catch (e) {
    // A room that was never created (nobody connected) is fine.
    if (!/not.?found|404/i.test(String((e as Error)?.message))) console.warn('[meetings] could not close the media room:', (e as Error).message);
  }
}

export async function removeFromMediaRoom(room: string, identity: string): Promise<void> {
  const cfg = mediaConfig();
  if (!cfg) return;
  try { await roomService(cfg).removeParticipant(room, identity); }
  catch (e) {
    if (!/not.?found|404/i.test(String((e as Error)?.message))) console.warn('[meetings] could not remove a participant from media:', (e as Error).message);
  }
}

/**
 * Host control: mutes everything a participant publishes as audio, through LiveKit's server API (the client
 * can't un-mute itself back without unmuting locally, which LiveKit reports to everyone).
 * 'not_connected' = they have no audio in the media room right now.
 */
export async function muteInMediaRoom(room: string, identity: string): Promise<'muted' | 'not_connected' | 'not_configured'> {
  const cfg = mediaConfig();
  if (!cfg) return 'not_configured';
  const svc = roomService(cfg);
  if (!svc.getParticipant || !svc.mutePublishedTrack) return 'not_configured';
  let info: { tracks: Array<{ sid: string; type: number; muted?: boolean }> };
  try { info = await svc.getParticipant(room, identity); }
  catch (e) { if (/not.?found|404/i.test(String((e as Error)?.message))) return 'not_connected'; throw e; }
  const audio = (info.tracks || []).filter((t) => t.type === TrackType.AUDIO && !t.muted);
  for (const t of audio) await svc.mutePublishedTrack(room, identity, t.sid, true);
  return (info.tracks || []).some((t) => t.type === TrackType.AUDIO) ? 'muted' : 'not_connected';
}

// ---------------------------------------------------------------------------
// Cloud recording (LiveKit Egress → S3-compatible storage). Off unless fully configured.
// ---------------------------------------------------------------------------

export interface EgressConfig { bucket: string; region: string; accessKey: string; secret: string; endpoint: string; prefix: string }

/** LIVEKIT_EGRESS_ENABLED=true plus LIVEKIT_EGRESS_S3_{BUCKET,REGION,ACCESS_KEY,SECRET}[,ENDPOINT,PREFIX]. */
export function egressConfig(): EgressConfig | null {
  if (!mediaConfig() || (process.env.LIVEKIT_EGRESS_ENABLED || '').trim().toLowerCase() !== 'true') return null;
  const e = (k: string) => (process.env[`LIVEKIT_EGRESS_S3_${k}`] || '').trim();
  const c = { bucket: e('BUCKET'), region: e('REGION'), accessKey: e('ACCESS_KEY'), secret: e('SECRET'), endpoint: e('ENDPOINT'), prefix: e('PREFIX') || 'greet-recordings' };
  return c.bucket && c.region && c.accessKey && c.secret ? c : null;
}

export interface EgressService {
  start(room: string, filepath: string): Promise<{ egressId: string }>;
  stop(egressId: string): Promise<void>;
}
let egressOverride: EgressService | null = null;
export function setEgressServiceForTests(svc: EgressService | null) { egressOverride = svc; }

function egressService(): EgressService | null {
  if (egressOverride) return egressOverride;
  const cfg = mediaConfig(); const ec = egressConfig();
  if (!cfg || !ec) return null;
  const client = new EgressClient(apiHost(cfg), cfg.apiKey, cfg.apiSecret);
  return {
    async start(room, filepath) {
      const output = new EncodedFileOutput({
        fileType: EncodedFileType.MP4, filepath,
        output: { case: 's3', value: new S3Upload({ accessKey: ec.accessKey, secret: ec.secret, region: ec.region, bucket: ec.bucket, endpoint: ec.endpoint, forcePathStyle: !!ec.endpoint }) },
      });
      const info = await client.startRoomCompositeEgress(room, output, { layout: 'grid' });
      return { egressId: info.egressId };
    },
    async stop(egressId) { await client.stopEgress(egressId); },
  };
}

/** null = cloud recording isn't configured (the API answers 501 recording_not_configured). */
export const cloudRecordingAvailable = () => egressOverride !== null || egressConfig() !== null;
export async function startRoomRecording(room: string, filepath: string) {
  const svc = egressService();
  return svc ? svc.start(room, filepath) : null;
}
export async function stopRoomRecording(egressId: string) {
  const svc = egressService();
  if (!svc) return;
  try { await svc.stop(egressId); }
  catch (e) { if (!/not.?found|404|EGRESS_(COMPLETE|ENDING|FAILED|ABORTED)/i.test(String((e as Error)?.message))) throw e; }
}
