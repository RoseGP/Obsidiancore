/**
 * Meeting sessions: the server is the source of truth for every meeting's plan limits, clock and roster.
 *
 *   organizations/{orgId}/meeting_sessions/{id}   the session (limits snapshot, roster, status)
 *   meeting_rooms/{roomCode}                       room code → session (join links)
 *   meeting_active/{id}                            index of running meetings (sweeper, admin monitor)
 *   meeting_usage/{id}                             one row per ended meeting (analytics, statistics)
 *
 * Rules
 * - A meeting takes the ORGANIZER's plan (the host's organization) when it starts.
 * - Upgrades apply to running meetings immediately (limits and features only ever go up mid-meeting);
 *   downgrades and lower admin-configured limits apply to the next meeting, so nobody is cut off.
 * - Capacity, waiting room, lock, co-hosts and recording are checked here; the UI mirrors them.
 * - A meeting ends at its time limit even if nobody is connected: every read settles expiry, and the
 *   sweeper (startMeetingSweeper) closes expired meetings in the background.
 */
import { getDocStore, newId, assertId, type TxContext } from '../data/docStore';
import { type Role } from '../tenancy/orgs';
import { resolveOrgPlan, type ResolvedPlan } from './plans';
import {
  capacityStatus, durationStatus, planForNeeds, raiseFeatures, raiseLimits, roomCapacity, tierRank,
  type MeetingPlanTier, type PlanFeatures, type PlanLimits,
} from '../../lib/meetingPlans';
import { getPlanConfigs } from './plans';
import { closeMediaRoom, createMediaToken, removeFromMediaRoom } from './media';

export class MeetingError extends Error {
  constructor(public status: number, public code: string, message: string, public extra?: Record<string, unknown>) { super(message); }
}

export type ParticipantStatus = 'in' | 'waiting' | 'left' | 'removed' | 'denied';
export interface SessionParticipant {
  id: string;
  name: string;
  email: string;
  userId: string | null;
  role: 'host' | 'cohost' | 'guest';
  status: ParticipantStatus;
  invitedAt: number;
  joinedAt: number | null;
  leftAt: number | null;
  /** Seconds in the meeting across rejoins (attendance reports). */
  secondsIn: number;
}

export interface Session {
  id: string;
  orgId: string;
  roomCode: string;
  title: string;
  hostUserId: string;
  hostName: string;
  tier: MeetingPlanTier;
  planLabel: string;
  limits: PlanLimits;
  features: PlanFeatures;
  warnMinutesBefore: number;
  capacityWarnPercent: number;
  startedAt: number;
  endsAt: number;
  status: 'active' | 'ended';
  endedAt: number | null;
  endedReason: 'host' | 'time_limit' | 'admin' | null;
  waitingRoomEnabled: boolean;
  locked: boolean;
  recording: { active: boolean; startedAt: number | null; by: string | null; used: boolean };
  participants: SessionParticipant[];
  peakParticipants: number;
  scheduledMeetingId: string | null;
}

export interface Actor { userId: string; orgId: string; role: Role; name: string; email: string }

export const sessionPath = (orgId: string, id: string) => `organizations/${orgId}/meeting_sessions/${id}`;
const roomPath = (code: string) => `meeting_rooms/${code}`;
const activePath = (id: string) => `meeting_active/${id}`;
const usagePath = (id: string) => `meeting_usage/${id}`;

const ROOM_RE = /^[a-z0-9][a-z0-9-]{2,62}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const inCount = (s: Session) => s.participants.filter((p) => p.status === 'in').length;
export const waitingCount = (s: Session) => s.participants.filter((p) => p.status === 'waiting').length;
const isOrgAdmin = (a: Actor) => a.role === 'OWNER' || a.role === 'ADMIN';

export function canManage(s: Session, a: Actor): boolean {
  if (a.orgId !== s.orgId) return false;
  if (a.userId === s.hostUserId || isOrgAdmin(a)) return true;
  return s.participants.some((p) => p.userId === a.userId && p.role === 'cohost' && p.status === 'in');
}

function requireManager(s: Session, a: Actor) {
  if (!canManage(s, a)) throw new MeetingError(403, 'not_host', 'Only the host, a co-host or an organization admin can do this.');
}

