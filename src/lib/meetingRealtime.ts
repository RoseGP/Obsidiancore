/**
 * Real-time meeting events (raise hand, reactions, polls, whiteboard).
 *
 * Transport: the app's Socket.io signaling server (`meeting:event`, relayed to
 * the sender's room after `join-room`) for other devices, plus a
 * BroadcastChannel for other tabs in the same browser. Events carry an id and
 * are de-duplicated, so receiving one over both paths is harmless.
 *
 * Audio/video stays on WebRTC (peer connections signalled through the same
 * server); this channel only carries small UI events.
 */
import { io, type Socket } from 'socket.io-client';
import { getApiAuthHeaders } from './apiAuth';

export type MeetingEvent =
  | { type: 'hand'; raised: boolean; name: string }
  | { type: 'reaction'; emoji: string; name: string }
  | { type: 'whiteboard:stroke'; stroke: WhiteboardStroke }
  | { type: 'whiteboard:clear' }
  | { type: 'poll:create'; poll: MeetingPoll }
  | { type: 'poll:vote'; pollId: string; optionIndex: number; voterId: string }
  | { type: 'poll:close'; pollId: string };

export interface WhiteboardStroke {
  id: string;
  color: string;
  size: number;
  /** 'pen' draws; 'eraser' clears along the path. */
  tool: 'pen' | 'eraser';
  /** Points normalised to 0..1 so they map onto any canvas size. */
  points: [number, number][];
}

export interface MeetingPoll {
  id: string;
  question: string;
  options: string[];
  createdBy: string;
  createdAt: number;
  closed?: boolean;
}

export type Envelope = MeetingEvent & { id: string; senderId: string; at: number };

export const MEETING_EVENT_TYPES = ['hand', 'reaction', 'whiteboard:stroke', 'whiteboard:clear', 'poll:create', 'poll:vote', 'poll:close'] as const;
export const MAX_EVENT_BYTES = 16_000;

export function isMeetingEnvelope(v: unknown): v is Envelope {
  if (!v || typeof v !== 'object') return false;
  const e = v as Record<string, unknown>;
  return typeof e.id === 'string' && typeof e.senderId === 'string' && typeof e.type === 'string'
    && (MEETING_EVENT_TYPES as readonly string[]).includes(e.type);
}

export type ConnectionState = 'connecting' | 'connected' | 'local-only' | 'reconnecting';

export interface MeetingChannel {
  readonly selfId: string;
  send(event: MeetingEvent): void;
  subscribe(fn: (e: Envelope) => void): () => void;
  onState(fn: (s: ConnectionState) => void): () => void;
  close(): void;
}

const uid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

export function createMeetingChannel(roomId: string, opts: { selfId?: string; useSocket?: boolean } = {}): MeetingChannel {
  const selfId = opts.selfId ?? uid();
  const listeners = new Set<(e: Envelope) => void>();
  const stateListeners = new Set<(s: ConnectionState) => void>();
  const seen = new Set<string>();
  let state: ConnectionState = 'connecting';
  const setState = (s: ConnectionState) => { state = s; stateListeners.forEach((f) => f(s)); };

  const deliver = (e: unknown) => {
    if (!isMeetingEnvelope(e) || e.senderId === selfId || seen.has(e.id)) return;
    seen.add(e.id);
    if (seen.size > 2000) seen.clear();
    listeners.forEach((f) => f(e));
  };

  let bc: BroadcastChannel | null = null;
  try {
    bc = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(`meeting:${roomId}`) : null;
    if (bc) bc.onmessage = (m) => deliver(m.data);
  } catch { bc = null; }

  let socket: Socket | null = null;
  if (opts.useSocket !== false && typeof window !== 'undefined') {
    try {
      socket = io(window.location.origin, {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 8000,
        auth: (cb: (d: Record<string, unknown>) => void) => {
          getApiAuthHeaders().then((h) => cb({
            token: h.Authorization ? h.Authorization.slice(7) : undefined,
            devUserId: h['X-Dev-User-Id'],
          })).catch(() => cb({}));
        },
      });
      socket.on('connect', () => { socket?.emit('join-room', { roomId, userId: selfId }); setState('connected'); });
      socket.on('disconnect', () => setState('reconnecting'));
      socket.on('connect_error', () => setState(bc ? 'local-only' : 'reconnecting'));
      socket.on('meeting:event', deliver);
    } catch { socket = null; }
  }
  if (!socket) setState(bc ? 'local-only' : 'reconnecting');

  return {
    selfId,
    send(event) {
      const env: Envelope = { ...event, id: uid(), senderId: selfId, at: Date.now() } as Envelope;
      if (JSON.stringify(env).length > MAX_EVENT_BYTES) return;
      seen.add(env.id);
      try { bc?.postMessage(env); } catch { /* channel closed */ }
      if (socket?.connected) socket.emit('meeting:event', env);
    },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    onState(fn) { stateListeners.add(fn); fn(state); return () => stateListeners.delete(fn); },
    close() {
      listeners.clear(); stateListeners.clear();
      try { bc?.close(); } catch { /* ignore */ }
      if (socket) { try { socket.emit('leave-room', { roomId }); } catch { /* ignore */ } socket.disconnect(); }
    },
  };
}

// ---------- Poll tallying (pure) ----------

export function tallyPoll(poll: MeetingPoll, votes: Record<string, number>): { counts: number[]; total: number } {
  const counts = poll.options.map(() => 0);
  for (const idx of Object.values(votes)) if (idx >= 0 && idx < counts.length) counts[idx]++;
  return { counts, total: counts.reduce((a, b) => a + b, 0) };
}
