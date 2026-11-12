/**
 * GREET: the CRM's video meetings home (the `greet` view), laid out as the Greet Hub:
 *   Greet Portal        start (with a camera/mic check), join, schedule; invitations, agenda, live meetings, plan
 *   Call Canvas Studio  the phone dialer / IVR / call workspace (CRMVoiceDialer)
 *   Recordings & Vault  cloud recordings (LiveKit Egress) and recordings/transcripts saved in this browser
 *   Schedule            upcoming meetings, invitations and history, with invitation links, reschedule, cancel, outcome
 *
 * Everything shared comes from the server:
 *   GET /api/meetings/hub        upcoming, invitations, history, live
 *   /api/meetings/*              schedule, reschedule, cancel, outcome, guest invitation links
 *   /api/meetings/subscription   the organization's plan (limits are enforced by the server when a meeting starts)
 *   /api/greet/recordings|settings  cloud recordings and recording settings; whether LiveKit is configured
 * Meeting history that older versions kept in this browser is shown as "on this device" until it's moved
 * to the server (POST /api/meetings/history/import).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Video, VideoOff, CalendarPlus, CalendarDays, LogIn, Users, Clock, Copy, X, Check, AlertTriangle, Radio, History as HistoryIcon,
  Mail, Trash2, Download, Settings2, CalendarClock, ListChecks, Repeat, Camera, Mic, MicOff, ChevronRight, Disc, UploadCloud,
  Sparkles, PhoneCall, Search, Home, ArrowRight, Play, FileText, Save, Shield, Plus, Lock, RefreshCw, Activity, Gauge,
} from 'lucide-react';
import { Badge, Button, Card, CardHeader, EmptyState, IconButton, Segmented, Skeleton, cx, focusRing } from '../dashboard/ui';
import { useMeetingSession, type MeetingHistoryRecord } from '../../context/MeetingSessionContext';
import { useNotifications } from '../../context/NotificationContext';
import { useTeamMembers } from '../../hooks/useTeamMembers';
import CRMVoiceDialer from '../CRMVoiceDialer';
import type { CRMContact } from '../../types';
import {
  GreetApiError, absoluteLink, cancelMeeting, createFollowUpTask, createInvites, getHub, getMeeting, greetApi, recordOutcome, relWhen, revokeInvite,
  scheduleMeeting, updateMeeting, MEETINGS_CHANGED, type GreetMeeting, type HistoryItem, type Hub, type ScheduleInput,
} from '../../lib/greetClient';

interface Props {
  contacts?: CRMContact[];
  onStart: (roomCode?: string, contact?: CRMContact, title?: string, options?: { autoRecord?: boolean; autoTranscribe?: boolean; startMuted?: boolean; startCamOff?: boolean; scheduledMeetingId?: string }) => Promise<void>;
  onJoin: (codeOrLink: string) => Promise<void>;
  onNavigate?: (view: string) => void;
  /** Lets the Call Canvas Studio dialer book follow-ups on the calendar. */
  onAddCalendarEvent?: (event: any) => void;
  /** Opens the LiveKit meeting room (camera/microphone check first, then join) with this code pre-filled. */
  onOpenRoom?: (roomCode?: string) => void;
}

const inputCls = cx('w-full rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[14px] text-[var(--text)] placeholder:text-[var(--text-subtle)]', focusRing);
const labelCls = 'block text-[12px] font-medium text-[var(--text-muted)] mb-1';
const pad = (n: number) => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const nextHalfHour = () => { const d = new Date(Date.now() + 30 * 60_000); return `${pad(d.getHours())}:${d.getMinutes() < 30 ? '30' : '00'}`; };
const STATUS_TONE: Record<GreetMeeting['status'], 'accent' | 'success' | 'neutral' | 'danger'> = { SCHEDULED: 'accent', LIVE: 'success', ENDED: 'neutral', CANCELLED: 'danger' };
const STATUS_LABEL: Record<GreetMeeting['status'], string> = { SCHEDULED: 'Scheduled', LIVE: 'Live now', ENDED: 'Ended', CANCELLED: 'Cancelled' };
const OUTCOMES: Array<[string, string]> = [['held', 'Held'], ['follow_up', 'Needs follow-up'], ['won', 'Won the deal'], ['lost', 'Lost'], ['no_show', 'No-show'], ['rescheduled', 'Rescheduled'], ['other', 'Other']];

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('input,select,textarea,button')?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title}
        className={cx('w-full max-h-[92vh] overflow-y-auto rounded-t-[var(--radius-panel)] sm:rounded-[var(--radius-panel)] bg-[var(--surface)] border border-[var(--border)] shadow-xl', wide ? 'sm:max-w-2xl' : 'sm:max-w-lg')}>
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-5 py-3.5">
          <h2 className="text-[16px] font-semibold text-[var(--text)]">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className={cx('rounded-md p-1.5 text-[var(--text-muted)] hover:bg-[var(--surface-sunken)]', focusRing)}><X className="h-4 w-4" /></button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

function ErrorLine({ text }: { text: string | null }) {
  if (!text) return null;
  return <p role="alert" className="mt-3 flex items-start gap-2 rounded-[var(--radius-control)] bg-[var(--danger-soft)] px-3 py-2 text-[13px] text-[var(--danger)]"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{text}</p>;
}

// ---------------------------------------------------------------------------
// Schedule / reschedule form
// ---------------------------------------------------------------------------

function ScheduleForm({ initial, editing, contacts, onDone, onCancel }: {
  initial?: Partial<ScheduleInput> & { title?: string }; editing?: GreetMeeting | null; contacts: CRMContact[];
  onDone: (m: GreetMeeting, message: string) => void; onCancel: () => void;
}) {
  const { members } = useTeamMembers();
  const [title, setTitle] = useState(editing?.title ?? initial?.title ?? '');
  const [date, setDate] = useState(editing?.date ?? initial?.date ?? today());
  const [time, setTime] = useState(editing?.time && /^\d{2}:\d{2}$/.test(editing.time) ? editing.time : initial?.time ?? nextHalfHour());
  const [duration, setDuration] = useState(String(editing?.duration ?? initial?.duration ?? 30));
  const [guests, setGuests] = useState((editing?.guests ?? initial?.guests ?? []).join(', '));
  const [invitees, setInvitees] = useState<string[]>(editing?.invitees.map((i) => i.userId) ?? initial?.inviteeIds ?? []);
  const [leadId, setLeadId] = useState(editing?.associations?.leadId ?? initial?.associations?.leadId ?? '');
  const [notes, setNotes] = useState(editing?.additionalNotes ?? initial?.additionalNotes ?? '');
  const [repeat, setRepeat] = useState<'none' | 'daily' | 'weekly' | 'monthly'>('none');
  const [count, setCount] = useState('4');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    const guestList = guests.split(/[\s,;]+/).map((g) => g.trim()).filter(Boolean);
    const payload: ScheduleInput = {
      title: title.trim(), date, time, duration: Number(duration) || 30, guests: guestList, inviteeIds: invitees,
      associations: leadId ? { leadId } : {}, additionalNotes: notes,
      ...(!editing && repeat !== 'none' ? { recurrence: { frequency: repeat, count: Math.max(1, Math.min(52, Number(count) || 1)) } } : {}),
    };
    try {
      const r = editing ? await updateMeeting(editing.id, { ...payload, associations: leadId ? { leadId } : ({} as any) }) : await scheduleMeeting(payload);
      onDone(r.meeting, r.message);
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <form onSubmit={submit} className="space-y-3.5">
      <div><label className={labelCls} htmlFor="greet-title">Title</label>
        <input id="greet-title" required maxLength={200} className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Proposal review with Northwind" /></div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div><label className={labelCls} htmlFor="greet-date">Date</label><input id="greet-date" type="date" required className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <div><label className={labelCls} htmlFor="greet-time">Start time</label><input id="greet-time" type="time" required className={inputCls} value={time} onChange={(e) => setTime(e.target.value)} /></div>
        <div className="col-span-2 sm:col-span-1"><label className={labelCls} htmlFor="greet-duration">Duration</label>
          <select id="greet-duration" className={inputCls} value={duration} onChange={(e) => setDuration(e.target.value)}>
            {[15, 30, 45, 60, 90, 120, 180, 240].map((d) => <option key={d} value={d}>{d < 60 ? `${d} min` : `${d / 60} h${d % 60 ? ` ${d % 60} min` : ''}`}</option>)}
          </select></div>
      </div>
      <p className="text-[12px] text-[var(--text-subtle)]">Times are in your time zone ({Intl.DateTimeFormat().resolvedOptions().timeZone}).</p>
      {members.length > 0 && (
        <fieldset><legend className={labelCls}>Invite teammates</legend>
          <div className="flex flex-wrap gap-1.5">
            {members.map((m) => {
              const on = invitees.includes(m.id);
              return <button type="button" key={m.id} aria-pressed={on} onClick={() => setInvitees((v) => on ? v.filter((x) => x !== m.id) : [...v, m.id])}
                className={cx('rounded-full border px-3 py-1 text-[13px]', on ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-text)]' : 'border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-sunken)]', focusRing)}>
                {on && <Check className="mr-1 inline h-3 w-3" />}{m.name}</button>;
            })}
          </div></fieldset>
      )}
      <div><label className={labelCls} htmlFor="greet-guests">External guests (emails)</label>
        <input id="greet-guests" className={inputCls} value={guests} onChange={(e) => setGuests(e.target.value)} placeholder="client@company.com, partner@firm.com" />
        <p className="mt-1 text-[12px] text-[var(--text-subtle)]">After saving, create secure invitation links for them from the meeting's details.</p></div>
      <div><label className={labelCls} htmlFor="greet-lead">Link to a lead (optional)</label>
        <select id="greet-lead" className={inputCls} value={leadId} onChange={(e) => setLeadId(e.target.value)}>
          <option value="">No CRM record</option>
          {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}{c.company ? ` · ${c.company}` : ''}</option>)}
        </select></div>
      {!editing && (
        <div className="grid grid-cols-2 gap-3">
          <div><label className={labelCls} htmlFor="greet-repeat">Repeat</label>
            <select id="greet-repeat" className={inputCls} value={repeat} onChange={(e) => setRepeat(e.target.value as any)}>
              <option value="none">Doesn't repeat</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option>
            </select></div>
          {repeat !== 'none' && <div><label className={labelCls} htmlFor="greet-count">Number of meetings</label><input id="greet-count" type="number" min={1} max={52} className={inputCls} value={count} onChange={(e) => setCount(e.target.value)} /></div>}
        </div>
      )}
      <div><label className={labelCls} htmlFor="greet-notes">Agenda or notes</label>
        <textarea id="greet-notes" rows={3} maxLength={5000} className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
      <ErrorLine text={error} />
      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-1">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={busy || !title.trim()}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Schedule meeting'}</Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Meeting details: invitations, reschedule, cancel, outcome, follow-ups
// ---------------------------------------------------------------------------

