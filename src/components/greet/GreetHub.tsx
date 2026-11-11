/**
 * GREET: the CRM's video meetings home (the `greet` view). Everything here comes from the server:
 *   GET /api/meetings/hub        upcoming, invitations, history, live
 *   /api/meetings/*              schedule, reschedule, cancel, outcome, guest invitation links
 *   /api/greet/recordings|settings  cloud recordings (LiveKit Egress) and recording settings
 * Meeting history that older versions kept in this browser is shown as "on this device" until it's moved
 * to the server (POST /api/meetings/history/import).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Video, CalendarPlus, LogIn, Users, Clock, Link2, Copy, X, Check, AlertTriangle, Radio, History as HistoryIcon,
  Mail, Trash2, Download, Settings2, CalendarClock, ListChecks, Repeat, Camera, Mic, ChevronRight, Disc, UploadCloud,
} from 'lucide-react';
import { Badge, Button, Card, EmptyState, Segmented, Skeleton, cx, focusRing } from '../dashboard/ui';
import { useMeetingSession } from '../../context/MeetingSessionContext';
import { useNotifications } from '../../context/NotificationContext';
import { useTeamMembers } from '../../hooks/useTeamMembers';
import type { CRMContact } from '../../types';
import {
  GreetApiError, absoluteLink, cancelMeeting, createFollowUpTask, createInvites, getHub, getMeeting, greetApi, recordOutcome, relWhen, revokeInvite,
  scheduleMeeting, updateMeeting, MEETINGS_CHANGED, type GreetMeeting, type HistoryItem, type Hub, type ScheduleInput,
} from '../../lib/greetClient';

interface Props {
  contacts?: CRMContact[];
  onStart: (roomCode?: string, contact?: CRMContact, title?: string, options?: { startMuted?: boolean; startCamOff?: boolean; scheduledMeetingId?: string }) => Promise<void>;
  onJoin: (codeOrLink: string) => Promise<void>;
  onNavigate?: (view: string) => void;
}

type Tab = 'upcoming' | 'invitations' | 'history' | 'recordings';
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
// Page
// ---------------------------------------------------------------------------

export default function GreetHub({ contacts = [], onStart, onJoin, onNavigate }: Props) {
  const { meetingHistory, isCallActive, returnToMeeting, activeMeeting } = useMeetingSession();
  const { pushNotification } = useNotifications();
  const [hub, setHub] = useState<Hub | null>(null);
  const [hubError, setHubError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('upcoming');
  const [joinCode, setJoinCode] = useState('');
  const [modal, setModal] = useState<null | { kind: 'schedule'; initial?: Partial<ScheduleInput> } | { kind: 'instant' } | { kind: 'details'; id: string } | { kind: 'devices' }>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [media, setMedia] = useState<{ configured: boolean } | null>(null);
  const [instant, setInstant] = useState({ title: '', leadId: '', startMuted: false, startCamOff: false });
  const [busy, setBusy] = useState(false);
  const toastTimer = useRef<number | null>(null);

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
    const on = () => { load(); };
    window.addEventListener(MEETINGS_CHANGED, on);
    const poll = window.setInterval(load, 60_000);
    return () => { window.removeEventListener(MEETINGS_CHANGED, on); window.clearInterval(poll); };
  }, [load]);

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

  const start = async (m?: GreetMeeting) => {
    setBusy(true);
    try {
      if (m && m.status === 'LIVE' && !m.canEdit) await onJoin(m.roomCode);
      else if (m) await onStart(undefined, undefined, undefined, { scheduledMeetingId: m.id });
      else {
        const lead = contacts.find((c) => c.id === instant.leadId);
        await onStart(undefined, lead, instant.title.trim() || undefined, { startMuted: instant.startMuted, startCamOff: instant.startCamOff });
      }
    } finally { setBusy(false); }
  };
  const join = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = joinCode.trim();
    if (!v) return;
    setBusy(true);
    try { await onJoin(v); } finally { setBusy(false); }
  };

  const counts = { upcoming: hub?.upcoming.length ?? 0, invitations: hub?.invitations.length ?? 0 };
  const history = [...(hub?.history ?? []), ...pendingDevice].sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));

  return (
    <div className="min-h-full shrink-0 w-full bg-[var(--app-bg)]">
      <div className="mx-auto w-full max-w-[1280px] px-4 sm:px-6 lg:px-8 py-5 sm:py-7 space-y-5">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[var(--accent-text)]"><Video className="h-3.5 w-3.5" aria-hidden="true" />Video meetings</p>
            <h1 className="mt-1 text-[26px] sm:text-[30px] font-semibold tracking-[-0.03em] text-[var(--text)]">GREET</h1>
            <p className="mt-1 text-[14px] text-[var(--text-muted)] max-w-2xl">Start, schedule and join video meetings with your team and customers. Meetings link to your leads and deals, and notes and outcomes are saved to the CRM.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {isCallActive && <Button variant="secondary" icon={<Radio className="h-4 w-4" />} onClick={returnToMeeting}>Return to “{activeMeeting?.title || 'meeting'}”</Button>}
            <Button variant="secondary" icon={<Camera className="h-4 w-4" />} onClick={() => setModal({ kind: 'devices' })}>Check devices</Button>
            <Button variant="secondary" icon={<CalendarPlus className="h-4 w-4" />} onClick={() => setModal({ kind: 'schedule' })}>Schedule meeting</Button>
            <Button variant="primary" icon={<Video className="h-4 w-4" />} onClick={() => setModal({ kind: 'instant' })}>Start instant meeting</Button>
          </div>
        </header>

        {media && !media.configured && (
          <div role="status" className="flex items-start gap-2 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--warning-soft)] px-4 py-3 text-[13px] text-[var(--text)]">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--warning)]" />
            <span>Audio and video between people aren't connected on this server yet (LiveKit isn't configured). You can still schedule meetings and send invitations; an administrator adds the LiveKit keys to turn video on.</span>
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <Card className="p-4">
            <form onSubmit={join} className="flex flex-col sm:flex-row gap-2" aria-label="Join a meeting">
              <label htmlFor="greet-join" className="sr-only">Meeting code or link</label>
              <div className="relative flex-1"><Link2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-subtle)]" />
                <input id="greet-join" className={cx(inputCls, 'pl-9')} placeholder="Enter a meeting code or paste a link (abc-defg-hij)" value={joinCode} onChange={(e) => setJoinCode(e.target.value)} /></div>
              <Button type="submit" variant="secondary" icon={<LogIn className="h-4 w-4" />} disabled={busy || !joinCode.trim()}>Join</Button>
            </form>
          </Card>
          <Card className="p-4">
            <p className="text-[12px] font-medium text-[var(--text-muted)]">Live in your organization</p>
            {!hub ? <Skeleton className="mt-2 h-8" /> : hub.live.length === 0 ? <p className="mt-1 text-[13px] text-[var(--text-subtle)]">No meetings running right now.</p> : (
              <ul className="mt-1 space-y-1.5">{hub.live.map((l) => (
                <li key={l.id} className="flex items-center gap-2 text-[13px]"><span className="h-2 w-2 rounded-full bg-[var(--success)]" aria-hidden="true" />
                  <span className="truncate">{l.title}</span><span className="text-[var(--text-subtle)] shrink-0">{l.participantCount} in</span>
                  <Button size="sm" variant="ghost" className="ml-auto" onClick={() => onJoin(l.roomCode)}>Join</Button></li>))}</ul>
            )}
          </Card>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <Segmented label="GREET sections" value={tab} onChange={setTab} options={[
            { value: 'upcoming', label: `Upcoming${counts.upcoming ? ` (${counts.upcoming})` : ''}` },
            { value: 'invitations', label: `Invitations${counts.invitations ? ` (${counts.invitations})` : ''}` },
            { value: 'history', label: 'History' },
            { value: 'recordings', label: 'Recordings' },
          ]} />
          {onNavigate && <Button size="sm" variant="ghost" icon={<ChevronRight className="h-4 w-4" />} onClick={() => onNavigate('calendar')}>Open calendar</Button>}
        </div>

        {hubError && <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[var(--danger-soft)] px-4 py-3 text-[13px] text-[var(--danger)]"><span>{hubError}</span><Button size="sm" variant="secondary" onClick={load}>Try again</Button></div>}

        {(tab === 'upcoming' || tab === 'invitations') && (
          !hub && !hubError ? <div className="space-y-2"><Skeleton className="h-16" /><Skeleton className="h-16" /></div> : (
            (tab === 'upcoming' ? hub?.upcoming : hub?.invitations)?.length ? (
              <ul className="space-y-2">{(tab === 'upcoming' ? hub!.upcoming : hub!.invitations).map((m) => (
                <li key={m.id}>
                  <Card className="p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-[15px] text-[var(--text)] truncate">{m.title}</p>
                        <Badge tone={STATUS_TONE[m.status]}>{STATUS_LABEL[m.status]}</Badge>
                        {m.yourRole === 'invitee' && <Badge tone="info">Invited by {m.hostName || 'a teammate'}</Badge>}
                      </div>
                      <p className="mt-0.5 text-[13px] text-[var(--text-muted)] flex flex-wrap gap-x-3">
                        <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{relWhen(m.nextOccurrence?.startTime || m.startTime)} · {m.duration} min</span>
                        <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" />{m.invitees.length + m.guests.length + 1} people</span>
                        {m.associations?.label && <span>{m.associations.label}</span>}
                      </p>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <Button size="sm" variant="secondary" onClick={() => setModal({ kind: 'details', id: m.id })}>Details</Button>
                      <Button size="sm" variant="primary" disabled={busy} icon={<Video className="h-4 w-4" />} onClick={() => start(m)}>{m.status === 'LIVE' ? 'Join' : m.canEdit ? 'Start' : 'Join'}</Button>
                    </div>
                  </Card>
                </li>))}</ul>
            ) : <EmptyState icon={<CalendarPlus className="h-5 w-5" />} title={tab === 'upcoming' ? 'No upcoming meetings' : 'No invitations'}
                body={tab === 'upcoming' ? 'Schedule a GREET meeting and invite teammates or customers.' : 'When a teammate invites you to a GREET meeting, it appears here.'}
                action={tab === 'upcoming' ? <Button variant="primary" onClick={() => setModal({ kind: 'schedule' })}>Schedule meeting</Button> : undefined} />
          )
        )}

        {tab === 'history' && (
          <div className="space-y-3">
            {pendingDevice.length > 0 && (
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-[13px]">
                <span className="flex-1">{pendingDevice.length} meeting{pendingDevice.length === 1 ? ' is' : 's are'} saved only in this browser. Move them to the server so they're kept and visible on your other devices.</span>
                <Button size="sm" variant="primary" icon={<UploadCloud className="h-4 w-4" />} disabled={busy} onClick={importDeviceHistory}>Move to server</Button>
              </div>
            )}
            {!hub && !hubError ? <Skeleton className="h-24" /> : history.length === 0 ? <EmptyState icon={<HistoryIcon className="h-5 w-5" />} title="No meetings yet" body="Meetings you host or join appear here with who attended and how they went." /> : (
              <ul className="space-y-2">{history.map((h) => (
                <li key={`${h.source}:${h.id}`}><Card className="p-3.5 flex flex-col sm:flex-row sm:items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2"><p className="font-medium text-[14px] text-[var(--text)] truncate">{h.title}</p>
                      {h.source === 'device' && <Badge tone="warning">On this device</Badge>}
                      {h.source === 'imported' && <Badge tone="neutral">Imported</Badge>}
                      {h.outcome && <Badge tone="success">{OUTCOMES.find(([k]) => k === h.outcome!.result)?.[1] || h.outcome.result}</Badge>}
                      {h.recordingUsed && <Badge tone="danger"><Disc className="h-3 w-3" />Recorded</Badge>}</div>
                    <p className="text-[12px] text-[var(--text-muted)]">{h.startedAt ? new Date(h.startedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Date unknown'} · {h.minutes} min · {h.participants.length} {h.participants.length === 1 ? 'person' : 'people'}{h.associations?.label ? ` · ${h.associations.label}` : ''}</p>
                  </div>
                  {h.scheduledMeetingId && <Button size="sm" variant="secondary" onClick={() => setModal({ kind: 'details', id: h.scheduledMeetingId! })}>Outcome & follow-up</Button>}
                </Card></li>))}</ul>
            )}
          </div>
        )}

        {tab === 'recordings' && <RecordingsPanel notify={notify} />}
      </div>

      {modal?.kind === 'schedule' && (
        <Modal title="Schedule a GREET meeting" onClose={() => setModal(null)} wide>
          <ScheduleForm initial={modal.initial} contacts={contacts} onCancel={() => setModal(null)} onDone={(_, msg) => { notify(msg); setModal(null); setTab('upcoming'); load(); }} />
        </Modal>
      )}
      {modal?.kind === 'instant' && (
        <Modal title="Start an instant meeting" onClose={() => setModal(null)}>
          <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); setModal(null); await start(); }}>
            <div><label className={labelCls} htmlFor="greet-instant-title">Title (optional)</label><input id="greet-instant-title" className={inputCls} value={instant.title} onChange={(e) => setInstant({ ...instant, title: e.target.value })} placeholder="Quick call" /></div>
            <div><label className={labelCls} htmlFor="greet-instant-lead">Link to a lead (optional)</label>
              <select id="greet-instant-lead" className={inputCls} value={instant.leadId} onChange={(e) => setInstant({ ...instant, leadId: e.target.value })}>
                <option value="">No CRM record</option>{contacts.map((c) => <option key={c.id} value={c.id}>{c.name}{c.company ? ` · ${c.company}` : ''}</option>)}</select></div>
            <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" checked={instant.startMuted} onChange={(e) => setInstant({ ...instant, startMuted: e.target.checked })} />Join with microphone off</label>
            <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" checked={instant.startCamOff} onChange={(e) => setInstant({ ...instant, startCamOff: e.target.checked })} />Join with camera off</label>
            <div className="flex justify-end gap-2 pt-1"><Button type="button" variant="secondary" onClick={() => setModal(null)}>Cancel</Button><Button type="submit" variant="primary" icon={<Video className="h-4 w-4" />}>Start now</Button></div>
          </form>
        </Modal>
      )}
      {modal?.kind === 'details' && (
        <MeetingDetails meetingId={modal.id} contacts={contacts} notify={notify} onClose={() => { setModal(null); load(); }}
          onStart={(m) => { setModal(null); start(m); }}
          onScheduleAnother={(m) => setModal({ kind: 'schedule', initial: { title: m.title, duration: m.duration, guests: m.guests, inviteeIds: m.invitees.map((i) => i.userId), associations: m.associations } })} />
      )}
      {modal?.kind === 'devices' && <DeviceCheck onClose={() => setModal(null)} />}
      {toast && <div role="status" className="fixed bottom-6 left-1/2 z-[70] -translate-x-1/2 max-w-[92vw] rounded-xl bg-neutral-900 px-4 py-2.5 text-[13px] text-white shadow-xl">{toast}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recordings (cloud: LiveKit Egress; device: this browser only)
// ---------------------------------------------------------------------------

function RecordingsPanel({ notify }: { notify: (t: string) => void }) {
  const { meetingHistory } = useMeetingSession();
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
  const device = meetingHistory.filter((h) => h.hasRecording && h.recordingUrl);
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
      {!data && !error ? <Skeleton className="h-20" /> : data && data.recordings.length === 0 && device.length === 0 ? (
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
          {device.map((h) => (
            <li key={h.id}><Card className="p-3.5 flex flex-col sm:flex-row sm:items-center gap-2">
              <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="font-medium text-[14px] truncate text-[var(--text)]">{h.title}</p><Badge tone="warning">On this device</Badge></div>
                <p className="text-[12px] text-[var(--text-muted)]">{h.recordingSize || ''} · available until you close or reload this tab</p></div>
              <a className={cx('inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-[var(--border)] px-3 py-1.5 text-[13px] text-[var(--text)] hover:bg-[var(--surface-sunken)]', focusRing)} href={h.recordingUrl} download={`greet-${h.id}.webm`}><Download className="h-4 w-4" />Save file</a>
            </Card></li>
          ))}
        </ul>
      )}
    </div>
  );
}
