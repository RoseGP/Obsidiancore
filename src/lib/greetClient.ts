/**
 * GREET in the browser: one place for the meetings API, so the calendar, the GREET page, quick actions and the
 * dialer all read and write the same server records (organizations/{org}/scheduled_meetings).
 *
 * Every write announces itself with the `greet:meetings-changed` window event; useServerMeetings() listens.
 */
import { useCallback, useEffect, useState } from 'react';
import type { CalendarEvent } from '../types';

export interface Occurrence { startTime: string; endTime: string }
export interface GreetMeeting {
  id: string; title: string; date: string; time: string; duration: number; timezone?: string;
  startTime: string; endTime: string; occurrences?: Occurrence[]; nextOccurrence?: Occurrence | null;
  status: 'SCHEDULED' | 'LIVE' | 'ENDED' | 'CANCELLED';
  roomCode: string; videoLink?: string; guests: string[];
  invitees: Array<{ userId: string; name: string; email: string }>;
  associations: { leadId?: string; dealId?: string; contactId?: string; companyId?: string; label?: string };
  hostId: string; hostName?: string; yourRole: 'host' | 'invitee' | 'member'; canEdit: boolean;
  additionalNotes?: string; locations?: string[]; actualStart?: string | null; actualEnd?: string | null;
  participants?: Array<{ name: string; role: string; minutes: number }>;
  outcome?: { result: string; summary: string; at: string; byName?: string } | null;
  recurrence?: { frequency: string; count: number };
  cancelReason?: string;
}
export interface HistoryItem {
  id: string; source: 'server' | 'imported' | 'device'; title: string; startedAt: number; endedAt?: number | null; minutes: number;
  hostName?: string; youHosted?: boolean; participants: Array<{ name: string; role?: string }>; scheduledMeetingId?: string | null;
  associations?: GreetMeeting['associations']; outcome?: GreetMeeting['outcome']; recordingUsed?: boolean; notes?: string;
}
export interface Hub { upcoming: GreetMeeting[]; invitations: GreetMeeting[]; history: HistoryItem[]; live: Array<{ id: string; title: string; roomCode: string; hostName: string; startedAt: number; participantCount: number; scheduledMeetingId: string | null }>; serverNow: number }

export class GreetApiError extends Error {
  constructor(message: string, public status: number, public code?: string, public data?: any) { super(message); }
}

export async function greetApi<T = any>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });
  } catch {
    throw new GreetApiError('Couldn\'t reach the server. Check your connection and try again.', 0, 'network');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.success === false) {
    const hint = data?.upgradeLabel ? ` The ${data.upgradeLabel} plan allows it.` : '';
    throw new GreetApiError((data?.error || 'Something went wrong. Try again.') + hint, res.status, data?.code, data);
  }
  return data as T;
}

export const MEETINGS_CHANGED = 'greet:meetings-changed';
export const announceMeetingsChanged = () => { try { window.dispatchEvent(new Event(MEETINGS_CHANGED)); } catch { /* not in a browser */ } };

export const browserTimezone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } };
const EMAIL_RE = /[^\s@,;<>()]+@[^\s@,;<>()]+\.[^\s@,;<>()]+/g;
export const emailsIn = (text?: string) => [...new Set(((text || '').match(EMAIL_RE) || []).map((e) => e.toLowerCase()))];

export interface ScheduleInput {
  title: string; date: string; time: string; duration: number; timezone?: string;
  guests?: string[]; inviteeIds?: string[]; associations?: GreetMeeting['associations'];
  additionalNotes?: string; locations?: string[]; recurrence?: { frequency: 'none' | 'daily' | 'weekly' | 'monthly'; count: number };
}