function MeetingDetails({ meetingId, contacts, onClose, onStart, onScheduleAnother, notify }: {
  meetingId: string; contacts: CRMContact[]; onClose: () => void;
  onStart: (m: GreetMeeting) => void; onScheduleAnother: (m: GreetMeeting) => void; notify: (t: string) => void;
}) {
  const [data, setData] = useState<Awaited<ReturnType<typeof getMeeting>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'view' | 'edit' | 'cancel'>('view');
  const [links, setLinks] = useState<Array<{ email: string; link: string }>>([]);
  const [newGuest, setNewGuest] = useState('');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState('held');
  const [summary, setSummary] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    try { setData(await getMeeting(meetingId)); setError(null); } catch (e) { setError((e as Error).message); }
  }, [meetingId]);
  useEffect(() => { load(); }, [load]);
  const m = data?.meeting;
  useEffect(() => { if (m) setTaskTitle(`Follow up: ${m.title}`); }, [m?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true); setError(null);
    try { await fn(); if (ok) notify(ok); await load(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const copy = async (text: string, what = 'Link copied.') => { try { await navigator.clipboard.writeText(text); notify(what); } catch { notify('Copy failed: select the link and copy it.'); } };

  if (!data && !error) return <Modal title="Meeting" onClose={onClose}><Skeleton className="h-40" /></Modal>;
  if (!m) return <Modal title="Meeting" onClose={onClose}><ErrorLine text={error} /></Modal>;
  if (mode === 'edit') return <Modal title="Reschedule or edit" onClose={onClose} wide><ScheduleForm editing={m} contacts={contacts} onCancel={() => setMode('view')} onDone={(_, msg) => { notify(msg); setMode('view'); load(); }} /></Modal>;
  const isPast = m.status === 'ENDED';

  return (
    <Modal title={m.title} onClose={onClose} wide>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-[var(--text-muted)]">
          <Badge tone={STATUS_TONE[m.status]}>{STATUS_LABEL[m.status]}</Badge>
          <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{relWhen(m.nextOccurrence?.startTime || m.startTime)} · {m.duration} min</span>
          {m.recurrence && m.recurrence.frequency !== 'none' && <span className="inline-flex items-center gap-1"><Repeat className="h-3.5 w-3.5" />{m.recurrence.count} × {m.recurrence.frequency}</span>}
          {m.associations?.label && <Badge tone="info">{m.associations.label}</Badge>}
        </div>
        {m.status === 'CANCELLED' && <p className="text-[13px] text-[var(--danger)]">Cancelled{m.cancelReason ? `: ${m.cancelReason}` : '.'}</p>}

        <section className="space-y-1 text-[13px]">
          <p><span className="text-[var(--text-muted)]">Host:</span> {m.yourRole === 'host' ? 'You' : m.hostName || 'Organizer'}</p>
          {m.invitees.length > 0 && <p><span className="text-[var(--text-muted)]">Teammates:</span> {m.invitees.map((i) => i.name).join(', ')}</p>}
          {m.guests.length > 0 && <p><span className="text-[var(--text-muted)]">Guests:</span> {m.guests.join(', ')}</p>}
          {m.additionalNotes && <p className="whitespace-pre-wrap"><span className="text-[var(--text-muted)]">Agenda:</span> {m.additionalNotes}</p>}
          {m.actualStart && <p><span className="text-[var(--text-muted)]">Held:</span> {new Date(m.actualStart).toLocaleString()}{m.actualEnd ? ` – ${new Date(m.actualEnd).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}</p>}
          {m.participants && m.participants.length > 0 && <p><span className="text-[var(--text-muted)]">Attended:</span> {m.participants.map((p) => `${p.name} (${p.minutes} min)`).join(', ')}</p>}
        </section>

        {(m.status === 'SCHEDULED' || m.status === 'LIVE') && (
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" icon={<Video className="h-4 w-4" />} onClick={() => onStart(m)}>{m.status === 'LIVE' ? 'Join now' : m.yourRole === 'host' || m.canEdit ? 'Start meeting' : 'Join'}</Button>
            {m.videoLink && <Button variant="secondary" icon={<Copy className="h-4 w-4" />} onClick={() => copy(absoluteLink(m.videoLink!), 'Link for teammates copied (they sign in to join).')}>Copy team link</Button>}
            {m.canEdit && m.status === 'SCHEDULED' && <Button variant="secondary" icon={<CalendarClock className="h-4 w-4" />} onClick={() => setMode('edit')}>Reschedule</Button>}
            {m.canEdit && m.status === 'SCHEDULED' && <Button variant="ghost" onClick={() => setMode('cancel')}>Cancel meeting</Button>}
          </div>
        )}
        {mode === 'cancel' && (
          <div className="rounded-[var(--radius-card)] border border-[var(--border)] p-3 space-y-2">
            <label className={labelCls} htmlFor="greet-reason">Cancel this meeting? Guests' invitation links stop working.</label>
            <input id="greet-reason" className={inputCls} placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
            <div className="flex gap-2 justify-end"><Button variant="secondary" size="sm" onClick={() => setMode('view')}>Keep it</Button>
              <Button variant="danger" size="sm" disabled={busy} onClick={() => run(() => cancelMeeting(m.id, reason), 'Meeting cancelled.').then(() => setMode('view'))}>Cancel meeting</Button></div>
          </div>
        )}

        {m.canEdit && m.status !== 'CANCELLED' && !isPast && (
          <section className="space-y-2">
            <h3 className="text-[14px] font-semibold text-[var(--text)] flex items-center gap-1.5"><Mail className="h-4 w-4" />Guest invitation links</h3>
            {!data?.invitesConfigured
              ? <p className="text-[13px] text-[var(--text-muted)]">Guest links aren't set up on this server yet (an administrator adds GREET_INVITE_SECRET).</p>
              : <>
                <p className="text-[12px] text-[var(--text-muted)]">Each link works for one guest and this meeting only, expires after the meeting, and puts them in the waiting room until you let them in.</p>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input aria-label="Guest email" className={inputCls} placeholder="guest@company.com" value={newGuest} onChange={(e) => setNewGuest(e.target.value)} />
                  <Button variant="secondary" disabled={busy || (!newGuest.trim() && !m.guests.length)} onClick={() => run(async () => {
                    const r = await createInvites(m.id, newGuest.trim() ? [{ email: newGuest.trim() }] : undefined);
                    setLinks((l) => [...r.invites.map((i) => ({ email: i.email, link: i.link })), ...l]); setNewGuest('');
                  }, 'Invitation link created.')}>{newGuest.trim() ? 'Create link' : 'Create links for all guests'}</Button>
                </div>
                {links.map((l) => (
                  <div key={l.link} className="flex items-center gap-2 rounded-[var(--radius-control)] bg-[var(--surface-sunken)] px-3 py-2 text-[12px]">
                    <span className="font-medium shrink-0">{l.email}</span><span className="truncate text-[var(--text-subtle)]">{l.link}</span>
                    <button type="button" className={cx('ml-auto shrink-0 rounded p-1 hover:bg-[var(--surface)]', focusRing)} aria-label={`Copy link for ${l.email}`} onClick={() => copy(l.link)}><Copy className="h-3.5 w-3.5" /></button>
                  </div>
                ))}
                {(data?.invites || []).length > 0 && (
                  <ul className="divide-y divide-[var(--border)] text-[13px]">
                    {data!.invites!.map((i) => (
                      <li key={i.id} className="flex items-center gap-2 py-1.5">
                        <span className="truncate">{i.email}</span>
                        {i.revoked ? <Badge tone="neutral">Withdrawn</Badge> : i.lastUsedAt ? <Badge tone="success">Opened</Badge> : <Badge tone="accent">Sent</Badge>}
                        {!i.revoked && <button type="button" className={cx('ml-auto text-[12px] text-[var(--danger)] hover:underline', focusRing)} onClick={() => run(() => revokeInvite(m.id, i.id), 'Invitation withdrawn.')}>Withdraw</button>}
                      </li>
                    ))}
                  </ul>
                )}
              </>}
          </section>
        )}

        {(isPast || m.status === 'LIVE') && (
          <section className="space-y-3 rounded-[var(--radius-card)] border border-[var(--border)] p-3.5">
            <h3 className="text-[14px] font-semibold text-[var(--text)] flex items-center gap-1.5"><ListChecks className="h-4 w-4" />After the meeting</h3>
            {m.outcome && <p className="text-[13px]"><Badge tone="success">{OUTCOMES.find(([k]) => k === m.outcome!.result)?.[1] || m.outcome.result}</Badge> {m.outcome.summary} <span className="text-[var(--text-subtle)]">· {m.outcome.byName}</span></p>}
            <div className="grid sm:grid-cols-[180px_1fr_auto] gap-2">
              <select aria-label="Outcome" className={inputCls} value={outcome} onChange={(e) => setOutcome(e.target.value)}>{OUTCOMES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              <input aria-label="Outcome summary" className={inputCls} placeholder="What was decided?" value={summary} onChange={(e) => setSummary(e.target.value)} />
              <Button size="sm" variant="primary" disabled={busy} onClick={() => run(() => recordOutcome(m.id, outcome, summary), 'Outcome saved to the CRM.')}>Save outcome</Button>
            </div>
            <div className="grid sm:grid-cols-[1fr_auto] gap-2">
              <input aria-label="Follow-up task" className={inputCls} value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} />
              <Button size="sm" variant="secondary" disabled={busy || !taskTitle.trim()}
                onClick={() => run(() => createFollowUpTask({ leadId: m.associations?.leadId, contactId: m.associations?.contactId, dealId: m.associations?.dealId, title: taskTitle.trim(), meetingId: m.id }), 'Follow-up task added to Tasks.')}>Create follow-up task</Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" icon={<CalendarPlus className="h-4 w-4" />} onClick={() => onScheduleAnother(m)}>Schedule another meeting</Button>
            </div>
            <p className="text-[12px] text-[var(--text-subtle)]">Notes taken during the meeting are saved to the CRM{m.associations?.leadId ? ' and on the lead\'s timeline' : ''}.</p>
          </section>
        )}
        <ErrorLine text={error} />
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Device check (camera / microphone preview)
// ---------------------------------------------------------------------------

function DeviceCheck({ onClose }: { onClose: () => void }) {
  const { availableDevices, refreshDevices, meetingSettings, updateMeetingSettings } = useMeetingSession();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  useEffect(() => {
    let stream: MediaStream | null = null; let raf = 0; let ctx: AudioContext | null = null; let stopped = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: meetingSettings.selectedCameraId ? { deviceId: { exact: meetingSettings.selectedCameraId } } : true,
          audio: meetingSettings.selectedMicrophoneId ? { deviceId: { exact: meetingSettings.selectedMicrophoneId } } : true,
        });
        if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
        if (videoRef.current) videoRef.current.srcObject = stream;
        await refreshDevices();
        const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
        if (AC && stream.getAudioTracks().length) {
          ctx = new AC(); const an = ctx!.createAnalyser(); an.fftSize = 256;
          ctx!.createMediaStreamSource(stream).connect(an);
          const buf = new Uint8Array(an.frequencyBinCount);
          const tick = () => { an.getByteFrequencyData(buf); setLevel(Math.min(100, Math.round(buf.reduce((a, b) => a + b, 0) / buf.length * 1.6))); raf = requestAnimationFrame(tick); };
          tick();
        }
      } catch (e) { setError((e as Error)?.name === 'NotAllowedError' ? 'Camera and microphone access was blocked. Allow it in your browser\'s site settings.' : 'No camera or microphone was found.'); }
    })();
    return () => { stopped = true; cancelAnimationFrame(raf); ctx?.close().catch(() => {}); stream?.getTracks().forEach((t) => t.stop()); };
  }, [meetingSettings.selectedCameraId, meetingSettings.selectedMicrophoneId]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Modal title="Check camera and microphone" onClose={onClose}>
      <div className="space-y-3">
        <div className="aspect-video w-full overflow-hidden rounded-[var(--radius-card)] bg-black"><video ref={videoRef} autoPlay muted playsInline className="h-full w-full object-cover -scale-x-100" /></div>
        <div className="flex items-center gap-2"><Mic className="h-4 w-4 text-[var(--text-muted)]" /><div className="h-2 flex-1 rounded-full bg-[var(--surface-sunken)]" aria-label="Microphone level" role="meter" aria-valuenow={level} aria-valuemin={0} aria-valuemax={100}><div className="h-2 rounded-full bg-[var(--success)] transition-[width]" style={{ width: `${level}%` }} /></div></div>
        <div className="grid sm:grid-cols-2 gap-2">
          <div><label className={labelCls} htmlFor="greet-cam">Camera</label><select id="greet-cam" className={inputCls} value={meetingSettings.selectedCameraId || ''} onChange={(e) => updateMeetingSettings({ selectedCameraId: e.target.value })}>
            <option value="">Default</option>{availableDevices.videoInputs.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Camera'}</option>)}</select></div>
          <div><label className={labelCls} htmlFor="greet-mic">Microphone</label><select id="greet-mic" className={inputCls} value={meetingSettings.selectedMicrophoneId || ''} onChange={(e) => updateMeetingSettings({ selectedMicrophoneId: e.target.value })}>
            <option value="">Default</option>{availableDevices.audioInputs.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Microphone'}</option>)}</select></div>
        </div>
        <ErrorLine text={error} />
        <div className="flex justify-end"><Button variant="primary" onClick={onClose}>Done</Button></div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Helpers for the vault (transcripts and recordings kept in this browser)
// ---------------------------------------------------------------------------

const newRoomCode = () => {
  const p = (n: number) => Math.random().toString(36).slice(2, 2 + n).padEnd(n, 'x');
  return `${p(3)}-${p(4)}-${p(3)}`;
};
const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63);
const teamLink = (code: string) => absoluteLink(`/?view=greet&meet=${encodeURIComponent(code)}`);
const transcriptText = (r: MeetingHistoryRecord) => r.transcript.map((t) => `[${t.timestamp}] ${t.speakerName}: ${t.text}`).join('\n');
const downloadBlob = (name: string, blob: Blob) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};
async function downloadTranscriptPdf(record: MeetingHistoryRecord) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF();
  doc.setFillColor(30, 27, 75); doc.rect(0, 0, 210, 30, 'F');
  doc.setTextColor(255, 255, 255); doc.setFontSize(16); doc.text('GREET meeting transcript', 14, 18);
  doc.setFontSize(10); doc.text(`${record.title} · Room ${record.roomId} · ${record.date} ${record.time}`, 14, 25);
  let y = 42;
  record.transcript.forEach((item) => {
    if (y > 270) { doc.addPage(); y = 25; }
    doc.setFont('helvetica', 'bold'); doc.setTextColor(item.isHost ? 79 : 71, item.isHost ? 70 : 85, item.isHost ? 229 : 105);
    doc.text(`[${item.timestamp}] ${item.speakerName}${item.isHost ? ' (Host)' : ''}:`, 14, y);
    doc.setFont('helvetica', 'normal'); doc.setTextColor(35, 35, 35);
    const lines = doc.splitTextToSize(item.text, 135);
    doc.text(lines, 65, y);
    y += lines.length * 5 + 4;
  });
  doc.save(`transcript-${record.roomId}.pdf`);
}

/** Camera preview and microphone level for the pre-flight check (stopped as soon as the caller unmounts). */
function useDevicePreview(enabled: boolean) {
  const { refreshDevices, meetingSettings } = useMeetingSession();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let stream: MediaStream | null = null; let raf = 0; let ctx: AudioContext | null = null; let stopped = false;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('unsupported'), { name: 'NotFoundError' });
        stream = await navigator.mediaDevices.getUserMedia({
          video: meetingSettings.selectedCameraId ? { deviceId: { exact: meetingSettings.selectedCameraId } } : true,
          audio: meetingSettings.selectedMicrophoneId ? { deviceId: { exact: meetingSettings.selectedMicrophoneId } } : true,
        });
        if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
        if (videoRef.current) videoRef.current.srcObject = stream;
        setError(null);
        await refreshDevices();
        const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
        if (AC && stream.getAudioTracks().length) {
          ctx = new AC(); const an = ctx!.createAnalyser(); an.fftSize = 256;
          ctx!.createMediaStreamSource(stream).connect(an);
          const buf = new Uint8Array(an.frequencyBinCount);
          const tick = () => { an.getByteFrequencyData(buf); setLevel(Math.min(100, Math.round(buf.reduce((a, b) => a + b, 0) / buf.length * 1.6))); raf = requestAnimationFrame(tick); };
          tick();
        }
      } catch (e) { setError((e as Error)?.name === 'NotAllowedError' ? 'Camera and microphone access was blocked. Allow it in your browser\'s site settings.' : 'No camera or microphone was found.'); }
    })();
    return () => { stopped = true; cancelAnimationFrame(raf); ctx?.close().catch(() => {}); stream?.getTracks().forEach((t) => t.stop()); };
  }, [enabled, meetingSettings.selectedCameraId, meetingSettings.selectedMicrophoneId]); // eslint-disable-line react-hooks/exhaustive-deps
  return { videoRef, error, level };
}

// ---------------------------------------------------------------------------
// Start an instant meeting (pre-flight, CRM link, plan-aware options)
// ---------------------------------------------------------------------------

const TITLE_PRESETS = ['Quick sync', 'Discovery call', 'Proposal review', 'Weekly team sync'];

function InstantMeetingModal({ contacts, initial, onClose, onConfirm }: {
  contacts: CRMContact[]; initial: { title: string; roomCode: string; leadId: string };
  onClose: () => void;
  onConfirm: (o: { title: string; roomCode: string; leadId: string; autoRecord: boolean; autoTranscribe: boolean; startMuted: boolean; startCamOff: boolean }) => void;
}) {
  const { meetingFeatures, meetingLimits, meetingPlanLabel, meetingSettings, updateMeetingSettings, availableDevices } = useMeetingSession();
  const [title, setTitle] = useState(initial.title);
  const [roomCode, setRoomCode] = useState(initial.roomCode);
  const [leadId, setLeadId] = useState(initial.leadId);
  const [startMuted, setStartMuted] = useState(false);
  const [startCamOff, setStartCamOff] = useState(false);
  const [autoRecord, setAutoRecord] = useState(false);
  const [autoTranscribe, setAutoTranscribe] = useState(meetingSettings.autoTranscribe ?? true);
  const [copied, setCopied] = useState(false);
  const { videoRef, error, level } = useDevicePreview(true);
  const canRecord = meetingFeatures.recording;
  const code = slug(roomCode);

  return (
    <Modal title="Start an instant meeting" onClose={onClose} wide>
      <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); onConfirm({ title, roomCode: code, leadId, autoRecord: canRecord && autoRecord, autoTranscribe, startMuted, startCamOff }); }}>
        <div className="space-y-2">
          <label className={labelCls} htmlFor="greet-instant-title">Meeting title</label>
          <input id="greet-instant-title" className={inputCls} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder="Quick sync" />
          <div className="flex flex-wrap items-center gap-1.5">
            {TITLE_PRESETS.map((p) => (
              <button key={p} type="button" aria-pressed={title === p} onClick={() => setTitle(p)}
                className={cx('rounded-full border px-2.5 py-1 text-[12px]', title === p ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-text)]' : 'border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-sunken)]', focusRing)}>{p}</button>
            ))}
          </div>
        </div>

        <div className="space-y-2 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface-sunken)] p-3.5">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[var(--text)]"><Lock className="h-3.5 w-3.5 text-[var(--accent-text)]" />Room code</span>
            <button type="button" onClick={() => setRoomCode(newRoomCode())} className={cx('inline-flex items-center gap-1 text-[12px] font-medium text-[var(--accent-text)] hover:underline', focusRing)}><RefreshCw className="h-3 w-3" />New code</button>
          </div>
          <div className="flex gap-2">
            <input aria-label="Room code" className={cx(inputCls, 'font-mono')} value={roomCode} onChange={(e) => setRoomCode(e.target.value)} />
            <Button variant="secondary" icon={copied ? <Check className="h-4 w-4 text-[var(--success)]" /> : <Copy className="h-4 w-4" />} disabled={code.length < 3}
              onClick={async () => { try { await navigator.clipboard.writeText(teamLink(code)); setCopied(true); window.setTimeout(() => setCopied(false), 2000); } catch { /* clipboard blocked */ } }}>
              {copied ? 'Copied' : 'Copy link'}
            </Button>
          </div>
          <p className="text-[12px] text-[var(--text-subtle)]">Teammates sign in to join with this link. For customers, schedule the meeting and send each guest a secure invitation link.</p>
        </div>

        <div className="space-y-3 rounded-[var(--radius-card)] border border-[var(--border)] p-3.5">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[var(--text)]"><Activity className="h-3.5 w-3.5 text-[var(--success)]" />Camera and microphone check</span>
            {!error && <Badge tone="success">Devices ready</Badge>}
          </div>
          <div className="grid gap-3 sm:grid-cols-12 items-center">
            <div className="sm:col-span-5 relative aspect-video overflow-hidden rounded-[var(--radius-control)] bg-black">
              <video ref={videoRef} autoPlay muted playsInline className={cx('h-full w-full object-cover -scale-x-100', startCamOff && 'invisible')} />
              {startCamOff && <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-neutral-400"><VideoOff className="h-6 w-6" /><span className="text-[11px]">Camera off</span></div>}
            </div>
            <div className="sm:col-span-7 space-y-2.5">
              <div>
                <div className="mb-1 flex items-center justify-between text-[12px] text-[var(--text-muted)]"><span className="inline-flex items-center gap-1"><Mic className="h-3 w-3" />Microphone level</span><span>{startMuted ? 'Muted' : `${level}%`}</span></div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--surface-sunken)]" role="meter" aria-label="Microphone level" aria-valuenow={startMuted ? 0 : level} aria-valuemin={0} aria-valuemax={100}>
                  <div className="h-full rounded-full bg-[var(--success)] transition-[width]" style={{ width: `${startMuted ? 0 : level}%` }} />
                </div>
              </div>
              <div className="flex gap-2">
                <Button className="flex-1" variant={startMuted ? 'danger' : 'secondary'} aria-pressed={startMuted} icon={startMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />} onClick={() => setStartMuted(!startMuted)}>{startMuted ? 'Join muted' : 'Mic on'}</Button>
                <Button className="flex-1" variant={startCamOff ? 'danger' : 'secondary'} aria-pressed={startCamOff} icon={startCamOff ? <VideoOff className="h-4 w-4" /> : <Video className="h-4 w-4" />} onClick={() => setStartCamOff(!startCamOff)}>{startCamOff ? 'Camera off' : 'Camera on'}</Button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <select aria-label="Camera" className={cx(inputCls, 'text-[12px]')} value={meetingSettings.selectedCameraId || ''} onChange={(e) => updateMeetingSettings({ selectedCameraId: e.target.value })}>
                  <option value="">Default camera</option>{availableDevices.videoInputs.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Camera'}</option>)}</select>
                <select aria-label="Microphone" className={cx(inputCls, 'text-[12px]')} value={meetingSettings.selectedMicrophoneId || ''} onChange={(e) => updateMeetingSettings({ selectedMicrophoneId: e.target.value })}>
                  <option value="">Default microphone</option>{availableDevices.audioInputs.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Microphone'}</option>)}</select>
              </div>
            </div>
          </div>
          <ErrorLine text={error} />
        </div>

        <div><label className={labelCls} htmlFor="greet-instant-lead">Link to a CRM contact (optional)</label>
          <select id="greet-instant-lead" className={inputCls} value={leadId} onChange={(e) => setLeadId(e.target.value)}>
            <option value="">No CRM record</option>{contacts.map((c) => <option key={c.id} value={c.id}>{c.name}{c.company ? ` · ${c.company}` : ''}</option>)}</select>
          <p className="mt-1 text-[12px] text-[var(--text-subtle)]">Notes and the outcome are saved to this contact's timeline.</p></div>

        <fieldset className="space-y-2">
          <legend className={labelCls}>Meeting options</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className={cx('flex items-start gap-2 rounded-[var(--radius-control)] border border-[var(--border)] p-2.5', canRecord ? 'cursor-pointer hover:bg-[var(--surface-sunken)]' : 'opacity-70')}>
              <input type="checkbox" className="mt-0.5" checked={canRecord && autoRecord} disabled={!canRecord} onChange={(e) => setAutoRecord(e.target.checked)} />
              <span><span className="block text-[13px] font-medium text-[var(--text)]">Record the meeting</span>
                <span className="block text-[12px] text-[var(--text-subtle)]">{canRecord ? 'Everyone is asked to agree first.' : `Not included in the ${meetingPlanLabel} plan.`}</span></span>
            </label>
            <label className="flex cursor-pointer items-start gap-2 rounded-[var(--radius-control)] border border-[var(--border)] p-2.5 hover:bg-[var(--surface-sunken)]">
              <input type="checkbox" className="mt-0.5" checked={autoTranscribe} onChange={(e) => setAutoTranscribe(e.target.checked)} />
              <span><span className="block text-[13px] font-medium text-[var(--text)]">Live transcript</span><span className="block text-[12px] text-[var(--text-subtle)]">Saved with the meeting's notes.</span></span>
            </label>
          </div>
        </fieldset>

        <p className="flex items-start gap-2 rounded-[var(--radius-control)] bg-[var(--info-soft)] px-3 py-2 text-[12px] text-[var(--text)]">
          <Gauge className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--info)]" />
          <span>{meetingPlanLabel} plan: up to {meetingLimits.maxParticipants} people and {meetingLimits.maxDurationMinutes} minutes per meeting. The server applies these limits.</span>
        </p>

        <div className="flex flex-col-reverse gap-2 border-t border-[var(--border)] pt-4 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" icon={<Video className="h-4 w-4" />}>Start meeting now</Button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Watch a recording / read a transcript (recordings kept in this browser)
// ---------------------------------------------------------------------------

function TranscriptLines({ record, search, activeSecond, onJump }: { record: MeetingHistoryRecord; search: string; activeSecond?: number; onJump?: (s: number) => void }) {
  const q = search.trim().toLowerCase();
  const items = record.transcript.filter((t) => !q || t.text.toLowerCase().includes(q) || t.speakerName.toLowerCase().includes(q));
  if (!items.length) return <p className="p-3 text-[13px] text-[var(--text-subtle)]">{q ? 'No lines match your search.' : 'This meeting has no transcript.'}</p>;
  return (
    <ul className="space-y-1.5">
      {items.map((t) => {
        const on = activeSecond !== undefined && activeSecond >= (t.timeSeconds || 0) && activeSecond < (t.timeSeconds || 0) + 15;
        return (
          <li key={t.id} className={cx('rounded-[var(--radius-control)] px-2.5 py-2 text-[13px]', on ? 'bg-[var(--accent-soft)]' : 'bg-[var(--surface)]')}>
            <div className="flex items-center justify-between gap-2 text-[12px]">
              <span className={cx('font-semibold', t.isHost ? 'text-[var(--accent-text)]' : 'text-[var(--text)]')}>{t.speakerName}{t.isHost ? ' (Host)' : ''}</span>
              {onJump ? <button type="button" onClick={() => onJump(t.timeSeconds || 0)} className={cx('font-mono text-[11px] text-[var(--accent-text)] hover:underline', focusRing)} aria-label={`Play from ${t.timestamp}`}>{t.timestamp}</button>
                : <span className="font-mono text-[11px] text-[var(--text-subtle)]">{t.timestamp}</span>}
            </div>
            <p className="mt-0.5 leading-relaxed text-[var(--text-muted)]">{t.text}</p>
          </li>
        );
      })}
    </ul>
  );
}

function TranscriptExport({ record, notify }: { record: MeetingHistoryRecord; notify: (t: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="secondary" icon={<Download className="h-3.5 w-3.5" />} onClick={() => { downloadBlob(`transcript-${record.roomId}.txt`, new Blob([transcriptText(record)], { type: 'text/plain' })); notify('Transcript downloaded.'); }}>.TXT</Button>
      <Button size="sm" variant="secondary" icon={<FileText className="h-3.5 w-3.5" />} onClick={() => downloadTranscriptPdf(record).catch(() => notify('The PDF couldn\'t be created.'))}>.PDF</Button>
      <Button size="sm" variant="secondary" icon={<Copy className="h-3.5 w-3.5" />} onClick={async () => { try { await navigator.clipboard.writeText(transcriptText(record)); notify('Transcript copied.'); } catch { notify('Copy failed.'); } }}>Copy</Button>
    </div>
  );
}

function WatchRecording({ record, onClose, notify }: { record: MeetingHistoryRecord; onClose: () => void; notify: (t: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [now, setNow] = useState(0);
  const [search, setSearch] = useState('');
  const [speed, setSpeed] = useState(1);
  useEffect(() => { if (videoRef.current) videoRef.current.playbackRate = speed; }, [speed]);
  return (
    <Modal title={record.title} onClose={onClose} wide>
      <div className="space-y-4">
        <p className="text-[12px] text-[var(--text-muted)]">{record.date} at {record.time} · {record.durationFormatted}{record.recordingSize ? ` · ${record.recordingSize}` : ''}</p>
        {record.recordingUrl ? (
          <video ref={videoRef} src={record.recordingUrl} controls playsInline className="aspect-video w-full rounded-[var(--radius-card)] bg-black" onTimeUpdate={(e) => setNow((e.target as HTMLVideoElement).currentTime)} />
        ) : (
          <div className="flex aspect-video w-full flex-col items-center justify-center gap-1 rounded-[var(--radius-card)] bg-[var(--surface-sunken)] text-center text-[13px] text-[var(--text-muted)]"><VideoOff className="h-6 w-6" />The video isn't on this device any more (it's kept only until the tab is closed).</div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {record.recordingUrl && <>
            <Button size="sm" variant="secondary" onClick={() => setSpeed(speed === 1 ? 1.5 : speed === 1.5 ? 2 : 1)}>{speed}× speed</Button>
            <a className={cx('inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-control)] border border-[var(--border)] px-2.5 text-[12px] font-medium text-[var(--text)] hover:bg-[var(--surface-sunken)]', focusRing)} href={record.recordingUrl} download={`greet-${record.roomId}.webm`}><Download className="h-3.5 w-3.5" />Save video</a>
          </>}
          {record.transcript.length > 0 && <div className="ml-auto"><TranscriptExport record={record} notify={notify} /></div>}
        </div>
        {record.transcript.length > 0 && (
          <div className="space-y-2">
            <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-subtle)]" />
              <input aria-label="Search the transcript" className={cx(inputCls, 'pl-8')} placeholder="Search what was said…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
            <div className="max-h-56 overflow-y-auto rounded-[var(--radius-card)] bg-[var(--surface-sunken)] p-2">
              <TranscriptLines record={record} search={search} activeSecond={record.recordingUrl ? now : undefined}
                onJump={record.recordingUrl ? (s) => { if (videoRef.current) { videoRef.current.currentTime = s; videoRef.current.play().catch(() => {}); } } : undefined} />
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function ViewTranscript({ record, onClose, notify }: { record: MeetingHistoryRecord; onClose: () => void; notify: (t: string) => void }) {
  const [search, setSearch] = useState('');
  return (
    <Modal title="Meeting transcript" onClose={onClose} wide>
      <div className="space-y-3">
        <p className="text-[12px] text-[var(--text-muted)]">{record.title} · {record.date}</p>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-subtle)]" />
            <input aria-label="Search the transcript" className={cx(inputCls, 'pl-8')} placeholder="Search what was said…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
          <TranscriptExport record={record} notify={notify} />
        </div>
        <div className="max-h-[50vh] overflow-y-auto rounded-[var(--radius-card)] bg-[var(--surface-sunken)] p-2"><TranscriptLines record={record} search={search} /></div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Page: Greet Portal · Call Canvas Studio · Recordings & Vault · Schedule
// ---------------------------------------------------------------------------

type HubTab = 'greet' | 'canvas' | 'recordings' | 'schedule';
type ScheduleTab = 'upcoming' | 'invitations' | 'history';
const HUB_TABS: Array<{ id: HubTab; label: string; icon: React.ReactNode }> = [
  { id: 'greet', label: 'Greet Portal', icon: <Sparkles className="h-3.5 w-3.5" /> },
  { id: 'canvas', label: 'Call Canvas Studio', icon: <PhoneCall className="h-3.5 w-3.5" /> },
  { id: 'recordings', label: 'Recordings & Vault', icon: <Disc className="h-3.5 w-3.5" /> },
  { id: 'schedule', label: 'Schedule', icon: <CalendarDays className="h-3.5 w-3.5" /> },
];
const TAB_KEY = 'greet_hub_tab';
const readTab = (): HubTab => { try { const t = localStorage.getItem(TAB_KEY); return HUB_TABS.some((x) => x.id === t) ? (t as HubTab) : 'greet'; } catch { return 'greet'; } };

/** Big action card on the Greet Portal. */
function ActionCard({ icon, tag, title, body, children }: { icon: React.ReactNode; tag: string; title: string; body: string; children: React.ReactNode }) {
  return (
    <Card className="group flex flex-col justify-between rounded-[calc(var(--radius-panel)+6px)] p-5 sm:p-6 hover:shadow-md">
      <div>
        <div className="mb-4 flex items-center justify-between">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent-text)] transition-transform group-hover:scale-105" aria-hidden="true">{icon}</span>
          <span className="rounded-full border border-[var(--border)] px-2.5 py-0.5 font-mono text-[10px] font-semibold tracking-wide text-[var(--text-muted)]">{tag}</span>
        </div>
        <h3 className="mb-1 text-[16px] font-semibold text-[var(--text)]">{title}</h3>
        <p className="mb-4 text-[13px] leading-relaxed text-[var(--text-muted)]">{body}</p>
      </div>
      <div className="border-t border-[var(--border)] pt-3">{children}</div>
    </Card>
  );
}

export default function GreetHub({ contacts = [], onStart, onJoin, onNavigate, onAddCalendarEvent, onOpenRoom }: Props) {
  const {
    meetingHistory, deleteMeetingHistoryItem, saveCurrentMeetingTranscript, isCallActive, returnToMeeting, activeMeeting,
    meetingLimits, meetingFeatures, meetingPlanLabel, subscription, refreshSubscription,
  } = useMeetingSession();
  const { pushNotification } = useNotifications();
  const [hub, setHub] = useState<Hub | null>(null);
  const [hubError, setHubError] = useState<string | null>(null);
  const [tab, setTabState] = useState<HubTab>(readTab);
  const [scheduleTab, setScheduleTab] = useState<ScheduleTab>('upcoming');
  const [joinCode, setJoinCode] = useState('');
  const [joinError, setJoinError] = useState<string | null>(null);
  const [modal, setModal] = useState<null
    | { kind: 'schedule'; initial?: Partial<ScheduleInput> }
    | { kind: 'instant'; title: string; roomCode: string; leadId: string }
    | { kind: 'details'; id: string }
    | { kind: 'devices' }
    | { kind: 'watch'; record: MeetingHistoryRecord }
    | { kind: 'transcript'; record: MeetingHistoryRecord }>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [media, setMedia] = useState<{ configured: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [vaultFilter, setVaultFilter] = useState<'all' | 'recordings' | 'transcripts'>('all');
  const [vaultSearch, setVaultSearch] = useState('');
  const toastTimer = useRef<number | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const quickRef = useRef<HTMLDivElement>(null);

  const setTab = (t: HubTab) => { setTabState(t); try { localStorage.setItem(TAB_KEY, t); } catch { /* storage blocked */ } };
  const notify = useCallback((t: string) => {
    setToast(t);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3500);
  }, []);

  const load = useCallback(async () => {
    try { const h = await getHub(); setHub(h); setHubError(null); }
    catch (e) { setHubError((e as Error).message); }
  }, []);
  useEffect(() => {
    load();
    greetApi<{ media: { configured: boolean } }>('/api/greet/settings').then((r) => setMedia(r.media)).catch(() => setMedia(null));
    if (!subscription) refreshSubscription().catch(() => {});
    const on = () => { load(); };
    window.addEventListener(MEETINGS_CHANGED, on);
    const poll = window.setInterval(load, 60_000);
    return () => { window.removeEventListener(MEETINGS_CHANGED, on); window.clearInterval(poll); };
  }, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  // "/" focuses the search; Escape closes the quick-action menu.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
      if (e.key === '/' && !typing && !modal) { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key === 'Escape') { setQuickOpen(false); setSearchOpen(false); }
    };
    const onDown = (e: MouseEvent) => { if (quickRef.current && !quickRef.current.contains(e.target as Node)) setQuickOpen(false); };
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => { window.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown); };
  }, [modal]);

  // New invitations → the CRM's notification center (once per meeting, per browser).
  useEffect(() => {
    if (!hub?.invitations.length) return;
    let seen: string[] = [];
    try { seen = JSON.parse(localStorage.getItem('greet_seen_invitations') || '[]'); } catch { /* storage blocked */ }
    const fresh = hub.invitations.filter((m) => !seen.includes(m.id));
    fresh.forEach((m) => pushNotification({ title: 'GREET invitation', message: `${m.hostName || 'A teammate'} invited you to “${m.title}” (${relWhen(m.nextOccurrence?.startTime || m.startTime)}).`, type: 'meeting', priority: 'normal', targetView: 'greet' as any, showToast: false }));
    try { localStorage.setItem('greet_seen_invitations', JSON.stringify([...seen, ...fresh.map((m) => m.id)].slice(-200))); } catch { /* storage blocked */ }
  }, [hub?.invitations]); // eslint-disable-line react-hooks/exhaustive-deps

  // Browser-only history from older versions: shown until moved to the server.
  const deviceById = useMemo(() => new Map(meetingHistory.map((h) => [h.id, h])), [meetingHistory]);
  const deviceHistory: HistoryItem[] = useMemo(() => meetingHistory.map((h) => {
    const ms = Number(String(h.id).match(/(\d{12,})/)?.[1]) || Date.parse(`${h.date} ${h.time}`) || 0;
    return { id: h.id, source: 'device' as const, title: h.title, startedAt: ms, minutes: Math.round(h.durationSeconds / 60), hostName: h.hostName, participants: h.participants.map((p) => ({ name: p.name })), notes: h.notes, recordingUsed: h.hasRecording };
  }), [meetingHistory]);
  const importDeviceHistory = async () => {
    setBusy(true);
    try {
      const r = await greetApi<{ imported: number; skipped: number }>('/api/meetings/history/import', { method: 'POST', body: JSON.stringify({ records: meetingHistory.slice(0, 500).map((h, i) => ({ id: h.id, title: h.title, startedAt: deviceHistory[i].startedAt || Date.now(), durationSeconds: Math.max(0, h.durationSeconds), participants: h.participants.map((p) => p.name).slice(0, 500), notes: (h.notes || '').slice(0, 20000) })) }) });
      try { localStorage.setItem('greet_history_imported', JSON.stringify(meetingHistory.map((h) => h.id))); } catch { /* storage blocked */ }
      notify(r.imported ? `Moved ${r.imported} meeting${r.imported === 1 ? '' : 's'} to the server.` : 'Already on the server.');
      load();
    } catch (e) { notify((e as Error).message); } finally { setBusy(false); }
  };
  const importedIds = useMemo(() => { try { return new Set<string>(JSON.parse(localStorage.getItem('greet_history_imported') || '[]')); } catch { return new Set<string>(); } }, [hub]); // eslint-disable-line react-hooks/exhaustive-deps
  const pendingDevice = deviceHistory.filter((h) => !importedIds.has(h.id));
  const history = [...(hub?.history ?? []), ...pendingDevice].sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));

  const startScheduled = async (m: GreetMeeting) => {
    setBusy(true);
    try {
      if (m.status === 'LIVE' && !m.canEdit) await onJoin(m.roomCode);
      else await onStart(undefined, undefined, undefined, { scheduledMeetingId: m.id });
    } finally { setBusy(false); }
  };
  const openInstant = (o?: Partial<{ title: string; roomCode: string; leadId: string }>) =>
    setModal({ kind: 'instant', title: o?.title ?? 'Quick sync', roomCode: o?.roomCode || newRoomCode(), leadId: o?.leadId ?? '' });
  const join = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = joinCode.trim();
    if (!v) { setJoinError('Enter a meeting code or link.'); return; }
    setJoinError(null); setBusy(true);
    try { await onJoin(v); } finally { setBusy(false); }
  };
  const copy = async (text: string, what: string) => { try { await navigator.clipboard.writeText(text); notify(what); } catch { notify('Copy failed: select the link and copy it.'); } };

  // Quick search: scheduled meetings and invitations, then CRM contacts.
  const q = search.trim().toLowerCase();
  const meetingHits = q ? [...(hub?.upcoming ?? []), ...(hub?.invitations ?? [])].filter((m) =>
    [m.title, m.roomCode, m.associations?.label, m.hostName, ...m.guests, ...m.invitees.map((i) => i.name)].some((s) => (s || '').toLowerCase().includes(q))).slice(0, 6) : [];
  const contactHits = q ? contacts.filter((c) => c.name.toLowerCase().includes(q) || (c.company || '').toLowerCase().includes(q) || (c.email || '').toLowerCase().includes(q)).slice(0, 6) : [];

  const upcoming = hub?.upcoming ?? [];
  const invitations = hub?.invitations ?? [];
  const todayStr = new Date().toDateString();
  const today = upcoming.filter((m) => new Date(m.nextOccurrence?.startTime || m.startTime).toDateString() === todayStr);
  const agenda = (today.length ? today : upcoming).slice(0, 3);
  const vaultItems = meetingHistory
    .filter((m) => vaultFilter === 'recordings' ? m.hasRecording : vaultFilter === 'transcripts' ? m.hasTranscript : true)
    .filter((m) => { const s = vaultSearch.trim().toLowerCase(); return !s || m.title.toLowerCase().includes(s) || m.roomId.toLowerCase().includes(s) || (m.notes || '').toLowerCase().includes(s); });
  const tabLabel = HUB_TABS.find((t) => t.id === tab)!.label;
  const videoStatus = media === null ? null : media.configured;

  const meetingRow = (m: GreetMeeting) => (
    <li key={m.id}>
      <Card className="flex flex-col gap-3 p-3.5 sm:flex-row sm:items-center sm:p-4">
        <span className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent-text)] sm:flex" aria-hidden="true"><Video className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-[15px] font-semibold text-[var(--text)]">{m.title}</p>
            <Badge tone={STATUS_TONE[m.status]}>{STATUS_LABEL[m.status]}</Badge>
            {m.yourRole === 'invitee' && <Badge tone="info">Invited by {m.hostName || 'a teammate'}</Badge>}
          </div>
          <p className="mt-0.5 flex flex-wrap gap-x-3 text-[13px] text-[var(--text-muted)]">
            <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{relWhen(m.nextOccurrence?.startTime || m.startTime)} · {m.duration} min</span>
            <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" />{m.invitees.length + m.guests.length + 1} people</span>
            <span className="font-mono text-[12px]">{m.roomCode}</span>
            {m.associations?.label && <span>{m.associations.label}</span>}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {m.videoLink && <Button size="sm" variant="ghost" icon={<Copy className="h-3.5 w-3.5" />} onClick={() => copy(absoluteLink(m.videoLink!), 'Link for teammates copied (they sign in to join).')}>Team link</Button>}
          <Button size="sm" variant="secondary" onClick={() => setModal({ kind: 'details', id: m.id })}>{m.canEdit ? 'Invite & details' : 'Details'}</Button>
          <Button size="sm" variant="primary" disabled={busy} icon={<Video className="h-4 w-4" />} onClick={() => startScheduled(m)}>{m.status === 'LIVE' ? 'Join' : m.canEdit ? 'Start' : 'Join'}</Button>
        </div>
      </Card>
    </li>
  );

  const historyRow = (h: HistoryItem, compact = false) => {
    const rec = h.source === 'device' ? deviceById.get(h.id) : undefined;
    return (
      <li key={`${h.source}:${h.id}`}>
        <div className={cx('flex flex-col gap-2 rounded-[var(--radius-card)] border border-[var(--border)] sm:flex-row sm:items-center', compact ? 'bg-[var(--surface-sunken)] p-3' : 'bg-[var(--surface)] p-3.5')}>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2"><p className="truncate text-[14px] font-medium text-[var(--text)]">{h.title}</p>
              {h.source === 'device' && <Badge tone="warning">On this device</Badge>}
              {h.source === 'imported' && <Badge tone="neutral">Imported</Badge>}
              {h.outcome && <Badge tone="success">{OUTCOMES.find(([k]) => k === h.outcome!.result)?.[1] || h.outcome.result}</Badge>}
              {h.recordingUsed && <Badge tone="danger"><Disc className="h-3 w-3" />Recorded</Badge>}</div>
            <p className="text-[12px] text-[var(--text-muted)]">{h.startedAt ? new Date(h.startedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Date unknown'} · {h.minutes} min · {h.participants.length} {h.participants.length === 1 ? 'person' : 'people'}{h.associations?.label ? ` · ${h.associations.label}` : ''}</p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {rec?.recordingUrl && <Button size="sm" variant="secondary" icon={<Play className="h-3.5 w-3.5" />} onClick={() => setModal({ kind: 'watch', record: rec })}>Watch</Button>}
            {rec && rec.transcript.length > 0 && <Button size="sm" variant="secondary" icon={<FileText className="h-3.5 w-3.5" />} onClick={() => setModal({ kind: 'transcript', record: rec })}>Transcript</Button>}
            {h.scheduledMeetingId && <Button size="sm" variant="secondary" onClick={() => setModal({ kind: 'details', id: h.scheduledMeetingId! })}>Outcome & follow-up</Button>}
          </div>
        </div>
      </li>
    );
  };

  return (
    <div id="greet-hub" className="relative flex min-h-full w-full shrink-0 flex-col overflow-x-hidden bg-[var(--app-bg)] text-[var(--text)]">
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute left-1/2 top-40 h-[420px] w-[min(850px,120vw)] -translate-x-1/2 rounded-full bg-[var(--accent)] opacity-[0.07] blur-[120px]" />
      </div>

      {/* Header: brand, quick search, section tabs */}
      <header className="relative z-30 flex w-full flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface)]/85 px-4 py-3 backdrop-blur-md sm:px-6">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--accent)] text-[var(--accent-contrast)]" aria-hidden="true"><Video className="h-[18px] w-[18px]" /></span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[15px] font-semibold tracking-tight">GREET</h1>
              {videoStatus === true && <Badge tone="success"><span className="h-1.5 w-1.5 rounded-full bg-[var(--success)]" />Video connected</Badge>}
              {videoStatus === false && <Badge tone="warning">Video not set up</Badge>}
            </div>
            <p className="text-[12px] text-[var(--text-muted)]">Video meetings, call canvas, recordings and schedule</p>
          </div>
        </div>

        <div className="relative order-3 w-full sm:order-none sm:mx-2 sm:max-w-sm sm:flex-1 md:max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-subtle)]" />
          <input ref={searchRef} id="input-greet-quick-search" type="search" aria-label="Search meetings and contacts" value={search}
            onChange={(e) => { setSearch(e.target.value); setSearchOpen(true); }} onFocus={() => setSearchOpen(true)}
            onKeyDown={(e) => { if (e.key === 'Enter' && q && !meetingHits.length && !contactHits.length) { setSearchOpen(false); openInstant({ title: search.trim(), roomCode: slug(search) || newRoomCode() }); } }}
            placeholder="Search meetings and contacts" className={cx(inputCls, 'h-9 py-1.5 pl-9 pr-8 text-[13px]')} />
          {!search && <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded bg-[var(--surface-sunken)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-subtle)]">/</kbd>}
          {searchOpen && q && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setSearchOpen(false)} aria-hidden="true" />
              <div className="absolute left-0 right-0 top-full z-50 mt-1.5 max-h-80 overflow-y-auto rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] text-[13px] shadow-xl">
                {meetingHits.length > 0 && <p className="border-b border-[var(--border)] bg-[var(--surface-sunken)] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-subtle)]">Meetings</p>}
                {meetingHits.map((m) => (
                  <button key={m.id} type="button" onClick={() => { setSearchOpen(false); setModal({ kind: 'details', id: m.id }); }}
                    className={cx('flex w-full items-center gap-2.5 border-b border-[var(--border)] px-3 py-2.5 text-left hover:bg-[var(--surface-sunken)]', focusRing)}>
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent-text)]"><Video className="h-3.5 w-3.5" /></span>
                    <span className="min-w-0 flex-1"><span className="block truncate font-medium">{m.title}</span><span className="block truncate text-[12px] text-[var(--text-muted)]">{relWhen(m.nextOccurrence?.startTime || m.startTime)} · <span className="font-mono">{m.roomCode}</span></span></span>
                    <Badge tone={STATUS_TONE[m.status]}>{STATUS_LABEL[m.status]}</Badge>
                  </button>
                ))}
                {contactHits.length > 0 && <p className="border-b border-[var(--border)] bg-[var(--surface-sunken)] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-subtle)]">Contacts</p>}
                {contactHits.map((c) => (
                  <button key={c.id} type="button" onClick={() => { setSearchOpen(false); openInstant({ title: `Meeting with ${c.name}`, leadId: c.id }); }}
                    className={cx('flex w-full items-center gap-2.5 border-b border-[var(--border)] px-3 py-2.5 text-left hover:bg-[var(--surface-sunken)]', focusRing)}>
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-sunken)] text-[11px] font-semibold text-[var(--text-muted)]">{c.name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase()}</span>
                    <span className="min-w-0 flex-1"><span className="block truncate font-medium">{c.name}</span><span className="block truncate text-[12px] text-[var(--text-muted)]">{[c.company, c.status].filter(Boolean).join(' · ')}</span></span>
                    <span className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--accent-text)]"><Video className="h-3 w-3" />Meet</span>
                  </button>
                ))}
                {!meetingHits.length && !contactHits.length && <p className="px-3 py-4 text-center text-[var(--text-muted)]">No matches. Press Enter to start a room called <b>“{search.trim()}”</b>.</p>}
              </div>
            </>
          )}
        </div>

        <div role="tablist" aria-label="GREET sections" className="order-4 flex w-full items-center gap-1 overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface-sunken)] p-1 lg:order-none lg:w-auto">
          {HUB_TABS.map((t) => (
            <button key={t.id} id={`tab-greet-${t.id}`} role="tab" type="button" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
              className={cx('flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-colors', tab === t.id ? 'bg-[var(--surface)] text-[var(--text)] shadow-xs' : 'text-[var(--text-muted)] hover:text-[var(--text)]', focusRing)}>
              <span className={tab === t.id ? 'text-[var(--accent-text)]' : ''}>{t.icon}</span>{t.label}
              {t.id === 'recordings' && meetingHistory.length > 0 && <span className="rounded-full bg-[var(--danger-soft)] px-1.5 text-[10px] font-bold text-[var(--danger)]">{meetingHistory.length}</span>}
              {t.id === 'schedule' && (upcoming.length + invitations.length) > 0 && <span className="rounded-full bg-[var(--accent-soft)] px-1.5 text-[10px] font-bold text-[var(--accent-text)]">{upcoming.length + invitations.length}</span>}
            </button>
          ))}
        </div>
      </header>

      {/* Breadcrumb with plan and video status */}
      <nav aria-label="Breadcrumb" className="relative z-20 flex w-full flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--surface-sunken)]/70 px-4 py-2 text-[12px] text-[var(--text-muted)] sm:px-6">
        <ol className="flex items-center gap-2 font-medium">
          <li>{onNavigate ? <button type="button" onClick={() => onNavigate('dashboard')} className={cx('flex items-center gap-1 hover:text-[var(--text)]', focusRing)}><Home className="h-3 w-3" />Core CRM</button> : <span className="flex items-center gap-1"><Home className="h-3 w-3" />Core CRM</span>}</li>
          <li aria-hidden="true"><ChevronRight className="h-3 w-3 text-[var(--text-subtle)]" /></li>
          <li><button type="button" onClick={() => setTab('greet')} className={cx('rounded-md px-2 py-0.5 font-semibold', tab === 'greet' ? 'bg-[var(--accent-soft)] text-[var(--accent-text)]' : 'hover:text-[var(--text)]', focusRing)}>GREET</button></li>
          {tab !== 'greet' && <><li aria-hidden="true"><ChevronRight className="h-3 w-3 text-[var(--text-subtle)]" /></li><li aria-current="page" className="rounded-md bg-[var(--accent-soft)] px-2 py-0.5 font-semibold text-[var(--accent-text)]">{tabLabel}</li></>}
        </ol>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="inline-flex items-center gap-1"><Gauge className="h-3 w-3" />{meetingPlanLabel} plan · up to {meetingLimits.maxParticipants} people · {meetingLimits.maxDurationMinutes} min</span>
          <span className="hidden sm:inline text-[var(--text-subtle)]">•</span>
          <span className="hidden items-center gap-1 sm:inline-flex"><span className={cx('h-1.5 w-1.5 rounded-full', videoStatus ? 'bg-[var(--success)]' : videoStatus === false ? 'bg-[var(--warning)]' : 'bg-[var(--text-subtle)]')} />{videoStatus ? 'LiveKit video' : videoStatus === false ? 'LiveKit not configured' : 'Checking video…'}</span>
        </div>
      </nav>

      <main className="relative z-10 flex flex-1 flex-col items-center px-4 py-6 sm:px-6 sm:py-8">
        {hubError && <div role="alert" className="mb-5 flex w-full max-w-6xl flex-wrap items-center justify-between gap-2 rounded-xl bg-[var(--danger-soft)] px-4 py-3 text-[13px] text-[var(--danger)]"><span>{hubError}</span><Button size="sm" variant="secondary" onClick={load}>Try again</Button></div>}

        {/* ================= GREET PORTAL ================= */}
        {tab === 'greet' && (
          <div className="flex w-full max-w-6xl flex-col items-center">
            <div className="mb-6 max-w-2xl text-center">
              <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-[12px] font-medium text-[var(--accent-text)]"><Sparkles className="h-3.5 w-3.5" />Greet Portal<span className={cx('h-1.5 w-1.5 rounded-full', videoStatus === false ? 'bg-[var(--warning)]' : 'bg-[var(--success)]')} /></p>
              <h2 className="text-[28px] font-semibold leading-tight tracking-[-0.03em] sm:text-[34px]">Welcome back! Ready to meet?</h2>
              <p className="mt-1.5 text-[14px] text-[var(--text-muted)]">Start, join and schedule video meetings with your team and customers. Meetings link to your leads and deals, and notes and outcomes are saved to the CRM.</p>
            </div>

            {isCallActive && activeMeeting && (
              <div className="mb-6 flex w-full flex-col items-center justify-between gap-4 rounded-[var(--radius-panel)] border border-[var(--success)] bg-[var(--success-soft)] p-4 sm:flex-row">
                <div className="flex items-center gap-3">
                  <span className="relative flex h-3 w-3 shrink-0"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--success)] opacity-60" /><span className="relative inline-flex h-3 w-3 rounded-full bg-[var(--success)]" /></span>
                  <div>
                    <p className="flex flex-wrap items-center gap-2 text-[14px] font-semibold">In a meeting: {activeMeeting.title}<span className="rounded bg-[var(--surface)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--text-muted)]">{activeMeeting.roomId}</span></p>
                    <p className="text-[12px] text-[var(--text-muted)]">Your audio, video and chat keep running while you look around.</p>
                  </div>
                </div>
                <Button variant="primary" icon={<ArrowRight className="h-4 w-4" />} onClick={returnToMeeting}>Return to meeting</Button>
              </div>
            )}

            {videoStatus === false && (
              <div role="status" className="mb-6 flex w-full items-start gap-2 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--warning-soft)] px-4 py-3 text-[13px]">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--warning)]" />
                <span>Audio and video between people aren't connected on this server yet (LiveKit isn't configured). You can still schedule meetings and send invitations; an administrator adds the LiveKit keys to turn video on.</span>
              </div>
            )}

            <div className="mb-8 grid w-full grid-cols-1 gap-5 md:grid-cols-3">
              <ActionCard icon={<Video className="h-6 w-6" />} tag="INSTANT" title="Start an instant meeting" body="Open a video room now, check your camera and microphone first, and link it to a CRM contact.">
                <p className="mb-2 flex items-center gap-2 text-[12px] text-[var(--text-muted)]"><span className="h-1.5 w-1.5 rounded-full bg-[var(--success)]" />Up to {meetingLimits.maxParticipants} people · {meetingLimits.maxDurationMinutes} min</p>
                <Button id="btn-hero-start-instant-meeting" variant="primary" className="h-10 w-full" icon={<Video className="h-4 w-4" />} onClick={() => openInstant()}>Start instant meeting</Button>
              </ActionCard>
              <ActionCard icon={<Users className="h-6 w-6" />} tag="JOIN" title="Join with a code" body="Join a teammate's meeting or a customer room with its code or link.">
                <form onSubmit={join} className="space-y-1.5" aria-label="Join a meeting">
                  <div className="flex gap-2">
                    <label htmlFor="input-meeting-code" className="sr-only">Meeting code or link</label>
                    <input id="input-meeting-code" className={cx(inputCls, 'font-mono')} placeholder="abc-defg-hij" value={joinCode} onChange={(e) => { setJoinCode(e.target.value); if (joinError) setJoinError(null); }} />
                    <Button type="submit" variant="secondary" className="h-[38px]" icon={<LogIn className="h-4 w-4" />} disabled={busy || !joinCode.trim()}>Join</Button>
                  </div>
                  {joinError && <p role="alert" className="text-[12px] text-[var(--danger)]">{joinError}</p>}
                  {onOpenRoom && <button type="button" id="btn-open-meeting-room" onClick={() => onOpenRoom(joinCode.trim())} className={cx('text-[12px] font-medium text-[var(--accent-text)] hover:underline', focusRing)}>Check camera & mic, then join</button>}
                </form>
              </ActionCard>
              <ActionCard icon={<CalendarDays className="h-6 w-6" />} tag="SCHEDULE" title="Schedule a meeting" body="Book a meeting, invite teammates, and send customers secure invitation links. It's saved for your whole organization.">
                <div className="flex gap-2">
                  <Button className="h-10 flex-1" variant="secondary" icon={<CalendarPlus className="h-4 w-4" />} onClick={() => setModal({ kind: 'schedule' })}>Schedule meeting</Button>
                  <IconButton label={`View ${upcoming.length} upcoming meetings`} className="h-10 w-10 border border-[var(--border)]" onClick={() => setTab('schedule')}><ChevronRight className="h-4 w-4" /></IconButton>
                </div>
              </ActionCard>
            </div>

            {invitations.length > 0 && (
              <Card className="mb-6 w-full p-5">
                <CardHeader title={`You're invited (${invitations.length})`} subtitle="Meetings your teammates invited you to" icon={<Mail className="h-4 w-4" />}
                  actions={<Button size="sm" variant="ghost" icon={<ChevronRight className="h-4 w-4" />} onClick={() => { setScheduleTab('invitations'); setTab('schedule'); }}>See all</Button>} />
                <ul className="mt-3 space-y-2">{invitations.slice(0, 3).map(meetingRow)}</ul>
              </Card>
            )}

            <div className="grid w-full grid-cols-1 items-start gap-6 lg:grid-cols-12">
              <Card className="p-5 sm:p-6 lg:col-span-7">
                <div className="mb-4 flex items-center justify-between gap-2 border-b border-[var(--border)] pb-4">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--danger-soft)] text-[var(--danger)]" aria-hidden="true"><Disc className="h-4 w-4" /></span>
                    <div><h3 className="text-[14px] font-semibold">Recent meetings, recordings & transcripts</h3><p className="text-[12px] text-[var(--text-muted)]">Who attended, outcomes, playback and transcripts</p></div>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => setTab('recordings')}>Open vault<ChevronRight className="h-3.5 w-3.5" /></Button>
                </div>
                {!hub && !hubError ? <div className="space-y-2"><Skeleton className="h-14" /><Skeleton className="h-14" /></div>
                  : history.length ? <ul className="space-y-2.5">{history.slice(0, 4).map((h) => historyRow(h, true))}</ul>
                  : <EmptyState icon={<Disc className="h-5 w-5" />} title="No meetings yet" body="Meetings you host or join appear here with who attended, the outcome, and any recording or transcript."
                      action={<Button size="sm" variant="primary" onClick={() => openInstant()}>Start instant meeting</Button>} />}
              </Card>

              <div className="space-y-4 lg:col-span-5">
                <Card className="p-5">
                  <div className="mb-3 flex items-center justify-between border-b border-[var(--border)] pb-2">
                    <span className="flex items-center gap-2 text-[13px] font-semibold"><CalendarDays className="h-4 w-4 text-[var(--accent-text)]" />{today.length ? "Today's meetings" : 'Coming up'}</span>
                    <Badge tone="accent">{today.length || upcoming.length} booked</Badge>
                  </div>
                  {!hub && !hubError ? <Skeleton className="h-16" /> : agenda.length ? (
                    <ul className="space-y-2.5">{agenda.map((m) => (
                      <li key={m.id} className="flex items-center justify-between gap-2 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface-sunken)] p-3">
                        <button type="button" className={cx('min-w-0 text-left', focusRing)} onClick={() => setModal({ kind: 'details', id: m.id })}>
                          <p className="truncate text-[13px] font-semibold">{m.title}</p>
                          <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">{relWhen(m.nextOccurrence?.startTime || m.startTime)} · <span className="font-mono">{m.roomCode}</span></p>
                        </button>
                        <Button size="sm" variant="secondary" disabled={busy} onClick={() => startScheduled(m)}>{m.canEdit && m.status !== 'LIVE' ? 'Start' : 'Join'}</Button>
                      </li>))}</ul>
                  ) : <p className="text-[13px] text-[var(--text-subtle)]">Nothing scheduled. <button type="button" className={cx('font-medium text-[var(--accent-text)] hover:underline', focusRing)} onClick={() => setModal({ kind: 'schedule' })}>Schedule a meeting</button></p>}
                </Card>

                <Card className="p-5">
                  <p className="mb-2 flex items-center gap-2 text-[13px] font-semibold"><Radio className="h-4 w-4 text-[var(--success)]" />Live in your organization</p>
                  {!hub ? <Skeleton className="h-8" /> : hub.live.length === 0 ? <p className="text-[13px] text-[var(--text-subtle)]">No meetings running right now.</p> : (
                    <ul className="space-y-1.5">{hub.live.map((l) => (
                      <li key={l.id} className="flex items-center gap-2 text-[13px]"><span className="h-2 w-2 rounded-full bg-[var(--success)]" aria-hidden="true" />
                        <span className="truncate">{l.title}</span><span className="shrink-0 text-[var(--text-subtle)]">{l.participantCount} in</span>
                        <Button size="sm" variant="ghost" className="ml-auto" onClick={() => onJoin(l.roomCode)}>Join</Button></li>))}</ul>
                  )}
                </Card>

                <Card className="space-y-3 p-4">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-[13px] font-semibold"><Gauge className="h-3.5 w-3.5 text-[var(--accent-text)]" />Your plan & devices</span>
                    <Badge tone="accent">{meetingPlanLabel}</Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[12px] text-[var(--text-muted)]">
                    <div className="flex items-center gap-1.5 rounded-xl border border-[var(--border)] bg-[var(--surface-sunken)] p-2"><Users className="h-3.5 w-3.5" />Up to {meetingLimits.maxParticipants} people</div>
                    <div className="flex items-center gap-1.5 rounded-xl border border-[var(--border)] bg-[var(--surface-sunken)] p-2"><Clock className="h-3.5 w-3.5" />{meetingLimits.maxDurationMinutes} min meetings</div>
                    <div className="flex items-center gap-1.5 rounded-xl border border-[var(--border)] bg-[var(--surface-sunken)] p-2">{meetingFeatures.recording ? <Check className="h-3.5 w-3.5 text-[var(--success)]" /> : <X className="h-3.5 w-3.5" />}Recording</div>
                    <div className="flex items-center gap-1.5 rounded-xl border border-[var(--border)] bg-[var(--surface-sunken)] p-2">{meetingFeatures.waitingRoom ? <Check className="h-3.5 w-3.5 text-[var(--success)]" /> : <X className="h-3.5 w-3.5" />}Waiting room</div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" className="flex-1" icon={<Camera className="h-3.5 w-3.5" />} onClick={() => setModal({ kind: 'devices' })}>Check devices</Button>
                    {onNavigate && <Button size="sm" variant="ghost" className="flex-1" onClick={() => onNavigate('billing')}>Compare plans<ChevronRight className="h-3.5 w-3.5" /></Button>}
                  </div>
                </Card>
              </div>
            </div>
          </div>
        )}

        {/* ================= CALL CANVAS STUDIO ================= */}
        {tab === 'canvas' && (
          <div className="w-full max-w-6xl">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-panel)] border border-[var(--border)] bg-[var(--surface)] p-3.5">
              <div className="flex flex-wrap items-center gap-2.5">
                <Button size="sm" variant="secondary" icon={<ArrowRight className="h-3.5 w-3.5 rotate-180" />} onClick={() => setTab('greet')}>Back to Greet Portal</Button>
                <span className="hidden h-4 w-px bg-[var(--border)] sm:block" aria-hidden="true" />
                <span className="text-[13px] font-semibold">Call Canvas Studio · phone calls, IVR and call workspace</span>
              </div>
              <Button size="sm" variant="primary" icon={<Video className="h-3.5 w-3.5" />} onClick={() => openInstant()}>Launch live video room</Button>
            </div>
            <div className="min-h-[640px] overflow-hidden rounded-[calc(var(--radius-panel)+6px)] border border-[var(--border)] shadow-xl">
              <CRMVoiceDialer onAddCalendarEvent={onAddCalendarEvent} onNavigate={onNavigate} />
            </div>
          </div>
        )}

        {/* ================= RECORDINGS & VAULT ================= */}
        {tab === 'recordings' && (
          <div className="w-full max-w-5xl space-y-6">
            <Card className="flex flex-col justify-between gap-4 p-5 sm:flex-row sm:items-center">
              <div className="flex items-center gap-2.5">
                <span className="rounded-xl bg-[var(--danger-soft)] p-2 text-[var(--danger)]" aria-hidden="true"><Disc className="h-5 w-5" /></span>
                <div><h2 className="text-[16px] font-semibold">Recordings & transcripts vault</h2><p className="text-[12px] text-[var(--text-muted)]">Cloud recordings for your organization, plus recordings and transcripts saved in this browser</p></div>
              </div>
              <Button id="btn-save-entire-transcript-vault" variant="primary" icon={<Save className="h-4 w-4" />} disabled={!isCallActive}
                title={isCallActive ? 'Save the running meeting\'s whole transcript to the vault' : 'Available while you are in a meeting'}
                onClick={() => { const r = saveCurrentMeetingTranscript(); notify(r.message); }}>Save meeting transcript</Button>
            </Card>

            <section aria-labelledby="greet-cloud-recordings" className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <h3 id="greet-cloud-recordings" className="text-[14px] font-semibold">Cloud recordings</h3>
                {!meetingFeatures.recording && <Badge tone="neutral">Not included in the {meetingPlanLabel} plan</Badge>}
                {!meetingFeatures.recording && onNavigate && <Button size="sm" variant="ghost" onClick={() => onNavigate('billing')}>Compare plans<ChevronRight className="h-3.5 w-3.5" /></Button>}
              </div>
              <RecordingsPanel notify={notify} />
            </section>

            <section aria-labelledby="greet-device-vault" className="space-y-3">
              <h3 id="greet-device-vault" className="text-[14px] font-semibold">Saved in this browser</h3>
              {pendingDevice.length > 0 && (
                <div className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-[13px] sm:flex-row sm:items-center">
                  <span className="flex-1">{pendingDevice.length} meeting{pendingDevice.length === 1 ? ' is' : 's are'} saved only in this browser. Move them to the server so they're kept and visible on your other devices.</span>
                  <Button size="sm" variant="primary" icon={<UploadCloud className="h-4 w-4" />} disabled={busy} onClick={importDeviceHistory}>Move to server</Button>
                </div>
              )}
              <div className="flex flex-col justify-between gap-3 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-3 sm:flex-row sm:items-center">
                <Segmented label="Vault filter" size="sm" value={vaultFilter} onChange={setVaultFilter} options={[
                  { value: 'all', label: `All (${meetingHistory.length})` },
                  { value: 'recordings', label: `Recordings (${meetingHistory.filter((m) => m.hasRecording).length})` },
                  { value: 'transcripts', label: `Transcripts (${meetingHistory.filter((m) => m.hasTranscript).length})` },
                ]} />
                <div className="relative flex-1 sm:max-w-xs"><Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-subtle)]" />
                  <input aria-label="Search the vault" className={cx(inputCls, 'h-9 py-1.5 pl-8 text-[13px]')} placeholder="Search title, room code or notes…" value={vaultSearch} onChange={(e) => setVaultSearch(e.target.value)} /></div>
              </div>
              {meetingHistory.length === 0 ? (
                <Card><EmptyState icon={<Disc className="h-5 w-5" />} title="Nothing saved in this browser" body="Device recordings and transcripts from your meetings appear here. Use Save meeting transcript during a meeting to keep its transcript." /></Card>
              ) : vaultItems.length === 0 ? <p className="text-[13px] text-[var(--text-subtle)]">Nothing matches.</p> : (
                <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {vaultItems.map((r) => (
                    <li key={r.id}><Card className="space-y-3 p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3">
                          <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--danger-soft)] text-[var(--danger)]" aria-hidden="true"><Play className="ml-0.5 h-5 w-5" /></span>
                          <div><h4 className="text-[14px] font-semibold leading-snug">{r.title}</h4><p className="mt-0.5 font-mono text-[11px] text-[var(--text-muted)]">{r.date} at {r.time} · {r.durationFormatted}</p></div>
                        </div>
                        {r.recordingSize && <Badge tone="neutral">{r.recordingSize}</Badge>}
                      </div>
                      <div className="flex items-center justify-between gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-sunken)] p-2.5 text-[12px]">
                        <span className="font-mono text-[var(--text-muted)]">Room: {r.roomId}</span>
                        <div className="flex -space-x-1">{r.participants.slice(0, 5).map((p, i) => (
                          <span key={i} title={p.name} className="flex h-6 w-6 items-center justify-center rounded-full border border-[var(--surface)] bg-[var(--accent-soft)] text-[10px] font-bold text-[var(--accent-text)]">{(p.avatar && p.avatar.length <= 3 ? p.avatar : p.name.slice(0, 2)).toUpperCase()}</span>))}</div>
                      </div>
                      {r.notes && <p className="line-clamp-2 rounded-lg bg-[var(--surface-sunken)] p-2 text-[12px] italic text-[var(--text-muted)]">“{r.notes}”</p>}
                      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-3">
                        {r.recordingUrl && <Button size="sm" variant="primary" icon={<Play className="h-3.5 w-3.5" />} onClick={() => setModal({ kind: 'watch', record: r })}>Watch</Button>}
                        <Button size="sm" variant="secondary" icon={<FileText className="h-3.5 w-3.5" />} disabled={!r.transcript.length} onClick={() => setModal({ kind: 'transcript', record: r })}>Transcript ({r.transcript.length})</Button>
                        {r.transcript.length > 0 && <IconButton label="Download transcript as PDF" onClick={() => downloadTranscriptPdf(r).catch(() => notify('The PDF couldn\'t be created.'))}><Download className="h-4 w-4" /></IconButton>}
                        <IconButton label="Delete from this browser" className="ml-auto hover:text-[var(--danger)]" onClick={() => { if (window.confirm('Delete this recording and transcript from this browser?')) deleteMeetingHistoryItem(r.id); }}><Trash2 className="h-4 w-4" /></IconButton>
                      </div>
                    </Card></li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}

        {/* ================= SCHEDULE ================= */}
        {tab === 'schedule' && (
          <div className="w-full max-w-4xl space-y-5">
            <Card className="flex flex-col justify-between gap-3 p-4 sm:flex-row sm:items-center">
              <div><h2 className="text-[16px] font-semibold">Scheduled video meetings</h2><p className="text-[12px] text-[var(--text-muted)]">Saved for your organization and shown on the CRM calendar</p></div>
              <div className="flex flex-wrap gap-2">
                {onNavigate && <Button variant="ghost" icon={<CalendarDays className="h-4 w-4" />} onClick={() => onNavigate('calendar')}>Open calendar</Button>}
                <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setModal({ kind: 'schedule' })}>Schedule meeting</Button>
              </div>
            </Card>
            <Segmented label="Schedule sections" value={scheduleTab} onChange={setScheduleTab} options={[
              { value: 'upcoming', label: `Upcoming${upcoming.length ? ` (${upcoming.length})` : ''}` },
              { value: 'invitations', label: `Invitations${invitations.length ? ` (${invitations.length})` : ''}` },
              { value: 'history', label: 'History' },
            ]} />
            {scheduleTab !== 'history' && (
              !hub && !hubError ? <div className="space-y-2"><Skeleton className="h-16" /><Skeleton className="h-16" /></div> : (
                (scheduleTab === 'upcoming' ? upcoming : invitations).length
                  ? <ul className="space-y-2">{(scheduleTab === 'upcoming' ? upcoming : invitations).map(meetingRow)}</ul>
                  : <Card><EmptyState icon={<CalendarPlus className="h-5 w-5" />} title={scheduleTab === 'upcoming' ? 'No upcoming meetings' : 'No invitations'}
                      body={scheduleTab === 'upcoming' ? 'Schedule a meeting and invite teammates or customers.' : 'When a teammate invites you to a meeting, it appears here.'}
                      action={scheduleTab === 'upcoming' ? <Button variant="primary" onClick={() => setModal({ kind: 'schedule' })}>Schedule meeting</Button> : undefined} /></Card>
              )
            )}
            {scheduleTab === 'history' && (
              <div className="space-y-3">
                {pendingDevice.length > 0 && (
                  <div className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-[13px] sm:flex-row sm:items-center">
                    <span className="flex-1">{pendingDevice.length} meeting{pendingDevice.length === 1 ? ' is' : 's are'} saved only in this browser. Move them to the server so they're kept and visible on your other devices.</span>
                    <Button size="sm" variant="primary" icon={<UploadCloud className="h-4 w-4" />} disabled={busy} onClick={importDeviceHistory}>Move to server</Button>
                  </div>
                )}
                {!hub && !hubError ? <Skeleton className="h-24" /> : history.length === 0
                  ? <Card><EmptyState icon={<HistoryIcon className="h-5 w-5" />} title="No meetings yet" body="Meetings you host or join appear here with who attended and how they went." /></Card>
                  : <ul className="space-y-2">{history.map((h) => historyRow(h))}</ul>}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Footer and quick actions */}
      <footer className="relative z-20 flex w-full items-center justify-between gap-3 border-t border-[var(--border)] bg-[var(--surface)]/60 px-4 py-3 backdrop-blur-sm sm:px-6">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--text-subtle)]">
          <span className="inline-flex items-center gap-1.5"><Shield className="h-3.5 w-3.5 text-[var(--success)]" />Encrypted in transit</span>
          <span className="hidden sm:inline">•</span><span className="hidden sm:inline">{videoStatus ? 'Video by LiveKit' : 'Video not connected on this server'}</span>
          <span className="hidden sm:inline">•</span><span className="hidden sm:inline">Limits applied by the server ({meetingPlanLabel} plan)</span>
        </p>
        <div className="relative" ref={quickRef}>
          <button type="button" id="floating-btn-video-action" aria-label="Quick meeting actions" aria-expanded={quickOpen} aria-haspopup="menu" onClick={() => setQuickOpen(!quickOpen)}
            className={cx('flex h-12 w-12 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--accent-contrast)] shadow-lg transition-transform hover:scale-105 active:scale-95', focusRing)}>
            <Video className="h-5 w-5" />
          </button>
          {quickOpen && (
            <div role="menu" className="absolute bottom-16 right-0 z-50 w-64 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-2 text-[13px] shadow-2xl">
              <p className="border-b border-[var(--border)] px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-subtle)]">Quick actions</p>
              {[
                { icon: <Plus className="h-4 w-4 text-[var(--accent-text)]" />, label: 'Start instant meeting', run: () => openInstant() },
                { icon: <PhoneCall className="h-4 w-4 text-[var(--accent-text)]" />, label: 'Open Call Canvas Studio', run: () => setTab('canvas') },
                { icon: <CalendarPlus className="h-4 w-4 text-[var(--accent-text)]" />, label: 'Schedule for later', run: () => setModal({ kind: 'schedule' }) },
                { icon: <Camera className="h-4 w-4 text-[var(--accent-text)]" />, label: 'Check camera & microphone', run: () => setModal({ kind: 'devices' }) },
                ...(upcoming[0]?.videoLink ? [{ icon: <Copy className="h-4 w-4 text-[var(--text-muted)]" />, label: `Copy link: ${upcoming[0].title}`, run: () => copy(absoluteLink(upcoming[0].videoLink!), 'Link for teammates copied (they sign in to join).') }] : []),
              ].map((a) => (
                <button key={a.label} role="menuitem" type="button" onClick={() => { setQuickOpen(false); a.run(); }}
                  className={cx('flex w-full items-center gap-2.5 rounded-[var(--radius-control)] px-3 py-2.5 text-left font-medium hover:bg-[var(--surface-sunken)]', focusRing)}>
                  {a.icon}<span className="truncate">{a.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </footer>

      {modal?.kind === 'instant' && (
        <InstantMeetingModal contacts={contacts} initial={modal} onClose={() => setModal(null)}
          onConfirm={async (o) => {
            setModal(null); setBusy(true);
            try { await onStart(o.roomCode || undefined, contacts.find((c) => c.id === o.leadId), o.title.trim() || undefined, { autoRecord: o.autoRecord, autoTranscribe: o.autoTranscribe, startMuted: o.startMuted, startCamOff: o.startCamOff }); }
            finally { setBusy(false); }
          }} />
      )}
      {modal?.kind === 'schedule' && (
        <Modal title="Schedule a GREET meeting" onClose={() => setModal(null)} wide>
          <ScheduleForm initial={modal.initial} contacts={contacts} onCancel={() => setModal(null)} onDone={(_, msg) => { notify(msg); setModal(null); setScheduleTab('upcoming'); setTab('schedule'); load(); }} />
        </Modal>
      )}
      {modal?.kind === 'details' && (
        <MeetingDetails meetingId={modal.id} contacts={contacts} notify={notify} onClose={() => { setModal(null); load(); }}
          onStart={(m) => { setModal(null); startScheduled(m); }}
          onScheduleAnother={(m) => setModal({ kind: 'schedule', initial: { title: m.title, duration: m.duration, guests: m.guests, inviteeIds: m.invitees.map((i) => i.userId), associations: m.associations } })} />
      )}
      {modal?.kind === 'devices' && <DeviceCheck onClose={() => setModal(null)} />}
      {modal?.kind === 'watch' && <WatchRecording record={modal.record} notify={notify} onClose={() => setModal(null)} />}
      {modal?.kind === 'transcript' && <ViewTranscript record={modal.record} notify={notify} onClose={() => setModal(null)} />}
      {toast && <div role="status" className="fixed bottom-6 left-1/2 z-[70] max-w-[92vw] -translate-x-1/2 rounded-xl bg-neutral-900 px-4 py-2.5 text-[13px] text-white shadow-xl">{toast}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cloud recordings (LiveKit Egress); recordings kept in this browser are in the vault above
// ---------------------------------------------------------------------------

function RecordingsPanel({ notify }: { notify: (t: string) => void }) {
  const [data, setData] = useState<{ recordings: any[]; cloud: { enabled: boolean; configured: boolean; retentionDays: number } } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retention, setRetention] = useState('30');
  const load = useCallback(async () => {
    try { const r = await greetApi<any>('/api/greet/recordings'); setData(r); setRetention(String(r.cloud.retentionDays)); setError(null); } catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const save = async (patch: { recordingEnabled?: boolean; recordingRetentionDays?: number }) => {
    try { await greetApi('/api/greet/settings', { method: 'PUT', body: JSON.stringify(patch) }); notify('Recording settings saved.'); load(); }
    catch (e) { notify((e as GreetApiError).status === 403 ? 'Only owners and admins can change recording settings.' : (e as Error).message); }
  };
  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2"><Settings2 className="h-4 w-4 text-[var(--text-muted)]" /><h3 className="text-[14px] font-semibold text-[var(--text)]">Cloud recording</h3>
          {data && <Badge tone={data.cloud.enabled && data.cloud.configured ? 'success' : 'neutral'}>{!data.cloud.configured ? 'Not set up on this server' : data.cloud.enabled ? 'On' : 'Off'}</Badge>}</div>
        <p className="text-[13px] text-[var(--text-muted)]">Off by default. When an admin turns it on (and LiveKit Egress storage is configured), hosts can record meetings to your organization's storage. Everyone in the meeting must agree first, and everyone sees when recording is on. Recordings are deleted automatically after the retention period.</p>
        {data && (
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" checked={data.cloud.enabled} disabled={!data.cloud.configured} onChange={(e) => save({ recordingEnabled: e.target.checked })} />Allow cloud recording</label>
            <div><label className={labelCls} htmlFor="greet-retention">Keep recordings for (days)</label>
              <input id="greet-retention" type="number" min={1} max={3650} className={cx(inputCls, 'w-28')} value={retention} onChange={(e) => setRetention(e.target.value)} /></div>
            <Button size="sm" variant="secondary" onClick={() => save({ recordingRetentionDays: Number(retention) || 30 })}>Save</Button>
          </div>
        )}
      </Card>
      <ErrorLine text={error} />
      {!data && !error ? <Skeleton className="h-20" /> : data && data.recordings.length === 0 ? (
        <EmptyState icon={<Disc className="h-5 w-5" />} title="No recordings" body="Cloud recordings you host (or all of them, for admins) appear here." />
      ) : (
        <ul className="space-y-2">
          {(data?.recordings || []).map((r) => (
            <li key={r.id}><Card className="p-3.5 flex flex-col sm:flex-row sm:items-center gap-2">
              <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="font-medium text-[14px] truncate text-[var(--text)]">{r.title}</p>
                <Badge tone={r.status === 'ready' ? 'success' : r.status === 'failed' ? 'danger' : 'warning'}>{({ recording: 'Recording', processing: 'Processing', ready: 'Ready', failed: 'Failed', deletion_pending: 'Deleting' } as any)[r.status] || r.status}</Badge></div>
                <p className="text-[12px] text-[var(--text-muted)]">{new Date(r.startedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}{r.durationSeconds ? ` · ${Math.round(r.durationSeconds / 60)} min` : ''} · {r.consents.length} consented · deleted after {new Date(r.deleteAfter).toLocaleDateString()}</p></div>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" icon={<Download className="h-4 w-4" />} disabled={r.status !== 'ready'} onClick={async () => {
                  try { const d = await greetApi<any>(`/api/greet/recordings/${encodeURIComponent(r.id)}`); if (d.downloadUrl) window.open(d.downloadUrl, '_blank', 'noopener'); else notify('The file isn\'t available to download yet.'); } catch (e) { notify((e as Error).message); }
                }}>Download</Button>
                <Button size="sm" variant="ghost" icon={<Trash2 className="h-4 w-4" />} disabled={r.status === 'recording'} onClick={async () => {
                  if (!window.confirm('Delete this recording for everyone? This can\'t be undone.')) return;
                  try { const d = await greetApi<any>(`/api/greet/recordings/${encodeURIComponent(r.id)}`, { method: 'DELETE' }); notify(d.message); load(); } catch (e) { notify((e as Error).message); }
                }}>Delete</Button>
              </div>
            </Card></li>
          ))}
        </ul>
      )}
    </div>
  );
}
