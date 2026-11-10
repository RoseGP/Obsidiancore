/**
 * AI Command Center: pure functions that turn the organization's records into the dashboard's
 * priority cards, meeting agenda, headline KPIs and greeting. Nothing here invents data: every item
 * points at a real record, and anything that can't be computed is left out or reported as null.
 */
import {
  type DashboardData, type DashboardDeal, type DashboardLead, formatValue, isOpenDeal, relativeTime,
} from './dashboardMetrics';

const HOUR = 3_600_000;
const DAY = 86_400_000;
const ts = (v?: string | null) => { const t = v ? Date.parse(v) : NaN; return Number.isFinite(t) ? t : null; };
const money = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

// ---------------------------------------------------------------------------
// Inputs beyond the core CRM records
// ---------------------------------------------------------------------------
export interface CcProposal { id: string; number?: string; title?: string; client?: { name?: string; company?: string }; status: string; sentAt?: string | null; viewedAt?: string | null; validUntil?: string | null; updatedAt?: string; totals?: { total?: number }; currency?: string }
export interface CcMeeting { id: string; title: string; guests?: string[]; roomCode?: string; status?: string; duration?: number; occurrences?: { startTime: string; endTime: string }[]; startTime?: string; endTime?: string; additionalNotes?: string }
export interface CcCalendarEvent { id: string; title: string; date?: string; time?: string; start?: string; contactName?: string; type?: string }
export interface CcConversation { id: string; title: string; channel: string; status?: string; priority?: string; unreadCount?: number; updatedAt?: string; lastMessage?: { senderType?: string; senderName?: string; content?: string; createdAt?: string } | null; participants?: { name?: string; role?: string }[] }
export interface CcService { unansweredCount?: number | null; missedCalls?: { count: number | null; windowHours?: number } | null }

export interface CommandCenterInput extends DashboardData {
  proposals?: CcProposal[];
  meetings?: CcMeeting[];
  events?: CcCalendarEvent[];
  conversations?: CcConversation[];
  service?: CcService | null;
}

// ---------------------------------------------------------------------------
// Needs your attention
// ---------------------------------------------------------------------------
export type Priority = 'high' | 'medium' | 'low';
export type AttentionAction =
  | { type: 'navigate'; view: string; label: string }
  | { type: 'join'; roomCode: string; label: string }
  | { type: 'reply'; conversationId: string; label: string };

export interface AttentionItem {
  id: string;
  kind: 'lead' | 'message' | 'call' | 'meeting' | 'deal' | 'follow_up' | 'proposal' | 'ticket';
  priority: Priority;
  name: string;          // contact or company
  title: string;         // what it is
  description: string;   // brief context
  nextAction: string;    // recommended next step
  timeLabel: string;     // time sensitivity
  sortKey: number;       // lower = more urgent
  action: AttentionAction;
}

const PRIORITY_RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2 };
const isVisitor = (t?: string) => t === 'visitor' || t === 'contact' || t === 'customer';

function minutesUntil(t: number, now: number) {
  const m = Math.round((t - now) / 60_000);
  if (m <= 0) return 'Now';
  if (m < 60) return `In ${m} min`;
  const h = Math.floor(m / 60);
  return h < 24 ? `In ${h} h ${m % 60 ? `${m % 60} min` : ''}`.trim() : `In ${Math.round(h / 24)} days`;
}

