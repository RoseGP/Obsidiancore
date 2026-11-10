/**
 * GREET scheduled meetings: the meeting record that ties a LiveKit session to the CRM.
 *
 *   organizations/{orgId}/scheduled_meetings/{id}
 *
 * Fields added by GREET (older records without them keep working: every field is optional on read):
 *   hostId                    who owns the meeting (older records: createdBy)
 *   invitees[]                organization members invited { userId, name, email }
 *   guests[]                  external guests' email addresses (unchanged)
 *   associations              { contactId?, leadId?, companyId?, dealId? } validated against this organization
 *   status                    SCHEDULED | LIVE | ENDED | CANCELLED
 *   actualStart / actualEnd   filled from the live session (sessions.ts calls syncFromSession)
 *   sessionIds[]              live sessions held for this meeting
 *   participants[]            who attended (from the session roster)
 *   outcome                   { result, summary, at, by } recorded after the meeting
 *
 * Never stored: LiveKit keys, tokens, invite tokens.
 */
import { DateTime } from 'luxon';
import { z } from 'zod';
import { assertId, getDocStore } from '../data/docStore';
import { can, getMember, type Role } from '../tenancy/orgs';
import { LIMIT_BOUNDS } from '../../lib/meetingPlans';
import { CrmRepository } from '../crm/crmRepository';

export class GreetError extends Error {
  constructor(public status: number, public code: string, message: string, public extra?: Record<string, unknown>) { super(message); }
}

export type MeetingStatus = 'SCHEDULED' | 'LIVE' | 'ENDED' | 'CANCELLED';
export interface Invitee { userId: string; name: string; email: string }
export interface Associations { contactId?: string; leadId?: string; companyId?: string; dealId?: string; label?: string }
export interface GreetActor { userId: string; orgId: string; role: Role; name: string; email: string }

export const scheduledPath = (orgId: string) => `organizations/${assertId(orgId)}/scheduled_meetings`;

const assocSchema = z.object({
  contactId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).optional(),
  leadId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).optional(),
  companyId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).optional(),
  dealId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).optional(),
}).partial();

export const scheduleSchema = z.object({
  title: z.string().trim().min(1, 'Add a title.').max(200),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-12-01.'),
  time: z.string().trim().min(1, 'Add a start time.').max(10),
  ampm: z.enum(['AM', 'PM']).optional(),
  timezone: z.string().max(64).optional(),
  duration: z.coerce.number().int().min(5, 'Meetings are at least 5 minutes.').max(LIMIT_BOUNDS.maxDurationMinutes.max),
  guests: z.array(z.string().trim().email('One of the guest addresses isn\'t valid.')).max(LIMIT_BOUNDS.maxParticipants.max).default([]),
  inviteeIds: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)).max(LIMIT_BOUNDS.maxParticipants.max).default([]),
  associations: assocSchema.optional(),
  locations: z.array(z.string().trim().max(120)).max(20).default([]),
  permissions: z.object({ modify: z.boolean().optional(), inviteOther: z.boolean().optional(), seeGuestList: z.boolean().optional() }).partial().optional(),
  availability: z.string().max(40).optional(),
  visibility: z.string().max(40).optional(),
  additionalNotes: z.string().max(5000).optional(),
  recurrence: z.object({
    frequency: z.enum(['none', 'daily', 'weekly', 'monthly']),
    count: z.coerce.number().int().min(1).max(52, 'A series can have at most 52 meetings.'),
  }).optional(),
});
export type ScheduleInput = z.infer<typeof scheduleSchema>;

/**
 * PATCH: any subset; date/time/duration changes reschedule every occurrence from the new start.
 * Written out without defaults: in zod 4 a default inside .partial() would still fill in (and wipe guests).
 */
const emails = z.array(z.string().trim().email('One of the guest addresses isn\'t valid.')).max(LIMIT_BOUNDS.maxParticipants.max);
export const patchSchema = z.object({
  title: z.string().trim().min(1, 'Add a title.').max(200).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-12-01.').optional(),
  time: z.string().trim().min(1, 'Add a start time.').max(10).optional(),
  ampm: z.enum(['AM', 'PM']).optional(),
  timezone: z.string().max(64).optional(),
  duration: z.coerce.number().int().min(5, 'Meetings are at least 5 minutes.').max(LIMIT_BOUNDS.maxDurationMinutes.max).optional(),
  guests: emails.optional(),
  inviteeIds: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)).max(LIMIT_BOUNDS.maxParticipants.max).optional(),
  associations: assocSchema.nullable().optional(),
  locations: z.array(z.string().trim().max(120)).max(20).optional(),
  permissions: z.object({ modify: z.boolean().optional(), inviteOther: z.boolean().optional(), seeGuestList: z.boolean().optional() }).partial().optional(),
  availability: z.string().max(40).optional(),
  visibility: z.string().max(40).optional(),
  additionalNotes: z.string().max(5000).optional(),
});