async function upgradeHint(feature?: keyof PlanFeatures, needs?: { participants?: number; minutes?: number }) {
  const configs = await getPlanConfigs();
  const tier = planForNeeds(configs, { ...needs, feature });
  return tier ? { upgradeTo: tier, upgradeLabel: configs[tier].label } : {};
}

async function requireFeature(s: Session, feature: keyof PlanFeatures) {
  if (!s.features[feature]) {
    const hint = await upgradeHint(feature);
    throw new MeetingError(403, 'feature_not_in_plan', `${featureName(feature)} isn't included in the ${s.planLabel} plan.`, { feature, ...hint });
  }
}
const featureName = (f: keyof PlanFeatures) => ({
  recording: 'Recording', waitingRoom: 'The waiting room', hostControls: 'Advanced host controls', securityControls: 'Meeting lock',
  coHosts: 'Co-hosts', analytics: 'Analytics', attendanceReports: 'Attendance reports', customBranding: 'Custom branding',
  adminDashboard: 'The organization dashboard', prioritySupport: 'Priority support',
}[f]);

// ---------------------------------------------------------------------------
// Settling: plan changes and time limit
// ---------------------------------------------------------------------------

/** Raise a running meeting to the organizer's current plan (never lowers it). Returns true if anything changed. */
function applyPlan(s: Session, plan: ResolvedPlan): boolean {
  if (s.status !== 'active') return false;
  const limits = raiseLimits(s.limits, plan.limits);
  const features = raiseFeatures(s.features, plan.features);
  const changed = limits.maxParticipants !== s.limits.maxParticipants || limits.maxDurationMinutes !== s.limits.maxDurationMinutes
    || JSON.stringify(features) !== JSON.stringify(s.features) || (tierRank(plan.tier) > tierRank(s.tier));
  if (!changed) return false;
  s.limits = limits;
  s.features = features;
  if (tierRank(plan.tier) > tierRank(s.tier)) { s.tier = plan.tier; s.planLabel = plan.label; }
  s.endsAt = s.startedAt + limits.maxDurationMinutes * 60_000;
  return true;
}

function closeParticipants(s: Session, at: number) {
  for (const p of s.participants) {
    if (p.status === 'in') { p.secondsIn += Math.max(0, Math.round((at - (p.joinedAt ?? at)) / 1000)); p.status = 'left'; p.leftAt = at; }
    if (p.status === 'waiting') p.status = 'left';
  }
}

function endSession(s: Session, at: number, reason: Session['endedReason']) {
  closeParticipants(s, at);
  s.status = 'ended'; s.endedAt = at; s.endedReason = reason;
  if (s.recording.active) s.recording = { ...s.recording, active: false };
}

/** Ends the meeting if its time is up. */
function settleExpiry(s: Session, now: number): boolean {
  if (s.status === 'active' && now >= s.endsAt) { endSession(s, s.endsAt, 'time_limit'); return true; }
  return false;
}

function writeSession(tx: TxContext, s: Session) {
  tx.set(sessionPath(s.orgId, s.id), s as any);
  if (s.status === 'active') {
    tx.set(activePath(s.id), {
      id: s.id, orgId: s.orgId, title: s.title, hostUserId: s.hostUserId, hostName: s.hostName, tier: s.tier, roomCode: s.roomCode,
      startedAt: s.startedAt, endsAt: s.endsAt, participantCount: inCount(s), waitingCount: waitingCount(s),
      maxParticipants: s.limits.maxParticipants, recording: s.recording.active, locked: s.locked,
    });
  } else {
    tx.delete(activePath(s.id));
    tx.delete(roomPath(s.roomCode));
    const joined = s.participants.filter((p) => p.joinedAt != null);
    tx.set(usagePath(s.id), {
      id: s.id, orgId: s.orgId, tier: s.tier, title: s.title, hostUserId: s.hostUserId, hostName: s.hostName,
      startedAt: s.startedAt, endedAt: s.endedAt, durationSeconds: Math.round(((s.endedAt ?? s.startedAt) - s.startedAt) / 1000),
      peakParticipants: s.peakParticipants, uniqueParticipants: joined.length, endedReason: s.endedReason,
      recordingUsed: s.recording.used, maxParticipants: s.limits.maxParticipants, maxDurationMinutes: s.limits.maxDurationMinutes,
    });
  }
}