export async function scheduleMeeting(input: ScheduleInput) {
  const { associations, ...rest } = input;
  const clean = associations ? Object.fromEntries(Object.entries(associations).filter(([k, v]) => k !== 'label' && v)) : undefined;
  const r = await greetApi<{ meeting: GreetMeeting; message: string }>('/api/meetings/create', {
    method: 'POST', body: JSON.stringify({ timezone: browserTimezone(), ...rest, ...(clean && Object.keys(clean).length ? { associations: clean } : {}) }),
  });
  announceMeetingsChanged();
  return r;
}
export async function updateMeeting(id: string, patch: Partial<ScheduleInput>) {
  const r = await greetApi<{ meeting: GreetMeeting; message: string }>(`/api/meetings/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) });
  announceMeetingsChanged();
  return r;
}
export async function cancelMeeting(id: string, reason?: string) {
  const r = await greetApi<{ meeting: GreetMeeting; message: string }>(`/api/meetings/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) });
  announceMeetingsChanged();
  return r;
}
export async function recordOutcome(id: string, result: string, summary: string) {
  const r = await greetApi<{ meeting: GreetMeeting }>(`/api/meetings/${encodeURIComponent(id)}/outcome`, { method: 'POST', body: JSON.stringify({ result, summary }) });
  announceMeetingsChanged();
  return r;
}
export const getMeeting = (id: string) => greetApi<{ meeting: GreetMeeting; invites?: Array<{ id: string; email: string; name: string; expiresAt: string; revoked: boolean; lastUsedAt: string | null }>; invitesConfigured: boolean }>(`/api/meetings/${encodeURIComponent(id)}`);
/** Links come back absolute when the server knows APP_URL; otherwise they're made absolute with this site's origin. */
export const absoluteLink = (link: string) => (/^https?:\/\//.test(link) ? link : `${typeof window !== 'undefined' ? window.location.origin : ''}${link.startsWith('/') ? '' : '/'}${link}`);
export const createInvites = async (id: string, guests?: Array<{ email: string; name?: string }>) => {
  const r = await greetApi<{ invites: Array<{ id: string; email: string; name: string; link: string; expiresAt: string }>; message: string }>(`/api/meetings/${encodeURIComponent(id)}/invites`, { method: 'POST', body: JSON.stringify(guests ? { guests } : {}) });
  return { ...r, invites: r.invites.map((i) => ({ ...i, link: absoluteLink(i.link) })) };
};
export const revokeInvite = (id: string, inviteId: string) => greetApi(`/api/meetings/${encodeURIComponent(id)}/invites/${encodeURIComponent(inviteId)}`, { method: 'DELETE' });
export const getHub = () => greetApi<Hub>('/api/meetings/hub');
export const listMeetings = () => greetApi<{ meetings: GreetMeeting[] }>('/api/meetings');

/**
 * Follow-up task after a meeting. Today it's a task on the linked lead (POST /api/leads/:id/tasks); when the
 * unified tasks API lands this is the only function that changes.
 */
/** A follow-up task from a meeting, on the organization's one task list (linked to the meeting and its CRM records). */
export async function createFollowUpTask(input: { leadId?: string; contactId?: string; dealId?: string; title: string; dueDate?: string; notes?: string; meetingId?: string }) {
  const { createFollowUpTask: create } = await import('./tasksClient');
  return create({ title: input.title, dueAt: input.dueDate || null, description: input.notes, leadId: input.leadId, contactId: input.contactId, dealId: input.dealId, meetingId: input.meetingId });
}

/** A local calendar entry (old forms, the dialer, quick actions) → a server schedule request. */
export function scheduleFromCalendarEvent(ev: Partial<CalendarEvent> & { title?: string }): ScheduleInput | null {
  const raw = String(ev.time || '');
  const dm = (ev.date && /^\d{4}-\d{2}-\d{2}$/.test(ev.date) ? ev.date : (raw.match(/\d{4}-\d{2}-\d{2}/) || [])[0]) || '';
  const tm = (raw.replace(dm, '').match(/\b(\d{1,2}:\d{2})\s*(AM|PM)?/i) || []);
  if (!dm || !tm[1] || !ev.title?.trim()) return null;
  const time = tm[2] ? `${tm[1]} ${tm[2].toUpperCase()}` : tm[1].padStart(5, '0');
  const notes = [ev.notes, ev.contact && !emailsIn(ev.contact).length ? `With: ${ev.contact}` : ''].filter(Boolean).join('\n');
  return {
    title: ev.title.trim().slice(0, 200), date: dm, time, duration: Math.max(5, Math.min(1440, Number(ev.duration) || 30)),
    guests: emailsIn(`${ev.invitees || ''} ${ev.contact || ''}`), additionalNotes: notes.slice(0, 5000),
    ...(ev.location ? { locations: [String(ev.location).slice(0, 120)] } : {}),
  };
}

/** A server meeting → the calendar's event shape (id = meeting id, so nothing is shown twice). */
export function meetingToCalendarEvent(m: GreetMeeting): CalendarEvent & { serverMeeting: true; startTime: string; greetStatus: GreetMeeting['status'] } {
  const occ = m.nextOccurrence || { startTime: m.startTime, endTime: m.endTime };
  const start = new Date(occ.startTime);
  const pad = (n: number) => String(n).padStart(2, '0');
  const localDate = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`;
  return {
    id: m.id, title: m.title, time: `${localDate} ${pad(start.getHours())}:${pad(start.getMinutes())}`, date: localDate,
    type: 'demo', contact: m.associations?.label || (m.invitees || []).map((i) => i.name).join(', ') || (m.guests || []).join(', ') || 'GREET meeting',
    status: m.status === 'CANCELLED' ? 'cancelled' : m.status === 'ENDED' ? 'completed' : 'upcoming',
    meetingLink: m.videoLink, invitees: [...(m.invitees || []).map((i) => i.name), ...(m.guests || [])].join(', '),
    notes: m.additionalNotes, location: 'GREET', duration: m.duration, serverMeeting: true, startTime: occ.startTime, greetStatus: m.status,
  };
}

/** The organization's GREET meetings, refreshed whenever any part of the app changes them. */
export function useServerMeetings(enabled = true) {
  const [meetings, setMeetings] = useState<GreetMeeting[]>([]);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'offline' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    if (!enabled) return;
    setState((s) => (s === 'ready' ? s : 'loading'));
    try { const r = await listMeetings(); setMeetings(r.meetings || []); setState('ready'); setError(null); }
    catch (e) { const err = e as GreetApiError; setState(err.code === 'network' ? 'offline' : 'error'); setError(err.message); }
  }, [enabled]);
  useEffect(() => {
    refresh();
    const on = () => { refresh(); };
    window.addEventListener(MEETINGS_CHANGED, on);
    return () => window.removeEventListener(MEETINGS_CHANGED, on);
  }, [refresh]);
  return { meetings, state, error, refresh };
}

export const relWhen = (iso: string, now = Date.now()) => {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  const sameDay = new Date(now).toDateString() === d.toDateString();
  const tomorrow = new Date(now + 86_400_000).toDateString() === d.toDateString();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return `Today, ${time}`;
  if (tomorrow) return `Tomorrow, ${time}`;
  return `${d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}, ${time}`;
};
