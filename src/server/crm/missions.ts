/**
 * Personal daily missions for the dashboard, computed from the organization's real records.
 *
 * A mission is shown only when it can be measured from data that exists, and its target never
 * exceeds the work actually available (available + already done today). Progress counts the
 * caller's own actions since their local midnight (`dayStart`), matched by user id where the
 * record stores one (scheduled meetings, proposals, voicemail review) and by the activity log's
 * `actor` (tenant name || email || user id, as routes write it) for lead status changes.
 *
 * The day's result is stored per user so streaks, total XP and badges come from history:
 *   organizations/{orgId}/mission_days/{userKey}__{date}   { userKey, date, completed, total, xp, updatedAt }
 * (userKey = sha256(userId) prefix: user ids may contain characters that aren't valid in a path.)
 */
import crypto from 'node:crypto';
import { CrmRepository } from './crmRepository';
import { assertId, getDocStore } from '../data/docStore';
import { listProposals } from '../../features/proposals/server/proposals';

const DAY = 86_400_000;

export interface Mission {
  id: string;
  title: string;
  description: string;
  target: number;
  progress: number;
  done: boolean;
  xp: number;
  action: { label: string; view: 'leads' | 'deals' | 'proposals' | 'calendar' | 'voice_dialer' | 'messages' };
}
export interface Badge { id: string; label: string; description: string; earned: boolean }
export interface MissionDay { date: string; completed: number; total: number; xp: number }

export interface MissionInput {
  me: { userId: string; actor: string };
  dayStart: number;
  leads: any[];
  /** Per-lead activity entries (only needed for leads updated since dayStart). */
  leadActivities: Record<string, any[]>;
  /** Organization activity feed entries since dayStart (bulk status updates are logged here). */
  orgActivities: any[];
  proposals: any[];
  scheduledMeetings: any[];
  voicemails: any[];
}

const ts = (v: unknown) => { const t = typeof v === 'string' ? Date.parse(v) : NaN; return Number.isFinite(t) ? t : null; };
const since = (v: unknown, start: number) => { const t = ts(v); return t !== null && t >= start; };

/** "Status Changed: new → qualified" → { from: 'new', to: 'qualified' } */
function parseStatusChange(title: unknown): { from: string; to: string } | null {
  const m = typeof title === 'string' ? title.match(/Status Changed:\s*(\S+)\s*→\s*(\S+)/) : null;
  return m ? { from: m[1], to: m[2] } : null;
}

/** Leads I moved to `status` today: per-lead status_changed entries plus bulk updates from the org feed. */
function movedToday(input: MissionInput, status: string, filter?: (lead: any, acts: any[], at: number) => boolean) {
  const ids = new Set<string>();
  for (const lead of input.leads) {
    const acts = input.leadActivities[lead.id] || [];
    for (const a of acts) {
      if (a.type !== 'status_changed' || a.actor !== input.me.actor || !since(a.timestamp, input.dayStart)) continue;
      const ch = parseStatusChange(a.title);
      if (ch?.to === status && (!filter || filter(lead, acts, ts(a.timestamp)!))) ids.add(lead.id);
    }
  }
  return ids.size;
}

function bulkMoved(input: MissionInput, status: string) {
  let n = 0;
  for (const a of input.orgActivities) {
    if (a.actor !== input.me.actor || !since(a.timestamp, input.dayStart)) continue;
    const m = typeof a.description === 'string' ? a.description.match(/Updated (\d+) leads? to status (\w+)/i) : null;
    if (a.title === 'Bulk Status Update' && m && m[2].toLowerCase() === status) n += Number(m[1]) || 0;
  }
  return n;
}

function mission(id: string, title: string, description: string, defaultTarget: number, available: number, progress: number, xp: number, action: Mission['action']): Mission | null {
  const target = Math.min(defaultTarget, available + progress);
  if (target <= 0) return null; // nothing to do and nothing done: not measurable today
  const p = Math.min(progress, target);
  return { id, title, description, target, progress: p, done: p >= target, xp, action };
}

