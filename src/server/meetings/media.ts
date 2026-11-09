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
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';

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
}
let roomServiceOverride: RoomService | null = null;
export function setRoomServiceForTests(svc: RoomService | null) { roomServiceOverride = svc; }

function roomService(cfg: MediaConfig): RoomService {
  if (roomServiceOverride) return roomServiceOverride;
  const host = cfg.url.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
  return new RoomServiceClient(host, cfg.apiKey, cfg.apiSecret);
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
