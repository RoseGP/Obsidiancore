/**
 * Meeting analytics (per organization) and platform statistics (platform administrators).
 * Built from meeting_usage (one row per ended meeting) and meeting_active (running meetings).
 * TO SCALE: past ~100k meetings, keep daily aggregates (meeting_usage_daily/{date}) instead of scanning rows.
 */
import { getDocStore } from '../data/docStore';
import { getSubscription } from './plans';
import { MEETING_PLAN_TIERS, type MeetingPlanTier } from '../../lib/meetingPlans';

const DAY = 86_400_000;

function summarize(rows: any[]) {
  const n = rows.length;
  const minutes = rows.reduce((t, r) => t + (r.durationSeconds || 0), 0) / 60;
  return {
    meetings: n,
    totalMinutes: Math.round(minutes),
    averageMinutes: n ? Math.round(minutes / n) : 0,
    averageParticipants: n ? Math.round((rows.reduce((t, r) => t + (r.peakParticipants || 0), 0) / n) * 10) / 10 : 0,
    peakParticipants: rows.reduce((m, r) => Math.max(m, r.peakParticipants || 0), 0),
    endedAtTimeLimit: rows.filter((r) => r.endedReason === 'time_limit').length,
    recorded: rows.filter((r) => r.recordingUsed).length,
  };
}

export async function orgAnalytics(orgId: string, days = 30) {
  const st = await getDocStore();
  const since = Date.now() - days * DAY;
  const rows = (await st.list('meeting_usage', { where: [['orgId', '==', orgId]] })).filter((r) => (r.endedAt ?? 0) >= since);
  const byHost = new Map<string, { hostName: string; meetings: number; minutes: number }>();
  for (const r of rows) {
    const h = byHost.get(r.hostUserId) ?? { hostName: r.hostName, meetings: 0, minutes: 0 };
    h.meetings++; h.minutes += Math.round((r.durationSeconds || 0) / 60);
    byHost.set(r.hostUserId, h);
  }
  const perDay = new Map<string, number>();
  for (const r of rows) { const d = new Date(r.endedAt).toISOString().slice(0, 10); perDay.set(d, (perDay.get(d) || 0) + 1); }
  return {
    days,
    ...summarize(rows),
    byHost: [...byHost.entries()].map(([userId, v]) => ({ userId, ...v })).sort((a, b) => b.minutes - a.minutes).slice(0, 20),
    perDay: [...perDay.entries()].sort().map(([date, meetings]) => ({ date, meetings })),
    recent: rows.sort((a, b) => b.endedAt - a.endedAt).slice(0, 20).map((r) => ({
      id: r.id, title: r.title, hostName: r.hostName, endedAt: r.endedAt, minutes: Math.round(r.durationSeconds / 60),
      peakParticipants: r.peakParticipants, endedReason: r.endedReason,
    })),
  };
}

export async function activeMeetings(filter?: { orgId?: string }) {
  const st = await getDocStore();
  const rows = await st.list('meeting_active', filter?.orgId ? { where: [['orgId', '==', filter.orgId]] } : undefined);
  const now = Date.now();
  return rows
    .map((r) => ({ ...r, remainingSeconds: Math.max(0, Math.round((r.endsAt - now) / 1000)) }))
    .sort((a, b) => a.endsAt - b.endsAt);
}

export async function platformStats(days = 30) {
  const st = await getDocStore();
  const orgs = await st.list('organizations');
  const tiers: Record<MeetingPlanTier, number> = { free: 0, premium: 0, enterprise: 0 };
  for (const o of orgs) tiers[(await getSubscription(o.id, st)).tier]++;
  const since = Date.now() - days * DAY;
  const usage = (await st.list('meeting_usage')).filter((r) => (r.endedAt ?? 0) >= since);
  const byTier = Object.fromEntries(MEETING_PLAN_TIERS.map((t) => [t, summarize(usage.filter((r) => r.tier === t))]));
  const active = await activeMeetings();
  const pending = await st.list('subscription_requests', { where: [['status', '==', 'pending']] });
  return {
    days,
    organizations: orgs.length,
    subscriptionsByTier: tiers,
    activeMeetings: active.length,
    participantsInMeetings: active.reduce((t, m) => t + (m.participantCount || 0), 0),
    usage: summarize(usage),
    usageByTier: byTier,
    pendingRequests: pending.length,
  };
}