/**
 * Read-modify-write a session in one transaction. Plan upgrades and time-limit expiry are applied first,
 * then `fn` runs only if the meeting is still active (unless allowEnded).
 */
async function mutate<R>(orgId: string, id: string, fn: ((s: Session, now: number) => R | Promise<R>) | null, opts: { allowEnded?: boolean } = {}): Promise<{ session: Session; result: R | undefined }> {
  assertId(id);
  const plan = await resolveOrgPlan(orgId);
  const st = await getDocStore();
  const out = await st.transaction(async (tx) => {
    const s: Session | null = await tx.get(sessionPath(orgId, id));
    if (!s) throw new MeetingError(404, 'meeting_not_found', 'Meeting not found.');
    const now = Date.now();
    const wasActive = s.status === 'active';
    let dirty = applyPlan(s, plan);
    dirty = settleExpiry(s, now) || dirty;
    let result: R | undefined;
    let endedError: MeetingError | null = null;
    if (fn) {
      if (s.status !== 'active' && !opts.allowEnded) {
        endedError = new MeetingError(409, s.endedReason === 'time_limit' ? 'meeting_time_limit' : 'meeting_ended',
          s.endedReason === 'time_limit' ? `This meeting ended at its ${s.limits.maxDurationMinutes}-minute limit.` : 'This meeting has ended.');
      } else {
        result = await fn(s, now);
        dirty = true;
      }
    }
    if (dirty) { s.peakParticipants = Math.max(s.peakParticipants, inCount(s)); writeSession(tx, s); }
    return { session: s, result, endedError, justEnded: wasActive && s.status === 'ended' };
  });
  // The meeting just ended (host, admin, time limit): disconnect everyone from the media room too.
  if (out.justEnded) await closeMediaRoom(out.session.id);
  if (out.endedError) throw Object.assign(out.endedError, { session: out.session });
  return { session: out.session, result: out.result };
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

export function randomRoomCode() {
  const part = (n: number) => Math.random().toString(36).slice(2, 2 + n).padEnd(n, '0');
  return `${part(3)}-${part(4)}-${part(3)}`;
}

export async function startSession(a: Actor, input: { title?: unknown; roomCode?: unknown; scheduledMeetingId?: unknown }): Promise<Session> {
  const plan = await resolveOrgPlan(a.orgId);
  const st = await getDocStore();
  const title = typeof input.title === 'string' && input.title.trim() ? input.title.trim().slice(0, 200) : 'Meeting';
  let roomCode = typeof input.roomCode === 'string' ? input.roomCode.trim().toLowerCase() : '';
  if (roomCode && !ROOM_RE.test(roomCode)) throw new MeetingError(400, 'invalid_input', 'Room codes use letters, numbers and dashes.', { field: 'roomCode' });
  if (!roomCode) roomCode = randomRoomCode();
  const scheduledMeetingId = typeof input.scheduledMeetingId === 'string' && input.scheduledMeetingId ? assertId(input.scheduledMeetingId) : null;
  const now = Date.now();
  const s: Session = {
    id: newId('mtg'), orgId: a.orgId, roomCode, title, hostUserId: a.userId, hostName: a.name || a.email || 'Host',
    tier: plan.tier, planLabel: plan.label, limits: { ...plan.limits }, features: { ...plan.features },
    warnMinutesBefore: plan.warnMinutesBefore, capacityWarnPercent: plan.capacityWarnPercent,
    startedAt: now, endsAt: now + plan.limits.maxDurationMinutes * 60_000, status: 'active', endedAt: null, endedReason: null,
    waitingRoomEnabled: false, locked: false, recording: { active: false, startedAt: null, by: null, used: false },
    participants: [{ id: newId('pt'), name: a.name || a.email || 'Host', email: a.email || '', userId: a.userId, role: 'host', status: 'in', invitedAt: now, joinedAt: now, leftAt: null, secondsIn: 0 }],
    peakParticipants: 1, scheduledMeetingId,
  };
  await st.transaction(async (tx) => {
    const existing = await tx.get(roomPath(roomCode));
    if (existing) {
      const other: Session | null = await tx.get(sessionPath(existing.orgId, existing.sessionId));
      if (other && other.status === 'active' && Date.now() < other.endsAt) {
        throw new MeetingError(409, 'room_in_use', 'A meeting with this room code is already running. Join it instead.', { sessionId: other.orgId === a.orgId ? other.id : undefined });
      }
    }
    tx.set(roomPath(roomCode), { orgId: a.orgId, sessionId: s.id });
    writeSession(tx, s);
  });
  return s;
}

export async function getSession(orgId: string, id: string): Promise<Session> {
  return (await mutate(orgId, id, null)).session;
}

/** For members of the organizer's organization (and the host). */
export async function getSessionFor(a: Actor, id: string): Promise<Session> {
  return getSession(a.orgId, id);
}

type Refusal = { email: string; reason: 'invalid' | 'duplicate' | 'full' | 'locked' | 'waiting_full' };
export async function addParticipants(a: Actor, id: string, people: Array<{ email?: unknown; name?: unknown }>) {
  if (!Array.isArray(people) || people.length === 0) throw new MeetingError(400, 'invalid_input', 'Add at least one email address.', { field: 'emails' });
  if (people.length > 1000) throw new MeetingError(400, 'invalid_input', 'Invite at most 1,000 people at a time.', { field: 'emails' });
  const { session, result } = await mutate(a.orgId, id, (s, now) => {
    requireManager(s, a);
    const added: SessionParticipant[] = []; const waiting: SessionParticipant[] = []; const refused: Refusal[] = [];
    const known = new Set(s.participants.filter((p) => p.status === 'in' || p.status === 'waiting').map((p) => p.email.toLowerCase()).filter(Boolean));
    let seats = roomCapacity(s.limits, inCount(s)).free;
    let waitSeats = Math.max(0, s.limits.maxParticipants - waitingCount(s));
    for (const raw of people) {
      const email = typeof raw?.email === 'string' ? raw.email.trim().slice(0, 254) : '';
      if (!EMAIL_RE.test(email)) { refused.push({ email: String(raw?.email ?? ''), reason: 'invalid' }); continue; }
      if (known.has(email.toLowerCase())) { refused.push({ email, reason: 'duplicate' }); continue; }
      if (s.locked) { refused.push({ email, reason: 'locked' }); continue; }
      const name = typeof raw?.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 120) : email.split('@')[0];
      if (s.waitingRoomEnabled) {
        if (waitSeats <= 0) { refused.push({ email, reason: 'waiting_full' }); continue; }
        waitSeats--;
      } else if (seats <= 0) { refused.push({ email, reason: 'full' }); continue; }
      else seats--;
      known.add(email.toLowerCase());
      const prior = s.participants.find((p) => p.email.toLowerCase() === email.toLowerCase());
      const p: SessionParticipant = prior ?? { id: newId('pt'), name, email, userId: null, role: 'guest', status: 'waiting', invitedAt: now, joinedAt: null, leftAt: null, secondsIn: 0 };
      if (!prior) s.participants.push(p);
      if (s.waitingRoomEnabled) { p.status = 'waiting'; waiting.push(p); }
      else { p.status = 'in'; p.joinedAt = p.joinedAt ?? now; p.leftAt = null; added.push(p); }
    }
    return { added, waiting, refused };
  });
  const full = result!.refused.some((r) => r.reason === 'full');
  return { session, ...result!, ...(full ? await upgradeHint(undefined, { participants: session.limits.maxParticipants + 1 }) : {}) };
}