export const outcomeSchema = z.object({
  result: z.enum(['held', 'no_show', 'rescheduled', 'won', 'lost', 'follow_up', 'other']),
  summary: z.string().trim().max(5000).optional().default(''),
});

export function startOf(input: { date: string; time: string; ampm?: 'AM' | 'PM'; timezone?: string }): DateTime {
  const zone = input.timezone || 'utc';
  let time = input.time;
  if (input.ampm && !/am|pm/i.test(time)) time = `${time} ${input.ampm}`;
  for (const fmt of ['yyyy-MM-dd HH:mm', 'yyyy-MM-dd h:mm a', 'yyyy-MM-dd hh:mm a']) {
    const dt = DateTime.fromFormat(`${input.date} ${time}`, fmt, { zone });
    if (dt.isValid) return dt;
  }
  throw new GreetError(400, 'invalid_input', 'That start time isn\'t valid. Use a time like 14:30.', { field: 'time' });
}

export function occurrencesFor(start: DateTime, duration: number, frequency: string, count: number) {
  const n = frequency === 'none' ? 1 : count;
  const step = frequency === 'daily' ? 'days' : frequency === 'weekly' ? 'weeks' : frequency === 'monthly' ? 'months' : null;
  return Array.from({ length: n }, (_, i) => {
    const s = step ? start.plus({ [step]: i }) : start;
    return { startTime: s.toUTC().toISO()!, endTime: s.plus({ minutes: duration }).toUTC().toISO()! };
  });
}

/** Every association must exist in this organization (a lead id from another tenant is refused). */
export async function validateAssociations(orgId: string, raw: unknown): Promise<Associations> {
  if (raw == null) return {};
  const a = assocSchema.parse(raw);
  const repo = await CrmRepository.forOrg(orgId);
  const st = await getDocStore();
  const out: Associations = {};
  const labels: string[] = [];
  if (a.leadId) {
    const lead = await repo.getLead(a.leadId);
    if (!lead) throw new GreetError(400, 'invalid_association', 'That lead isn\'t in this organization.', { field: 'leadId' });
    out.leadId = a.leadId; labels.push(lead.name || lead.company || 'Lead');
  }
  if (a.dealId) {
    const deal = await repo.getDeal(a.dealId);
    if (!deal) throw new GreetError(400, 'invalid_association', 'That deal isn\'t in this organization.', { field: 'dealId' });
    out.dealId = a.dealId; labels.push(deal.name || 'Deal');
  }
  if (a.contactId) {
    const c = await st.get(`organizations/${orgId}/contacts/${assertId(a.contactId)}`);
    if (!c) throw new GreetError(400, 'invalid_association', 'That contact isn\'t in this organization.', { field: 'contactId' });
    out.contactId = a.contactId; labels.push(c.name || [c.firstName, c.lastName].filter(Boolean).join(' ') || 'Contact');
  }
  if (a.companyId) {
    const c = await st.get(`organizations/${orgId}/companies/${assertId(a.companyId)}`);
    if (!c) throw new GreetError(400, 'invalid_association', 'That company isn\'t in this organization.', { field: 'companyId' });
    out.companyId = a.companyId; labels.push(c.name || 'Company');
  }
  if (labels.length) out.label = labels.join(' · ').slice(0, 200);
  return out;
}

/** Internal invitees must be members of this organization. */
export async function resolveInvitees(orgId: string, ids: string[], hostId: string): Promise<Invitee[]> {
  const out: Invitee[] = [];
  for (const id of [...new Set(ids)]) {
    if (id === hostId) continue;
    const m = await getMember(orgId, assertId(id));
    if (!m) throw new GreetError(400, 'invalid_invitee', 'One of the people you invited isn\'t a member of this organization.', { field: 'inviteeIds' });
    out.push({ userId: m.userId, name: m.name || m.email || 'Member', email: m.email || '' });
  }
  return out;
}

export const hostOf = (m: any): string => m.hostId || m.createdBy;
export const lastEnd = (m: any): number => {
  const occ: any[] = Array.isArray(m.occurrences) && m.occurrences.length ? m.occurrences : [{ endTime: m.endTime }];
  return Math.max(...occ.map((o) => Date.parse(o.endTime) || 0));
};
export const nextOccurrence = (m: any, now = Date.now()) => {
  const occ: any[] = Array.isArray(m.occurrences) && m.occurrences.length ? m.occurrences : [{ startTime: m.startTime, endTime: m.endTime }];
  return occ.find((o) => Date.parse(o.endTime) > now) ?? null;
};

export function statusOf(m: any, now = Date.now()): MeetingStatus {
  if (m.status === 'CANCELLED') return 'CANCELLED';
  if (m.status === 'LIVE') return 'LIVE';
  if (m.status === 'ENDED') return nextOccurrence(m, now) && m.recurrence?.frequency && m.recurrence.frequency !== 'none' ? 'SCHEDULED' : 'ENDED';
  return lastEnd(m) < now ? 'ENDED' : 'SCHEDULED';
}

