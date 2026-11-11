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
import {
  closeMediaRoom, cloudRecordingAvailable, createMediaToken, egressConfig, muteInMediaRoom, removeFromMediaRoom, startRoomRecording, stopRoomRecording,
} from './media';
import { syncFromSession, getMeeting, GreetError } from '../greet/scheduled';
import { recordAudit } from '../greet/audit';

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
  /** External guests who came through a GREET invitation link (no account). */
  inviteId?: string | null;
  /** sha256 of the guest's browser key (the key itself is only ever held by the guest). */
  guestKeyHash?: string | null;
}

export interface RecordingState {
  active: boolean; startedAt: number | null; by: string | null; used: boolean;
  /** 'cloud' = LiveKit Egress to the organization's storage; 'device' = the host's browser records locally. */
  mode?: 'cloud' | 'device' | null;
  recordingId?: string | null;
  egressId?: string | null;
  /** Consent round: the host asked to record; each participant answers before recording can start. */
  requestedAt?: number | null;
  consents?: Record<string, number>;
  declined?: Record<string, number>;
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
  recording: RecordingState;
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
  if (out.justEnded) {
    await closeMediaRoom(out.session.id);
    await finishCloudRecording(out.session, out.session.endedAt ?? Date.now());
    await syncFromSession(out.session);
  }
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
  let title = typeof input.title === 'string' && input.title.trim() ? input.title.trim().slice(0, 200) : 'Meeting';
  let roomCode = typeof input.roomCode === 'string' ? input.roomCode.trim().toLowerCase() : '';
  if (roomCode && !ROOM_RE.test(roomCode)) throw new MeetingError(400, 'invalid_input', 'Room codes use letters, numbers and dashes.', { field: 'roomCode' });
  if (!roomCode) roomCode = randomRoomCode();
  const scheduledMeetingId = typeof input.scheduledMeetingId === 'string' && input.scheduledMeetingId ? assertId(input.scheduledMeetingId) : null;
  if (scheduledMeetingId) {
    // Starting a scheduled GREET meeting: it must belong to this organization and not be cancelled;
    // its room code (the one in the invitations) and title are used.
    let m: any;
    try { m = await getMeeting(a.orgId, scheduledMeetingId); }
    catch (e) { if (e instanceof GreetError) throw new MeetingError(e.status, e.code, e.message); throw e; }
    if (m.status === 'CANCELLED') throw new MeetingError(409, 'meeting_cancelled', 'This meeting was cancelled.');
    if (m.roomCode && ROOM_RE.test(m.roomCode)) roomCode = m.roomCode;
    if (!(typeof input.title === 'string' && input.title.trim()) && m.title) title = String(m.title).slice(0, 200);
  }
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
  await syncFromSession(s);
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
  const t = await createMediaToken({ room: s.id, identity: p.id, name: p.name, role: p.role, canManage: canManage(s, a), expiresAt: s.endsAt });
  if (t) await recordAudit(s.orgId, { actorId: a.userId, action: 'greet.media_token.issued', target: s.id, meta: { participantId: p.id, role: p.role, admin: canManage(s, a), expiresAt: t.expiresAt } });
  return t;
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

const recordingPath = (orgId: string, id: string) => `organizations/${orgId}/meeting_recordings/${id}`;
const RETENTION_DEFAULT_DAYS = 30;
export async function greetSettings(orgId: string) {
  const d = await (await getDocStore()).get(`organizations/${orgId}/settings/greet`);
  return { recordingEnabled: d?.recordingEnabled === true, recordingRetentionDays: Number(d?.recordingRetentionDays) > 0 ? Number(d.recordingRetentionDays) : RETENTION_DEFAULT_DAYS };
}

/**
 * Recording, with consent from everyone:
 *   request  the host asks; every participant's screen asks them to agree (nothing is recorded yet)
 *   start    allowed once everyone in the meeting agreed. Cloud recording (LiveKit Egress) when it is configured
 *            and turned on for the organization; otherwise 'device' (the host's browser records its own view).
 *            target 'cloud' insists on cloud and answers 501 recording_not_configured when it isn't available.
 *   stop     ends it (cloud recordings are finalized by LiveKit and appear under GREET recordings).
 *   cancel   withdraws a pending request.
 */
export async function setRecording(a: Actor, id: string, action: unknown, opts: { target?: unknown } = {}) {
  if (!['request', 'start', 'stop', 'cancel'].includes(String(action))) throw new MeetingError(400, 'invalid_input', 'action must be request, start, stop or cancel.', { field: 'action' });
  const settings = await greetSettings(a.orgId);
  const cloudReady = settings.recordingEnabled && cloudRecordingAvailable();
  if (action === 'start' && opts.target === 'cloud' && !cloudReady) {
    throw new MeetingError(501, 'recording_not_configured', settings.recordingEnabled
      ? 'Cloud recording isn\'t set up on this server (LiveKit Egress storage isn\'t configured).'
      : 'Cloud recording is turned off for this organization. An admin can turn it on in GREET settings.');
  }
  let started: { recordingId: string; filepath: string } | null = null;
  const { session } = await mutate(a.orgId, id, async (s, now) => {
    requireManager(s, a);
    const r = s.recording;
    if (action === 'request') {
      await requireFeature(s, 'recording');
      if (r.active) throw new MeetingError(409, 'already_recording', 'This meeting is already being recorded.');
      const me = s.participants.find((p) => p.userId === a.userId && p.status === 'in');
      s.recording = { ...r, requestedAt: now, consents: me ? { [me.id]: now } : {}, declined: {} };
    } else if (action === 'cancel') {
      s.recording = { ...r, requestedAt: null, consents: {}, declined: {} };
    } else if (action === 'start') {
      await requireFeature(s, 'recording');
      if (r.active) return;
      const present = s.participants.filter((p) => p.status === 'in');
      const missing = present.filter((p) => !(r.consents || {})[p.id] && p.userId !== a.userId);
      if (!r.requestedAt || missing.length) {
        throw new MeetingError(409, 'consent_pending', missing.length
          ? `Waiting for consent from: ${missing.map((p) => p.name).join(', ')}.`
          : 'Ask everyone for consent first.', { waitingFor: missing.map((p) => ({ id: p.id, name: p.name })) });
      }
      const mode: 'cloud' | 'device' = cloudReady ? 'cloud' : 'device';
      const recordingId = newId('rec');
      if (mode === 'cloud') started = { recordingId, filepath: `${egressConfig()?.prefix || 'greet-recordings'}/${s.orgId}/${s.id}/${recordingId}.mp4` };
      s.recording = { ...r, active: true, startedAt: now, by: a.userId, used: true, mode, recordingId, egressId: null };
    } else {
      s.recording = { ...r, active: false, requestedAt: null };
    }
  });
  if (action === 'start' && started) {
    const st = started as { recordingId: string; filepath: string };
    let egressId: string | null = null;
    try { egressId = (await startRoomRecording(session.id, st.filepath))?.egressId ?? null; }
    catch (e) {
      await mutate(a.orgId, id, (s) => { s.recording = { ...s.recording, active: false }; }).catch(() => undefined);
      console.warn('[greet] cloud recording could not start:', (e as Error)?.name || 'error');
      throw new MeetingError(502, 'recording_failed', 'Cloud recording couldn\'t start. Try again, or check the LiveKit Egress setup.');
    }
    const out = await mutate(a.orgId, id, (s) => { s.recording = { ...s.recording, egressId }; });
    await (await getDocStore()).set(recordingPath(a.orgId, st.recordingId), {
      id: st.recordingId, orgId: a.orgId, sessionId: session.id, scheduledMeetingId: session.scheduledMeetingId, title: session.title,
      hostUserId: session.hostUserId, startedBy: a.userId, startedAt: new Date().toISOString(), endedAt: null,
      mode: 'cloud', status: 'recording', egressId, storageKey: st.filepath,
      consents: Object.entries(session.recording.consents || {}).map(([pid, at]) => ({ participantId: pid, name: session.participants.find((p) => p.id === pid)?.name || '', at: new Date(at).toISOString() })),
      retentionDays: settings.recordingRetentionDays,
      deleteAfter: new Date(Date.now() + settings.recordingRetentionDays * 86_400_000).toISOString(),
    });
    await recordAudit(a.orgId, { actorId: a.userId, action: 'greet.recording.started', target: st.recordingId, meta: { sessionId: session.id, mode: 'cloud' } });
    return out.session;
  }
  if (action === 'start') await recordAudit(a.orgId, { actorId: a.userId, action: 'greet.recording.started', target: session.id, meta: { mode: session.recording.mode } });
  if (action === 'stop') {
    await finishCloudRecording(session, Date.now());
    await recordAudit(a.orgId, { actorId: a.userId, action: 'greet.recording.stopped', target: session.recording.recordingId || session.id, meta: { mode: session.recording.mode } });
  }
  return session;
}

/** Stops LiveKit Egress (best effort) and marks the recording as processing; the LiveKit webhook marks it ready. */
async function finishCloudRecording(s: Session, at: number) {
  const r = s.recording;
  if (r.mode !== 'cloud' || !r.recordingId) return;
  const st = await getDocStore();
  const rec = await st.get(recordingPath(s.orgId, r.recordingId));
  if (!rec || rec.status !== 'recording') return;
  try { if (r.egressId) await stopRoomRecording(r.egressId); }
  catch (e) { console.warn('[greet] could not stop cloud recording:', (e as Error)?.name || 'error'); }
  await st.update(recordingPath(s.orgId, r.recordingId), { status: 'processing', endedAt: new Date(at).toISOString() });
}

/** A participant answers the recording request (agree or decline). The host sees who declined. */
export async function answerRecordingConsent(orgId: string, id: string, who: { userId?: string | null; guestKeyHash?: string | null }, agree: unknown) {
  if (typeof agree !== 'boolean') throw new MeetingError(400, 'invalid_input', 'consent must be true or false.', { field: 'consent' });
  return (await mutate(orgId, id, (s, now) => {
    const p = s.participants.find((x) => x.status === 'in' && ((who.userId && x.userId === who.userId) || (who.guestKeyHash && x.guestKeyHash === who.guestKeyHash)));
    if (!p) throw new MeetingError(403, 'not_a_participant', 'You\'re not in this meeting.');
    if (!s.recording.requestedAt && !s.recording.active) throw new MeetingError(409, 'no_request', 'Nobody has asked to record this meeting.');
    const consents = { ...(s.recording.consents || {}) }; const declined = { ...(s.recording.declined || {}) };
    if (agree) { consents[p.id] = now; delete declined[p.id]; } else { declined[p.id] = now; delete consents[p.id]; }
    s.recording = { ...s.recording, consents, declined };
  })).session;
}

/** Host control: mute someone's microphone through LiveKit (they can unmute themselves; everyone sees it). */
export async function muteParticipant(a: Actor, id: string, pid: string | 'all') {
  const s = await getSession(a.orgId, id);
  requireManager(s, a);
  if (s.status !== 'active') throw new MeetingError(409, 'meeting_ended', 'This meeting has ended.');
  const targets = pid === 'all' ? s.participants.filter((p) => p.status === 'in' && p.userId !== a.userId) : [findParticipant(s, assertId(pid))];
  const results: Record<string, string> = {};
  for (const p of targets) {
    const r = await muteInMediaRoom(s.id, p.id);
    if (r === 'not_configured') throw new MeetingError(503, 'media_not_configured', 'Audio and video between people aren\'t connected on this server yet (LiveKit isn\'t configured).');
    results[p.id] = r;
  }
  await recordAudit(a.orgId, { actorId: a.userId, action: 'greet.participant.muted', target: s.id, meta: { participants: Object.keys(results) } });
  return { session: s, results };
}

// ---------------------------------------------------------------------------
// External guests (GREET invitation links, no account)
// ---------------------------------------------------------------------------

/** The running session for a scheduled meeting (by its room code), or null when it hasn't started. */
export async function liveSessionForMeeting(orgId: string, meeting: { id: string; roomCode?: string }) {
  if (!meeting.roomCode || !ROOM_RE.test(meeting.roomCode)) return null;
  const room = await (await getDocStore()).get(roomPath(meeting.roomCode));
  if (!room || room.orgId !== orgId) return null;
  const s = await getSession(orgId, room.sessionId);
  return s.status === 'active' && s.scheduledMeetingId === meeting.id ? s : null;
}

/** A guest with a valid invitation enters the waiting room; only the host (or a co-host / admin) can let them in. */
export async function guestJoin(orgId: string, sessionId: string, g: { inviteId: string; email: string; name: string; keyHash: string }) {
  const { session, result } = await mutate(orgId, sessionId, (s, now) => {
    const prior = s.participants.find((p) => p.inviteId === g.inviteId);
    if (prior && (prior.status === 'removed' || prior.status === 'denied')) throw new MeetingError(403, 'not_allowed', 'The host didn\'t let you into this meeting.');
    if (s.locked) throw new MeetingError(423, 'meeting_locked', 'The host has locked this meeting.');
    if (prior && (prior.status === 'in' || prior.status === 'waiting')) { prior.guestKeyHash = g.keyHash; return prior; }
    if (waitingCount(s) >= s.limits.maxParticipants) throw new MeetingError(409, 'waiting_full', 'The waiting room is full. Try again in a moment.');
    const p: SessionParticipant = prior ?? { id: newId('pt'), name: g.name, email: g.email, userId: null, role: 'guest', status: 'waiting', invitedAt: now, joinedAt: null, leftAt: null, secondsIn: 0, inviteId: g.inviteId, guestKeyHash: g.keyHash };
    if (!prior) s.participants.push(p);
    p.status = 'waiting'; p.name = g.name; p.guestKeyHash = g.keyHash;
    return p;
  });
  return { session, you: result! };
}

export async function guestParticipant(orgId: string, sessionId: string, keyHash: string, inviteId: string) {
  const s = await getSession(orgId, sessionId);
  const p = s.participants.find((x) => x.inviteId === inviteId && x.guestKeyHash === keyHash) ?? null;
  return { session: s, you: p };
}

export async function guestMediaToken(orgId: string, sessionId: string, keyHash: string, inviteId: string) {
  const { session: s, you: p } = await guestParticipant(orgId, sessionId, keyHash, inviteId);
  if (s.status !== 'active') throw new MeetingError(409, 'meeting_ended', 'This meeting has ended.');
  if (!p || p.status === 'removed' || p.status === 'denied' || p.status === 'left') throw new MeetingError(403, 'not_a_participant', 'You\'re not in this meeting.');
  if (p.status === 'waiting') throw new MeetingError(403, 'not_admitted', 'The host hasn\'t let you in yet.');
  const t = await createMediaToken({ room: s.id, identity: p.id, name: p.name, role: 'guest', canManage: false, expiresAt: s.endsAt });
  if (t) await recordAudit(orgId, { actorId: `guest:${inviteId}`, action: 'greet.media_token.issued', target: s.id, meta: { participantId: p.id, role: 'guest', admin: false, expiresAt: t.expiresAt } });
  return t;
}

export async function guestLeave(orgId: string, sessionId: string, keyHash: string, inviteId: string) {
  return (await mutate(orgId, sessionId, (s, now) => {
    const p = s.participants.find((x) => x.inviteId === inviteId && x.guestKeyHash === keyHash && (x.status === 'in' || x.status === 'waiting'));
    if (!p) return;
    if (p.status === 'in') p.secondsIn += Math.max(0, Math.round((now - (p.joinedAt ?? now)) / 1000));
    p.status = 'left'; p.leftAt = now;
  })).session;
}

/** What a guest's page shows (no roster emails, no ids beyond their own). */
export function guestView(s: Session, p: SessionParticipant | null) {
  return {
    title: s.title, status: s.status, hostName: s.hostName, endsAt: s.endsAt, serverNow: Date.now(),
    you: p ? { participantId: p.id, name: p.name, status: p.status } : null,
    participantCount: inCount(s), locked: s.locked,
    recording: {
      active: s.recording.active, requested: !!s.recording.requestedAt && !s.recording.active, mode: s.recording.mode ?? null,
      yourConsent: p ? ((s.recording.consents || {})[p.id] ? 'agreed' : (s.recording.declined || {})[p.id] ? 'declined' : null) : null,
    },
  };
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
    waitingRoomEnabled: s.waitingRoomEnabled, locked: s.locked,
    recording: {
      active: s.recording.active, startedAt: s.recording.startedAt, mode: s.recording.mode ?? null,
      requested: !!s.recording.requestedAt && !s.recording.active,
      yourConsent: you ? ((s.recording.consents || {})[you.id] ? 'agreed' : (s.recording.declined || {})[you.id] ? 'declined' : null) : null,
      ...(manager ? {
        consentedIds: Object.keys(s.recording.consents || {}), declinedIds: Object.keys(s.recording.declined || {}),
        waitingFor: s.participants.filter((p) => p.status === 'in' && !(s.recording.consents || {})[p.id]).map((p) => ({ id: p.id, name: p.name })),
      } : {}),
    },
    scheduledMeetingId: s.scheduledMeetingId ?? null,
    host: { userId: s.hostUserId, name: s.hostName },
    you: { participantId: you?.id ?? null, role: you?.role ?? null, status: you?.status ?? null, canManage: manager },
    // Roster: full detail for the organizer's organization; names only for people joining from elsewhere.
    participants: s.participants
      .filter((p) => p.status === 'in' || (manager && p.status === 'waiting'))
      .map((p) => ({ id: p.id, name: p.name, role: p.role, status: p.status, joinedAt: p.joinedAt, external: !!p.inviteId, ...(sameOrg ? { email: p.email, userId: p.userId } : {}) })),
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