/** A signed-in user joins by room code (any organization: invite links work across organizations). */
export async function joinByRoom(a: Actor, roomCodeRaw: string) {
  const roomCode = String(roomCodeRaw || '').trim().toLowerCase();
  if (!ROOM_RE.test(roomCode)) throw new MeetingError(400, 'invalid_input', 'That meeting code isn\'t valid.', { field: 'roomCode' });
  const room = await (await getDocStore()).get(roomPath(roomCode));
  if (!room) throw new MeetingError(404, 'meeting_not_found', 'No meeting is running with that code.');
  const { session, result } = await mutate(room.orgId, room.sessionId, async (s, now) => {
    const existing = s.participants.find((p) => p.userId === a.userId);
    if (existing && (existing.status === 'in' || existing.status === 'waiting')) return existing;
    if (existing && (existing.status === 'removed' || existing.status === 'denied')) throw new MeetingError(403, 'not_allowed', 'The host removed you from this meeting.');
    const insider = a.orgId === s.orgId && (isOrgAdmin(a) || a.userId === s.hostUserId);
    if (s.locked && !insider) throw new MeetingError(423, 'meeting_locked', 'The host has locked this meeting.');
    const p: SessionParticipant = existing ?? { id: newId('pt'), name: a.name || a.email || 'Guest', email: a.email || '', userId: a.userId, role: 'guest', status: 'waiting', invitedAt: now, joinedAt: null, leftAt: null, secondsIn: 0 };
    if (!existing) s.participants.push(p);
    if (s.waitingRoomEnabled && !insider) { p.status = 'waiting'; return p; }
    if (roomCapacity(s.limits, inCount(s)).full) {
      throw new MeetingError(409, 'meeting_full', `This meeting is full (${s.limits.maxParticipants} participants on the ${s.planLabel} plan).`, await upgradeHint(undefined, { participants: s.limits.maxParticipants + 1 }));
    }
    p.status = 'in'; p.joinedAt = p.joinedAt ?? now; p.leftAt = null;
    return p;
  });
  return { session, you: result! };
}