/** Priority cards from real records, most urgent first. */
export function buildAttention(input: CommandCenterInput, now: number = Date.now()): AttentionItem[] {
  const out: AttentionItem[] = [];

  // Upcoming meetings in the next 3 hours (or happening now).
  for (const ev of upcomingMeetings(input, now, 3 * HOUR)) {
    const startsIn = ev.start - now;
    out.push({
      id: `meeting:${ev.id}`, kind: 'meeting', priority: startsIn <= 30 * 60_000 ? 'high' : 'medium',
      name: ev.contact || 'Your team', title: ev.title, description: `${ev.typeLabel} · ${ev.timeLabel}`,
      nextAction: ev.roomCode ? 'Join on time and open your notes.' : 'Get ready for this meeting.',
      timeLabel: ev.live ? 'Happening now' : minutesUntil(ev.start, now), sortKey: ev.start - now,
      action: ev.roomCode ? { type: 'join', roomCode: ev.roomCode, label: 'Join' } : { type: 'navigate', view: 'calendar', label: 'Open' },
    });
  }

  // Unanswered inbox conversations: the last message is from the customer.
  for (const c of input.conversations || []) {
    if (c.status === 'resolved' || c.status === 'closed' || !c.lastMessage || !isVisitor(c.lastMessage.senderType)) continue;
    const at = ts(c.lastMessage.createdAt) ?? ts(c.updatedAt) ?? now;
    const waited = now - at;
    out.push({
      id: `message:${c.id}`, kind: 'message', priority: waited > 2 * HOUR || c.priority === 'urgent' || c.priority === 'high' ? 'high' : 'medium',
      name: c.lastMessage.senderName || c.title, title: 'Unanswered message',
      description: (c.lastMessage.content || '').slice(0, 120) || 'New message',
      nextAction: 'Reply so the customer isn’t left waiting.', timeLabel: `Waiting ${relativeTime(new Date(at).toISOString(), now).replace(' ago', '').toLowerCase()}`,
      sortKey: -waited, action: { type: 'reply', conversationId: c.id, label: 'Reply' },
    });
  }

  // Missed calls (voicemails) and unanswered WhatsApp/SMS, as counted by the server.
  const missed = input.service?.missedCalls?.count ?? 0;
  if (missed > 0) {
    out.push({
      id: 'calls:missed', kind: 'call', priority: 'high', name: `${missed} caller${missed === 1 ? '' : 's'}`,
      title: 'Missed calls', description: `${missed} voicemail${missed === 1 ? '' : 's'} in the last ${input.service?.missedCalls?.windowHours ?? 24} hours.`,
      nextAction: 'Listen and call back.', timeLabel: 'Last 24 hours', sortKey: -12 * HOUR,
      action: { type: 'navigate', view: 'voice_dialer', label: 'Listen' },
    });
  }

  // High-scoring leads nobody has contacted yet.
  const hot = input.leads.filter((l) => (l.status === 'new' || !l.status) && Number(l.score) >= 70)
    .sort((a, b) => Number(b.score) - Number(a.score)).slice(0, 4);
  for (const l of hot) {
    const age = now - (ts(l.createdAt) ?? now);
    out.push({
      id: `lead:${l.id}`, kind: 'lead', priority: age < DAY ? 'high' : 'medium',
      name: l.name || l.company || 'New lead', title: `High-priority lead · score ${l.score}`,
      description: [l.company, l.source && `via ${l.source}`].filter(Boolean).join(' · ') || 'Not contacted yet',
      nextAction: 'Reach out today while interest is high.', timeLabel: `Arrived ${relativeTime(l.createdAt, now).toLowerCase()}`,
      sortKey: -age / 4, action: { type: 'navigate', view: 'leads', label: 'Contact' },
    });
  }

  // Overdue follow-ups: contacted leads with no update for 7+ days.
  const overdue = input.leads.filter((l) => l.status === 'contacted' && (ts((l as any).updatedAt) ?? ts(l.createdAt) ?? now) < now - 7 * DAY);
  if (overdue.length) {
    const first = overdue[0];
    out.push({
      id: 'followups:overdue', kind: 'follow_up', priority: overdue.length >= 5 ? 'high' : 'medium',
      name: overdue.length === 1 ? first.name || 'A lead' : `${overdue.length} leads`, title: 'Follow-ups overdue',
      description: overdue.length === 1 ? `Contacted, no update since ${relativeTime((first as any).updatedAt || first.createdAt, now).toLowerCase()}.` : `Contacted but not updated for 7+ days, e.g. ${first.name}.`,
      nextAction: 'Send a follow-up or update their status.', timeLabel: '7+ days', sortKey: 6 * HOUR,
      action: { type: 'navigate', view: 'leads', label: 'Follow up' },
    });
  }

  // Deals needing attention: open and untouched for 14+ days, biggest first.
  const stalled = input.deals.filter((d) => isOpenDeal(d) && (ts(d.updatedAt) ?? ts(d.createdAt) ?? now) < now - 14 * DAY)
    .sort((a, b) => money(b.value) - money(a.value)).slice(0, 2);
  for (const d of stalled) {
    out.push({
      id: `deal:${d.id}`, kind: 'deal', priority: money(d.value) >= 10_000 ? 'high' : 'medium',
      name: d.client || d.name || 'Deal', title: `Deal stalled: ${d.name}`,
      description: `${formatValue(money(d.value), 'currency')} in ${d.stage}, no change since ${relativeTime(d.updatedAt || d.createdAt, now).toLowerCase()}.`,
      nextAction: 'Agree the next step or move it forward.', timeLabel: '14+ days idle', sortKey: 12 * HOUR,
      action: { type: 'navigate', view: 'deals', label: 'Review' },
    });
  }

  // Proposals sent and waiting 3+ days, or about to expire.
  for (const p of input.proposals || []) {
    if (p.status !== 'sent' && p.status !== 'viewed') continue;
    const sent = ts(p.sentAt) ?? ts(p.updatedAt) ?? now;
    const expires = p.validUntil ? ts(`${p.validUntil}T23:59:59`) : null;
    const expiringSoon = expires !== null && expires > now && expires - now < 3 * DAY;
    if (now - sent < 3 * DAY && !expiringSoon) continue;
    out.push({
      id: `proposal:${p.id}`, kind: 'proposal', priority: expiringSoon ? 'high' : 'medium',
      name: p.client?.company || p.client?.name || 'Client', title: `Proposal ${p.number || ''} ${p.status === 'viewed' ? 'viewed, not signed' : 'awaiting response'}`.replace(/\s+/g, ' ').trim(),
      description: `${p.title || 'Proposal'}${p.totals?.total ? ` · ${formatValue(p.totals.total / 100, 'currency', p.currency || 'USD')}` : ''}`,
      nextAction: p.status === 'viewed' ? 'They opened it: follow up to close.' : 'Check in to keep it moving.',
      timeLabel: expiringSoon ? `Expires ${relativeTime(new Date(expires!).toISOString(), now) === 'Just now' ? 'today' : new Date(expires!).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : `Sent ${relativeTime(new Date(sent).toISOString(), now).toLowerCase()}`,
      sortKey: expiringSoon ? 2 * HOUR : 10 * HOUR, action: { type: 'navigate', view: 'proposals', label: 'Open proposal' },
    });
  }

  // Critical support tickets.
  for (const t of input.tickets.filter((x) => x.status !== 'resolved' && x.priority === 'critical').slice(0, 2)) {
    out.push({
      id: `ticket:${t.id}`, kind: 'ticket', priority: 'high', name: t.customerName || 'Customer', title: 'Critical ticket open',
      description: t.subject || 'Support ticket', nextAction: 'Respond and resolve it.', timeLabel: `Opened ${relativeTime(t.createdAt, now).toLowerCase()}`,
      sortKey: -(now - (ts(t.createdAt) ?? now)), action: { type: 'navigate', view: 'dashboard#work-queues', label: 'Open ticket' },
    });
  }

  return out.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.sortKey - b.sortKey);
}

// ---------------------------------------------------------------------------
// Upcoming meetings
// ---------------------------------------------------------------------------
export interface AgendaItem {
  id: string; title: string; contact: string; start: number; end: number; live: boolean;
  typeLabel: string; timeLabel: string; dayLabel: string; roomCode?: string; source: 'meeting' | 'calendar';
}

function dayLabel(t: number, now: number) {
  const d0 = new Date(now); d0.setHours(0, 0, 0, 0);
  const diff = Math.floor((t - d0.getTime()) / DAY);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  return new Date(t).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}
const clock = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

/** Scheduled meetings (every occurrence of recurring ones) and calendar events from now until `horizon`. */
export function upcomingMeetings(input: Pick<CommandCenterInput, 'meetings' | 'events'>, now: number = Date.now(), horizon = 14 * DAY): AgendaItem[] {
  const items: AgendaItem[] = [];
  for (const m of input.meetings || []) {
    if (m.status === 'CANCELLED' || m.status === 'cancelled') continue;
    const occ = m.occurrences?.length ? m.occurrences : m.startTime ? [{ startTime: m.startTime, endTime: m.endTime || m.startTime }] : [];
    occ.forEach((o, i) => {
      const start = ts(o.startTime); const end = ts(o.endTime) ?? (start !== null ? start + (m.duration || 30) * 60_000 : null);
      if (start === null || end === null || end < now || start > now + horizon) return;
      items.push({
        id: `${m.id}:${i}`, title: m.title, contact: (m.guests || [])[0] || '', start, end, live: start <= now && now < end,
        typeLabel: (m.guests || []).length ? `Video meeting · ${(m.guests || []).length + 1} people` : 'Video meeting',
        timeLabel: `${clock(start)} – ${clock(end)}`, dayLabel: dayLabel(start, now), roomCode: m.roomCode, source: 'meeting',
      });
    });
  }
  for (const e of input.events || []) {
    const start = ts(e.start) ?? ts(e.date ? `${e.date}T${e.time || '09:00'}` : null);
    if (start === null || start < now - HOUR || start > now + horizon) continue;
    items.push({
      id: `event:${e.id}`, title: e.title, contact: e.contactName || '', start, end: start + 30 * 60_000, live: false,
      typeLabel: e.type || 'Calendar event', timeLabel: clock(start), dayLabel: dayLabel(start, now), source: 'calendar',
    });
  }
  return items.sort((a, b) => a.start - b.start);
}

// ---------------------------------------------------------------------------
// Headline KPIs
// ---------------------------------------------------------------------------
export interface HeadlineKpi {
  id: 'contacts' | 'new_today' | 'open_deals' | 'pipeline' | 'forecast';
  label: string;
  value: string;
  raw: number;
  change: { text: string; direction: 'up' | 'down' | 'flat'; good: boolean | null } | null;
  compareLabel: string;
  series: number[];     // last 14 days
  hint: string;
  view: string;
}

const PROB: Record<string, number> = { lead: 20, discovery: 30, qualified: 50, proposal: 70, negotiation: 85, won: 100, lost: 0 };
const prob = (d: DashboardDeal) => (Number.isFinite(Number((d as any).probability)) ? Number((d as any).probability) : PROB[d.stage || ''] ?? 0);

function dailySeries<T>(rows: T[], at: (r: T) => string | undefined, val: (r: T) => number, now: number, days = 14) {
  const end = new Date(now); end.setHours(0, 0, 0, 0);
  const start = end.getTime() - (days - 1) * DAY;
  const s = new Array(days).fill(0);
  for (const r of rows) { const t = ts(at(r)); if (t === null || t < start) continue; const i = Math.floor((t - start) / DAY); if (i >= 0 && i < days) s[i] += val(r); }
  return s;
}

function pct(cur: number, prev: number): HeadlineKpi['change'] {
  if (prev === 0) return cur === 0 ? { text: 'No change', direction: 'flat', good: null } : null;
  const p = ((cur - prev) / prev) * 100;
  if (Math.abs(p) < 0.5) return { text: 'No change', direction: 'flat', good: null };
  return { text: `${Math.abs(p) >= 10 ? Math.round(Math.abs(p)) : Math.abs(p).toFixed(1)}%`, direction: p > 0 ? 'up' : 'down', good: p > 0 };
}
function added(n: number, fmt: (v: number) => string): HeadlineKpi['change'] {
  return n === 0 ? { text: 'None added', direction: 'flat', good: null } : { text: `+${fmt(n)}`, direction: 'up', good: true };
}

export function headlineKpis(data: DashboardData, now: number = Date.now()): HeadlineKpi[] {
  const today0 = new Date(now); today0.setHours(0, 0, 0, 0);
  const t0 = today0.getTime();
  const weekAgo = now - 7 * DAY;
  const inRange = (v: string | undefined, a: number, b: number) => { const t = ts(v); return t !== null && t >= a && t < b; };

  const leads = data.leads;
  const contactsBefore = leads.filter((l) => (ts(l.createdAt) ?? 0) < weekAgo).length;
  const newToday = leads.filter((l) => inRange(l.createdAt, t0, t0 + DAY)).length;
  const newYesterday = leads.filter((l) => inRange(l.createdAt, t0 - DAY, t0)).length;
  const open = data.deals.filter(isOpenDeal);
  const openAddedWeek = open.filter((d) => (ts(d.createdAt) ?? 0) >= weekAgo);
  const pipeline = open.reduce((s, d) => s + money(d.value), 0);
  const forecast = open.reduce((s, d) => s + money(d.value) * prob(d) / 100, 0);
  const cur = (v: number) => formatValue(v, 'currency');

  let running = leads.filter((l) => (ts(l.createdAt) ?? 0) < t0 - 13 * DAY).length;
  const contactsSeries = dailySeries(leads, (l) => l.createdAt, () => 1, now).map((n) => (running += n));

  return [
    {
      id: 'contacts', label: 'Total contacts', value: leads.length.toLocaleString(), raw: leads.length,
      change: pct(leads.length, contactsBefore), compareLabel: 'vs 7 days ago', series: contactsSeries,
      hint: 'Everyone in your CRM (leads and customers). Compared with how many you had a week ago.', view: 'leads',
    },
    {
      id: 'new_today', label: 'New leads today', value: newToday.toLocaleString(), raw: newToday,
      change: pct(newToday, newYesterday), compareLabel: 'vs yesterday', series: dailySeries(leads, (l) => l.createdAt, () => 1, now),
      hint: 'Leads created since midnight, from every channel. The line shows the last 14 days.', view: 'leads',
    },
    {
      id: 'open_deals', label: 'Open deals', value: open.length.toLocaleString(), raw: open.length,
      change: added(openAddedWeek.length, (n) => String(n)), compareLabel: 'added this week',
      series: dailySeries(data.deals, (d) => d.createdAt, () => 1, now),
      hint: 'Deals not yet won or lost. "Added this week" counts open deals created in the last 7 days.', view: 'deals',
    },
    {
      id: 'pipeline', label: 'Pipeline value', value: cur(pipeline), raw: pipeline,
      change: added(openAddedWeek.reduce((s, d) => s + money(d.value), 0), cur), compareLabel: 'added this week',
      series: dailySeries(open, (d) => d.createdAt, (d) => money(d.value), now),
      hint: 'Total value of all open deals.', view: 'deals',
    },
    {
      id: 'forecast', label: 'Weighted forecast', value: cur(forecast), raw: forecast,
      change: added(openAddedWeek.reduce((s, d) => s + money(d.value) * prob(d) / 100, 0), cur), compareLabel: 'added this week',
      series: dailySeries(open, (d) => d.createdAt, (d) => money(d.value) * prob(d) / 100, now),
      hint: 'Each open deal’s value × its stage probability (Lead 20%, Discovery 30%, Qualified 50%, Proposal 70%, Negotiation 85%).', view: 'deals',
    },
  ];
}

// ---------------------------------------------------------------------------
// Greeting
// ---------------------------------------------------------------------------
/** One line about the business right now, from the records (no AI call, nothing invented). */
export function greetingLine(input: CommandCenterInput, attention: AttentionItem[], now: number = Date.now()): string {
  const today0 = new Date(now); today0.setHours(0, 0, 0, 0);
  const newToday = input.leads.filter((l) => (ts(l.createdAt) ?? 0) >= today0.getTime()).length;
  const next = upcomingMeetings(input, now, DAY)[0];
  const high = attention.filter((a) => a.priority === 'high').length;
  const parts: string[] = [];
  if (high) parts.push(`${high} high-priority item${high === 1 ? '' : 's'} need${high === 1 ? 's' : ''} you`);
  if (newToday) parts.push(`${newToday} new lead${newToday === 1 ? '' : 's'} today`);
  if (next) parts.push(next.live ? `“${next.title}” is happening now` : `next meeting “${next.title}” ${minutesUntil(next.start, now).toLowerCase()}`);
  if (!parts.length) {
    if (!input.leads.length && !input.deals.length) return 'Your workspace is ready. Add your first lead or ask your copilot where to start.';
    return 'Nothing urgent right now. A good moment to follow up with your best prospects.';
  }
  const s = parts.join(', ');
  return `${s.charAt(0).toUpperCase()}${s.slice(1)}.`;
}

export type { DashboardLead };

// ---------------------------------------------------------------------------
// Business insights beyond lib/dashboardMetrics' buildInsights (same rule: only what the records show)
// ---------------------------------------------------------------------------
export interface CcInsight { id: string; tone: 'positive' | 'warning' | 'info'; title: string; detail: string; action?: { label: string; view: string }; ask?: string }

export function commandCenterInsights(input: CommandCenterInput, now: number = Date.now()): CcInsight[] {
  const out: CcInsight[] = [];
  const likely = input.leads.filter((l) => l.status !== 'converted' && !(l as any).isConverted && Number(l.score) >= 60)
    .sort((a, b) => Number(b.score) - Number(a.score)).slice(0, 3);
  if (likely.length) {
    out.push({
      id: 'likely_convert', tone: 'positive', title: `${likely.length === 1 ? 'Lead' : `${likely.length} leads`} most likely to convert`,
      detail: likely.map((l) => `${l.name}${l.score ? ` (${l.score})` : ''}`).join(', '),
      action: { label: 'Open leads', view: 'leads' },
      ask: `Which of my leads are most likely to convert, and what should I do next with ${likely[0].name}?`,
    });
  }
  const late = input.deals.filter((d) => d.stage === 'proposal' || d.stage === 'negotiation');
  if (late.length) {
    const v = late.reduce((s, d) => s + money(d.value), 0);
    out.push({
      id: 'revenue_opportunity', tone: 'positive', title: `${formatValue(v, 'currency')} in late-stage deals`,
      detail: `${late.length} deal${late.length === 1 ? '' : 's'} at proposal or negotiation. Closing these moves revenue fastest.`,
      action: { label: 'View deals', view: 'deals' },
      ask: 'Which of my deals at proposal or negotiation stage are likely to close this week, and what is blocking the others?',
    });
  }
  const unanswered = input.service?.unansweredCount ?? null;
  if (unanswered !== null && unanswered > 0) {
    out.push({
      id: 'unanswered_trend', tone: 'warning', title: `${unanswered} message${unanswered === 1 ? '' : 's'} waiting for a reply`,
      detail: 'Fast replies convert better. Clear the queue or let the copilot draft replies.',
      action: { label: 'Open inbox', view: 'messages' }, ask: 'Summarize today’s customer conversations and draft replies for the unanswered ones.',
    });
  }
  const idle = input.leads.filter((l) => l.status !== 'converted' && (ts((l as any).updatedAt) ?? ts(l.createdAt) ?? now) < now - 30 * DAY);
  if (idle.length >= 3) {
    out.push({
      id: 'reconnect', tone: 'info', title: `${idle.length} contacts gone quiet for 30+ days`,
      detail: 'A short check-in often revives stalled interest.', action: { label: 'Open leads', view: 'leads' },
      ask: 'Draft short re-engagement messages for my leads that have been inactive for over 30 days.',
    });
  }
  return out;
}
