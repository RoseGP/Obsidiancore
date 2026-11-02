/**
 * Video meeting session policy — pure functions, no React, so the rules are
 * testable and shared by the session context, the workspace UI and tests.
 *
 * Group meetings: up to 100 people (host included) with a hard 60-minute
 * session window. Each session snapshots its limits when it starts, so
 * changing the plan mid-call never extends a running meeting, and a room keeps
 * its original start time when it is restarted or rejoined (the timer cannot
 * be reset by leaving and coming back).
 */

export const GROUP_MEETING_MAX_PARTICIPANTS = 100;
export const MEETING_MAX_DURATION_MINUTES = 60;
/** The warning banner shows this many minutes before the limit. */
export const DURATION_WARNING_LEAD_MINUTES = 5;
/** Tiles per page in the video grid (5 × 5). */
export const GRID_PAGE_SIZE = 25;

export interface SessionLimits {
  /** Total people in the room, host included. */
  maxParticipants: number;
  /** 0 = unlimited. */
  maxDurationMinutes: number;
}

export const GROUP_MEETING_LIMITS: SessionLimits = {
  maxParticipants: GROUP_MEETING_MAX_PARTICIPANTS,
  maxDurationMinutes: MEETING_MAX_DURATION_MINUTES,
};

// ---------- Capacity ----------

/** Remote participants plus the local user. */
export const headcount = (remoteCount: number) => remoteCount + 1;

export function remainingSeats(limits: SessionLimits, remoteCount: number): number {
  return Math.max(0, limits.maxParticipants - headcount(remoteCount));
}

export const isRoomFull = (limits: SessionLimits, remoteCount: number) => remainingSeats(limits, remoteCount) === 0;

/** More than two people (host + 2 or more). */
export const isGroupMeeting = (remoteCount: number) => headcount(remoteCount) > 2;

export interface AdmitResult<T> {
  roster: T[];
  admitted: T[];
  /** Turned away because the room is full. */
  rejected: T[];
  /** Already in the room (same id or email). */
  duplicates: T[];
}

/**
 * Adds people to the roster in order until the room is full. Never lets the
 * roster exceed `maxParticipants - 1` remote participants.
 */
export function admitParticipants<T extends { id: string; email?: string }>(
  roster: T[],
  incoming: T[],
  limits: SessionLimits,
): AdmitResult<T> {
  const ids = new Set(roster.map((p) => p.id));
  const emails = new Set(roster.map((p) => (p.email || '').toLowerCase()).filter(Boolean));
  const next = [...roster];
  const admitted: T[] = [];
  const rejected: T[] = [];
  const duplicates: T[] = [];
  for (const p of incoming) {
    const email = (p.email || '').toLowerCase();
    if (ids.has(p.id) || (email && emails.has(email))) { duplicates.push(p); continue; }
    if (remainingSeats(limits, next.length) === 0) { rejected.push(p); continue; }
    next.push(p);
    admitted.push(p);
    ids.add(p.id);
    if (email) emails.add(email);
  }
  return { roster: next, admitted, rejected, duplicates };
}

const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

/** Splits a comma/semicolon/whitespace-separated list, lower-cases and de-dupes. */
export function parseInviteEmails(input: string): { valid: string[]; invalid: string[] } {
  const seen = new Set<string>();
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const raw of input.split(/[\s,;]+/)) {
    const e = raw.trim().toLowerCase();
    if (!e || seen.has(e)) continue;
    seen.add(e);
    (EMAIL_RE.test(e) ? valid : invalid).push(e);
  }
  return { valid, invalid };
}

// ---------- Duration ----------

export interface SessionTimeState {
  elapsedSeconds: number;
  /** null when unlimited. */
  remainingSeconds: number | null;
  /** Epoch ms when the session must end; null when unlimited. */
  expiresAt: number | null;
  isWarning: boolean;
  isLimitReached: boolean;
}