function findParticipant(s: Session, pid: string) {
  const p = s.participants.find((x) => x.id === pid);
  if (!p) throw new MeetingError(404, 'participant_not_found', 'That person isn\'t in this meeting.');
  return p;
}

export async function admit(a: Actor, id: string, pids: string[] | 'all') {
  const { session, result } = await mutate(a.orgId, id, (s, now) => {
    requireManager(s, a);
    const queue = pids === 'all' ? s.participants.filter((p) => p.status === 'waiting') : pids.map((pid) => findParticipant(s, assertId(pid)));
    const admitted: string[] = []; const stillWaiting: string[] = [];
    for (const p of queue) {
      if (p.status !== 'waiting') continue;
      if (roomCapacity(s.limits, inCount(s)).full) { stillWaiting.push(p.id); continue; }
      p.status = 'in'; p.joinedAt = p.joinedAt ?? now; p.leftAt = null; admitted.push(p.id);
    }
    return { admitted, stillWaiting };
  });
  const full = result!.stillWaiting.length > 0;
  return { session, ...result!, ...(full ? await upgradeHint(undefined, { participants: session.limits.maxParticipants + 1 }) : {}) };
}

export async function deny(a: Actor, id: string, pid: string) {
  return (await mutate(a.orgId, id, (s) => { requireManager(s, a); const p = findParticipant(s, assertId(pid)); if (p.status === 'waiting') p.status = 'denied'; })).session;
}

export async function removeParticipant(a: Actor, id: string, pid: string) {
  return (await mutate(a.orgId, id, async (s, now) => {
    requireManager(s, a);
    await requireFeature(s, 'hostControls');
    const p = findParticipant(s, assertId(pid));
    if (p.role === 'host') throw new MeetingError(400, 'cannot_remove_host', 'The host can\'t be removed. End the meeting instead.');
    if (p.status === 'in') p.secondsIn += Math.max(0, Math.round((now - (p.joinedAt ?? now)) / 1000));
    p.status = 'removed'; p.leftAt = now;
    return p.id;
  }).then(async ({ session, result }) => { if (result) await removeFromMediaRoom(session.id, result); return { session }; })).session;
}

/**
 * A LiveKit token for the caller, only if the roster has let them in. Valid for this meeting's room only,
 * until the meeting's time limit. null = media isn't configured on this server.
 */