export function computeMissions(input: MissionInput): Mission[] {
  const { leads, dayStart } = input;
  const open = (l: any) => !l.isConverted && l.status !== 'converted';
  const out: (Mission | null)[] = [];

  // 1. Qualify new leads.
  const qualified = movedToday(input, 'qualified') + bulkMoved(input, 'qualified');
  const newLeads = leads.filter((l) => open(l) && (l.status === 'new' || !l.status)).length;
  out.push(mission('qualify_leads', 'Qualify 5 new leads', 'Review new leads and mark the good ones Qualified.', 5, newLeads, qualified, 100, { label: 'Open leads', view: 'leads' }));

  // 2. Follow up with high-value prospects (score 70+), marked Contacted today.
  const hot = (l: any) => (Number(l.score) || 0) >= 70;
  const followed = movedToday(input, 'contacted', (l) => hot(l));
  const hotWaiting = leads.filter((l) => open(l) && hot(l) && (l.status === 'new' || !l.status)).length;
  out.push(mission('follow_up_high_value', 'Follow up with 3 high-value prospects', 'Contact leads scoring 70+ and mark them Contacted.', 3, hotWaiting, followed, 100, { label: 'Open leads', view: 'leads' }));

  // 3. Send outstanding proposals (mine, first shared today).
  const sent = input.proposals.filter((p) => p.createdBy === input.me.userId && since(p.sentAt, dayStart)).length;
  const drafts = input.proposals.filter((p) => p.createdBy === input.me.userId && p.status === 'draft').length;
  out.push(mission('send_proposals', 'Send 2 outstanding proposals', 'Share your draft proposals with clients.', 2, drafts, sent, 100, { label: 'Open proposals', view: 'proposals' }));

  // 4. Schedule customer meetings (scheduled by me today); available = prospects in conversation.
  const scheduled = input.scheduledMeetings.filter((m) => m.createdBy === input.me.userId && since(m.createdAt, dayStart)).length;
  const prospects = leads.filter((l) => open(l) && ['contacted', 'qualifying', 'qualified'].includes(l.status)).length;
  out.push(mission('schedule_meetings', 'Schedule 3 customer meetings', 'Book time with prospects you are talking to.', 3, prospects, scheduled, 100, { label: 'Open calendar', view: 'calendar' }));

  // 5. Review voicemails (only when the organization receives them).
  if (input.voicemails.length) {
    const reviewed = input.voicemails.filter((v) => v.reviewedBy === input.me.userId && since(v.reviewedAt, dayStart)).length;
    const unreviewed = input.voicemails.filter((v) => !v.reviewedAt).length;
    out.push(mission('review_voicemails', 'Review new voicemails', 'Listen to new voicemails and mark them reviewed.', 10, unreviewed, reviewed, 50, { label: 'Open phone', view: 'voice_dialer' }));
  }

  // 6. Reconnect with inactive contacts: leads untouched for 30+ days before I contacted them today.
  const inactiveBefore = (lead: any, acts: any[], at: number) => {
    const prior = acts.map((a) => ts(a.timestamp)).filter((t): t is number => t !== null && t < at);
    const last = Math.max(ts(lead.createdAt) ?? 0, ...prior);
    return at - last >= 30 * DAY;
  };
  const reconnected = movedToday(input, 'contacted', inactiveBefore);
  const inactive = leads.filter((l) => open(l) && (ts(l.updatedAt) ?? ts(l.createdAt) ?? Infinity) < dayStart - 30 * DAY).length;
  out.push(mission('reconnect_inactive', 'Reconnect with 3 inactive contacts', 'Reach out to leads nobody has touched in 30+ days and mark them Contacted.', 3, inactive, reconnected, 50, { label: 'Open leads', view: 'leads' }));

  return out.filter((m): m is Mission => !!m);
}

const prevDate = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) - DAY).toISOString().slice(0, 10);