export function getSessionTimeState(startedAt: number, now: number, maxDurationMinutes: number): SessionTimeState {
  const elapsedSeconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  if (!maxDurationMinutes || maxDurationMinutes <= 0) {
    return { elapsedSeconds, remainingSeconds: null, expiresAt: null, isWarning: false, isLimitReached: false };
  }
  const limitSeconds = maxDurationMinutes * 60;
  const remainingSeconds = Math.max(0, limitSeconds - elapsedSeconds);
  const warnAt = Math.max(0, limitSeconds - DURATION_WARNING_LEAD_MINUTES * 60);
  return {
    elapsedSeconds: Math.min(elapsedSeconds, limitSeconds),
    remainingSeconds,
    expiresAt: startedAt + limitSeconds * 1000,
    isWarning: elapsedSeconds >= warnAt && remainingSeconds > 0,
    isLimitReached: remainingSeconds === 0,
  };
}

// ---------- Room registry (session window per room) ----------

export interface RoomSessionRecord extends SessionLimits {
  roomId: string;
  startedAt: number;
  /** Set once the room's window is over. */
  endedAt?: number;
  endReason?: 'duration_limit' | 'host_ended';
}

export type RoomRegistry = Record<string, RoomSessionRecord>;

export type OpenRoomResult =
  | { ok: true; record: RoomSessionRecord; registry: RoomRegistry; resumed: boolean }
  | { ok: false; reason: 'duration_limit'; message: string; registry: RoomRegistry };

/**
 * Opens (or resumes) a room's session. A room keeps its first start time and
 * limits; once its window has passed it cannot be reopened, so rejoining never
 * restarts the 60-minute clock. Records older than a day are pruned.
 */
export function openRoomSession(registry: RoomRegistry, roomId: string, limits: SessionLimits, now: number): OpenRoomResult {
  const pruned: RoomRegistry = {};
  for (const [id, r] of Object.entries(registry)) {
    if (now - r.startedAt < 24 * 60 * 60 * 1000) pruned[id] = r;
  }
  const existing = pruned[roomId];
  if (existing) {
    const t = getSessionTimeState(existing.startedAt, now, existing.maxDurationMinutes);
    if (existing.endReason === 'duration_limit' || t.isLimitReached) {
      const ended = { ...existing, endedAt: existing.endedAt ?? t.expiresAt ?? now, endReason: 'duration_limit' as const };
      return {
        ok: false,
        reason: 'duration_limit',
        message: `This meeting reached its ${existing.maxDurationMinutes}-minute limit and can’t be reopened. Start a new meeting to continue.`,
        registry: { ...pruned, [roomId]: ended },
      };
    }
    if (!existing.endedAt) return { ok: true, record: existing, registry: pruned, resumed: true };
  }
  const record: RoomSessionRecord = { roomId, startedAt: now, ...limits };
  return { ok: true, record, registry: { ...pruned, [roomId]: record }, resumed: false };
}

export function closeRoomSession(registry: RoomRegistry, roomId: string, reason: RoomSessionRecord['endReason'], now: number): RoomRegistry {
  const r = registry[roomId];
  if (!r) return registry;
  return { ...registry, [roomId]: { ...r, endedAt: now, endReason: reason } };
}

// ---------- Grid layout ----------

/** Column count that keeps tiles roughly square for up to 100 people. */
export function gridColumns(tileCount: number): number {
  if (tileCount <= 1) return 1;
  if (tileCount <= 4) return 2;
  if (tileCount <= 9) return 3;
  if (tileCount <= 16) return 4;
  return 5;
}

export interface GridPage {
  pageCount: number;
  page: number;
  /** Slice of the remote participant list to render on this page. */
  start: number;
  end: number;
  /** The local tile is pinned to the first page. */
  includeLocal: boolean;
  tileCount: number;
}

export function gridPage(remoteCount: number, requestedPage: number, pageSize = GRID_PAGE_SIZE): GridPage {
  const total = headcount(remoteCount);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(0, requestedPage), pageCount - 1);
  // Page 0 holds the local tile + (pageSize - 1) remotes.
  const start = page === 0 ? 0 : pageSize - 1 + (page - 1) * pageSize;
  const end = Math.min(remoteCount, page === 0 ? pageSize - 1 : start + pageSize);
  return { pageCount, page, start, end, includeLocal: page === 0, tileCount: end - start + (page === 0 ? 1 : 0) };
}