export function isInvited(m: any, a: GreetActor) {
  return (Array.isArray(m.invitees) && m.invitees.some((i: Invitee) => i.userId === a.userId))
    || (!!a.email && Array.isArray(m.guests) && m.guests.some((g: string) => g.toLowerCase() === a.email.toLowerCase()));
}

export function canEdit(m: any, a: GreetActor) {
  return a.orgId === m.orgId && (hostOf(m) === a.userId || can(a.role, 'manage_records'));
}

export function meetingView(m: any, a: GreetActor, now = Date.now()) {
  const host = hostOf(m) === a.userId;
  return {
    ...m,
    hostId: hostOf(m),
    invitees: m.invitees || [],
    associations: m.associations || {},
    status: statusOf(m, now),
    storedStatus: m.status,
    nextOccurrence: nextOccurrence(m, now),
    yourRole: host ? 'host' : isInvited(m, a) ? 'invitee' : 'member',
    canEdit: canEdit(m, a),
  };
}

export async function getMeeting(orgId: string, id: string) {
  const m = await (await getDocStore()).get(`${scheduledPath(orgId)}/${assertId(id)}`);
  if (!m) throw new GreetError(404, 'meeting_not_found', 'That meeting doesn\'t exist.');
  return m;
}

/** Logs to the organization feed and the linked lead's timeline (the CRM's existing notification surfaces). */
export async function announce(orgId: string, m: any, kind: 'scheduled' | 'rescheduled' | 'cancelled' | 'ended' | 'outcome', actorName: string, detail = '') {
  try {
    const repo = await CrmRepository.forOrg(orgId);
    const when = m.startTime ? DateTime.fromISO(m.startTime).toUTC().toFormat("d LLL yyyy, HH:mm 'UTC'") : '';
    const verb = { scheduled: 'scheduled', rescheduled: 'rescheduled', cancelled: 'cancelled', ended: 'ended', outcome: 'outcome recorded' }[kind];
    const invited = (m.invitees || []).map((i: Invitee) => i.name).join(', ');
    const description = [kind === 'cancelled' || kind === 'ended' || kind === 'outcome' ? '' : when, invited ? `Invited: ${invited}` : '', detail].filter(Boolean).join(' · ');
    await repo.logActivity({ type: `meeting_${kind}`, title: `GREET meeting ${verb}: ${m.title}`, description, actor: actorName, targetId: m.id, targetType: 'meeting' });
    if (m.associations?.leadId) {
      await repo.addLeadActivity(m.associations.leadId, { type: `meeting_${kind}`, title: `GREET meeting ${verb}: ${m.title}`, description, actor: actorName, meetingId: m.id }).catch(() => undefined);
    }
  } catch (e) {
    console.warn('[greet] could not log meeting activity:', (e as Error)?.name || 'error');
  }
}

/**
 * Keeps the scheduled meeting in step with its live session: LIVE when a session starts, ENDED with the actual
 * times and attendance when it ends. Recurring series go back to SCHEDULED while occurrences remain.
 */
export async function syncFromSession(s: {
  orgId: string; id: string; scheduledMeetingId: string | null; status: 'active' | 'ended'; startedAt: number; endedAt: number | null;
  participants: Array<{ name: string; email: string; userId: string | null; role: string; joinedAt: number | null; secondsIn: number }>;
}) {
  if (!s.scheduledMeetingId) return;
  const st = await getDocStore();
  const path = `${scheduledPath(s.orgId)}/${assertId(s.scheduledMeetingId)}`;
  try {
    await st.transaction(async (tx) => {
      const m = await tx.get(path);
      if (!m || m.status === 'CANCELLED') return;
      const sessionIds: string[] = Array.isArray(m.sessionIds) ? m.sessionIds : [];
      const patch: Record<string, any> = { updatedAt: new Date().toISOString() };
      if (!sessionIds.includes(s.id)) patch.sessionIds = [...sessionIds, s.id].slice(-100);
      if (s.status === 'active') {
        patch.status = 'LIVE';
        if (!m.actualStart || (m.lastSessionId && m.lastSessionId !== s.id)) patch.actualStart = new Date(s.startedAt).toISOString();
        patch.actualEnd = null;
        patch.lastSessionId = s.id;
      } else {
        const end = s.endedAt ?? Date.now();
        patch.actualStart = m.actualStart || new Date(s.startedAt).toISOString();
        patch.actualEnd = new Date(end).toISOString();
        patch.status = nextOccurrence(m, end) && m.recurrence?.frequency && m.recurrence.frequency !== 'none' ? 'SCHEDULED' : 'ENDED';
        patch.participants = s.participants.filter((p) => p.joinedAt != null).map((p) => ({
          name: p.name, email: p.email, userId: p.userId, role: p.role, minutes: Math.round(p.secondsIn / 60),
        }));
      }
      tx.update(path, patch);
    });
  } catch (e) {
    console.warn('[greet] could not sync the scheduled meeting:', (e as Error)?.name || 'error');
  }
}