/** Streaks, total XP and badges from stored days (today's result included). */
export function summarizeHistory(days: MissionDay[], today: string) {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const active = (d: string) => (byDate.get(d)?.completed ?? 0) >= 1;
  let current = 0;
  let cursor = active(today) ? today : prevDate(today);
  while (active(cursor)) { current++; cursor = prevDate(cursor); }
  let best = 0, run = 0, last: string | null = null;
  for (const d of [...days].filter((x) => x.completed >= 1).map((x) => x.date).sort()) {
    run = last && prevDate(d) === last ? run + 1 : 1;
    best = Math.max(best, run); last = d;
  }
  const totalXp = days.reduce((s, d) => s + (Number(d.xp) || 0), 0);
  const anyDone = days.some((d) => d.completed >= 1);
  const badges: Badge[] = [
    { id: 'first_mission', label: 'First mission', description: 'Complete your first daily mission.', earned: anyDone },
    { id: 'streak_3', label: '3-day streak', description: 'Complete a mission three days in a row.', earned: best >= 3 },
    { id: 'streak_7', label: '7-day streak', description: 'Complete a mission seven days in a row.', earned: best >= 7 },
    { id: 'streak_30', label: '30-day streak', description: 'Complete a mission thirty days in a row.', earned: best >= 30 },
    { id: 'xp_1000', label: '1,000 XP', description: 'Earn 1,000 XP from missions.', earned: totalXp >= 1000 },
  ];
  return { streak: { current, best }, totalXp, badges };
}

export class MissionInputError extends Error { status = 400; code = 'invalid_input'; }

/** Validates the caller's local date and local midnight. */
export function parseDay(date: unknown, dayStart: unknown, now = Date.now()): { date: string; dayStart: number } {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`))) throw new MissionInputError('date must be YYYY-MM-DD.');
  const t = typeof dayStart === 'string' ? Date.parse(dayStart) : NaN;
  if (!Number.isFinite(t) || Math.abs(now - t) > 36 * 3_600_000 || t > now) throw new MissionInputError('dayStart must be your local midnight today (an ISO time within the last 36 hours).');
  return { date, dayStart: t };
}

export const userKeyOf = (userId: string) => crypto.createHash('sha256').update(userId).digest('hex').slice(0, 24);

/** Loads the records, computes today's missions, stores the day and returns the full response body. */
export async function loadMissions(orgId: string, me: { userId: string; actor: string }, date: string, dayStart: number) {
  const st = await getDocStore();
  const repo = await CrmRepository.forOrg(orgId, st);
  const base = `organizations/${assertId(orgId)}`;
  const [leads, orgActs, proposals, scheduled, voicemails] = await Promise.all([
    repo.listLeads(),
    st.list(`${base}/activities`, { orderBy: 'timestamp', direction: 'desc', limit: 500 }),
    listProposals(orgId),
    st.list(`${base}/scheduled_meetings`),
    st.list(`${base}/voicemails`, { orderBy: 'at', direction: 'desc', limit: 500 }),
  ]);
  const leadActivities: Record<string, any[]> = {};
  await Promise.all(leads.filter((l) => since(l.updatedAt, dayStart) && typeof l.id === 'string').map(async (l) => {
    leadActivities[l.id] = await repo.listLeadActivities(l.id);
  }));
  const missions = computeMissions({
    me, dayStart, leads, leadActivities,
    orgActivities: orgActs.filter((a) => since(a.timestamp, dayStart)),
    proposals, scheduledMeetings: scheduled, voicemails,
  });
  const completedCount = missions.filter((m) => m.done).length;
  const xpToday = missions.filter((m) => m.done).reduce((s, m) => s + m.xp, 0);

  const userKey = userKeyOf(me.userId);
  await st.set(`${base}/mission_days/${userKey}__${date}`, { userKey, date, completed: completedCount, total: missions.length, xp: xpToday, updatedAt: new Date().toISOString() });
  const history = (await st.list(`${base}/mission_days`, { where: [['userKey', '==', userKey]] })) as MissionDay[];
  const { streak, totalXp, badges } = summarizeHistory(history, date);

  return {
    success: true as const, date, missions, completedCount, totalCount: missions.length,
    completionPct: missions.length ? Math.round((completedCount / missions.length) * 100) : 0,
    xpToday, totalXp, streak, badges,
  };
}