export async function mediaTokenFor(a: Actor, s: Session) {
  if (s.status !== 'active') throw new MeetingError(409, s.endedReason === 'time_limit' ? 'meeting_time_limit' : 'meeting_ended', 'This meeting has ended.');
  const p = s.participants.find((x) => x.userId === a.userId);
  if (!p || p.status === 'removed' || p.status === 'denied') throw new MeetingError(403, 'not_a_participant', 'You\'re not in this meeting.');
  if (p.status === 'waiting') throw new MeetingError(403, 'not_admitted', 'The host hasn\'t let you in yet.');
  if (p.status !== 'in') throw new MeetingError(403, 'not_a_participant', 'Join the meeting first.');
  return createMediaToken({ room: s.id, identity: p.id, name: p.name, role: p.role, canManage: canManage(s, a), expiresAt: s.endsAt });
}

export async function setRole(a: Actor, id: string, pid: string, role: unknown) {
  if (role !== 'cohost' && role !== 'guest') throw new MeetingError(400, 'invalid_input', 'Role must be cohost or guest.', { field: 'role' });
  return (await mutate(a.orgId, id, async (s) => {
    requireManager(s, a);
    await requireFeature(s, 'coHosts');
    const p = findParticipant(s, assertId(pid));
    if (p.role === 'host') throw new MeetingError(400, 'invalid_input', 'The host\'s role can\'t change.');
    p.role = role;
  })).session;
}

export async function updateSettings(a: Actor, id: string, patch: { waitingRoomEnabled?: unknown; locked?: unknown }) {
  return (await mutate(a.orgId, id, async (s) => {
    requireManager(s, a);
    if (patch.waitingRoomEnabled !== undefined) {
      if (typeof patch.waitingRoomEnabled !== 'boolean') throw new MeetingError(400, 'invalid_input', 'waitingRoomEnabled must be true or false.', { field: 'waitingRoomEnabled' });
      if (patch.waitingRoomEnabled) await requireFeature(s, 'waitingRoom');
      s.waitingRoomEnabled = patch.waitingRoomEnabled;
    }
    if (patch.locked !== undefined) {
      if (typeof patch.locked !== 'boolean') throw new MeetingError(400, 'invalid_input', 'locked must be true or false.', { field: 'locked' });
      if (patch.locked) await requireFeature(s, 'securityControls');
      s.locked = patch.locked;
    }
  })).session;
}

export async function setRecording(a: Actor, id: string, action: unknown) {
  if (action !== 'start' && action !== 'stop') throw new MeetingError(400, 'invalid_input', 'action must be start or stop.', { field: 'action' });
  return (await mutate(a.orgId, id, async (s, now) => {
    requireManager(s, a);
    if (action === 'start') {
      await requireFeature(s, 'recording');
      s.recording = { active: true, startedAt: now, by: a.userId, used: true };
    } else {
      s.recording = { ...s.recording, active: false };
    }
  })).session;
}

/** Leave the meeting. When the host leaves and no co-host is still in, the meeting ends. */
export async function leave(a: Actor, id: string, orgId = a.orgId) {
  return (await mutate(orgId, id, (s, now) => {
    const p = s.participants.find((x) => x.userId === a.userId && (x.status === 'in' || x.status === 'waiting'));
    if (!p) return;
    if (p.status === 'in') p.secondsIn += Math.max(0, Math.round((now - (p.joinedAt ?? now)) / 1000));
    p.status = 'left'; p.leftAt = now;
    if (p.role === 'host' && !s.participants.some((x) => x.role === 'cohost' && x.status === 'in' && x.userId)) endSession(s, now, 'host');
  })).session;
}

async function roomSession(roomCodeRaw: string) {
  const roomCode = String(roomCodeRaw || '').trim().toLowerCase();
  if (!ROOM_RE.test(roomCode)) throw new MeetingError(400, 'invalid_input', 'That meeting code isn\'t valid.', { field: 'roomCode' });
  const room = await (await getDocStore()).get(roomPath(roomCode));
  if (!room) throw new MeetingError(404, 'meeting_not_found', 'No meeting is running with that code.');
  return room as { orgId: string; sessionId: string };
}

/** People who joined by code (possibly from another organization) follow the meeting through its room code. */
export async function getByRoom(a: Actor, roomCode: string): Promise<Session> {
  const room = await roomSession(roomCode);
  const s = await getSession(room.orgId, room.sessionId);
  if (a.orgId !== s.orgId && !s.participants.some((p) => p.userId === a.userId && (p.status === 'in' || p.status === 'waiting'))) throw new MeetingError(404, 'meeting_not_found', 'No meeting is running with that code.');
  return s;
}

export async function leaveByRoom(a: Actor, roomCode: string): Promise<Session> {
  const room = await roomSession(roomCode);
  return leave(a, room.sessionId, room.orgId);
}

export async function endMeeting(a: Actor, id: string, opts: { asPlatformAdmin?: boolean; orgId?: string } = {}) {
  const orgId = opts.orgId ?? a.orgId;
  return (await mutate(orgId, id, (s, now) => {
    if (!opts.asPlatformAdmin) requireManager(s, a);
    endSession(s, now, opts.asPlatformAdmin ? 'admin' : 'host');
  })).session;
}

/** Closes every meeting whose time is up. Returns how many were ended. */
export async function sweepExpiredMeetings(now = Date.now()): Promise<number> {
  const st = await getDocStore();
  const active = await st.list('meeting_active');
  let ended = 0;
  for (const m of active) {
    if (m.endsAt > now) continue;
    try { const s = await getSession(m.orgId, m.id); if (s.status === 'ended') ended++; } catch { /* already gone */ }
  }
  return ended;
}

let sweeper: NodeJS.Timeout | null = null;
export function startMeetingSweeper(intervalMs = 15_000) {
  if (sweeper) return;
  sweeper = setInterval(() => { sweepExpiredMeetings().catch((e) => console.warn('[meetings] sweep failed:', (e as Error).message)); }, intervalMs);
  sweeper.unref?.();
}

// ---------------------------------------------------------------------------
// What the API returns
// ---------------------------------------------------------------------------

export function sessionView(s: Session, a: Actor) {
  const now = Date.now();
  const manager = canManage(s, a);
  const sameOrg = a.orgId === s.orgId;
  const count = inCount(s);
  const you = s.participants.find((p) => p.userId === a.userId) ?? null;
  return {
    id: s.id, roomCode: s.roomCode, title: s.title, tier: s.tier, planLabel: s.planLabel,
    limits: s.limits, features: s.features, warnMinutesBefore: s.warnMinutesBefore, capacityWarnPercent: s.capacityWarnPercent,
    startedAt: s.startedAt, endsAt: s.endsAt, serverNow: now, status: s.status, endedAt: s.endedAt, endedReason: s.endedReason,
    remainingSeconds: s.status === 'active' ? durationStatus(s.limits, (now - s.startedAt) / 1000, s.warnMinutesBefore).secondsLeft : 0,
    durationState: s.status === 'active' ? durationStatus(s.limits, (now - s.startedAt) / 1000, s.warnMinutesBefore).state : 'reached',
    participantCount: count, waitingCount: waitingCount(s), capacityState: capacityStatus(s.limits, count, s.capacityWarnPercent),
    waitingRoomEnabled: s.waitingRoomEnabled, locked: s.locked, recording: { active: s.recording.active, startedAt: s.recording.startedAt },
    host: { userId: s.hostUserId, name: s.hostName },
    you: { participantId: you?.id ?? null, role: you?.role ?? null, status: you?.status ?? null, canManage: manager },
    // Roster: full detail for the organizer's organization; names only for people joining from elsewhere.
    participants: s.participants
      .filter((p) => p.status === 'in' || (manager && p.status === 'waiting'))
      .map((p) => ({ id: p.id, name: p.name, role: p.role, status: p.status, joinedAt: p.joinedAt, ...(sameOrg ? { email: p.email, userId: p.userId } : {}) })),
  };
}
export type SessionView = ReturnType<typeof sessionView>;

export function attendanceReport(s: Session) {
  const end = s.endedAt ?? Date.now();
  return s.participants
    .filter((p) => p.joinedAt != null)
    .map((p) => ({
      name: p.name, email: p.email, role: p.role, joinedAt: p.joinedAt, leftAt: p.status === 'in' ? null : p.leftAt,
      minutes: Math.round((p.secondsIn + (p.status === 'in' ? Math.max(0, (end - (p.joinedAt ?? end)) / 1000) : 0)) / 60),
      outcome: p.status === 'removed' ? 'removed' : p.status === 'in' ? 'in meeting' : 'left',
    }));
}
