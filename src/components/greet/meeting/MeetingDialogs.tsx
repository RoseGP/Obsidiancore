/** Secondary dialogs reached from the More menu. */
import React, { useState } from 'react';
import { Check, Circle, Copy, Disc, HelpCircle, Image as ImageIcon, Info, Keyboard, LogOut, PhoneOff, Sparkles, UserPlus } from 'lucide-react';
import { MEETING_PLANS, useMeetingSession, type MeetingPlanTier } from '../../../context/MeetingSessionContext';
import { VIDEO_FILTERS, setBackgroundBlur, supportsBackgroundBlur, type VideoFilterId } from '../../../lib/meetingMedia';
import { MeetingDialog } from './MeetingDialog';
import { useNotify } from './NotificationSystem';
import { SHORTCUTS, useMeetingUi } from './useMeetingUi';

export const meetingLink = (roomId?: string) => `${window.location.origin}/?tab=greet&meet=${roomId || ''}`;

export function useCopy() {
  const notify = useNotify();
  return (text: string, what: string) =>
    navigator.clipboard.writeText(text).then(() => notify(`${what} copied`, 'success')).catch(() => notify(`Couldn’t copy. ${what}: ${text}`, 'warning', { durationMs: 9000 }));
}

const fmt = (s: number) => `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;

export function MeetingInfoDialog() {
  const ui = useMeetingUi();
  return ui.dialog === 'info' ? <MeetingInfoBody /> : null;
}

function MeetingInfoBody() {
  const ui = useMeetingUi();
  const { activeMeeting, sessionLimits, sessionTime, remainingSeats, updateMeetingTitle, currentPlanTier, setPlanTier } = useMeetingSession();
  const copy = useCopy();
  const [title, setTitle] = useState(activeMeeting?.title ?? '');
  const link = meetingLink(activeMeeting?.roomId);
  const row = (k: string, v: React.ReactNode) => (
    <div key={k} className="flex items-center justify-between gap-3 py-2 text-[13.5px]" style={{ borderBottom: '1px solid var(--m-line)' }}>
      <span className="m-muted">{k}</span><span className="m-num min-w-0 truncate text-right">{v}</span>
    </div>
  );
  return (
    <MeetingDialog open onClose={ui.closeDialog} title="Meeting information" icon={<Info size={19} />} width={500}>
      <form className="mb-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (title.trim()) { updateMeetingTitle(title.trim()); ui.closeDialog(); } }}>
        <input id="info-title" className="m-input" aria-label="Meeting title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
        <button type="submit" className="m-btn flex-none" disabled={!title.trim() || title.trim() === activeMeeting?.title}>Rename</button>
      </form>
      {row("Meeting ID", <button type="button" className="m-btn m-btn-ghost m-btn-sm" onClick={() => copy(activeMeeting?.roomId || '', 'Meeting ID')}>{activeMeeting?.roomId}<Copy size={13} aria-hidden /></button>)}
      {row("Host", activeMeeting?.hostName)}
      {row("Started", activeMeeting ? new Date(activeMeeting.startedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—')}
      {row("Time", sessionTime?.remainingSeconds != null ? `${fmt(sessionTime.elapsedSeconds)} of ${sessionLimits.maxDurationMinutes}:00 · ${fmt(sessionTime.remainingSeconds)} left` : `${fmt(activeMeeting?.durationSeconds ?? 0)} · no time limit`)}
      {row("People", `${(activeMeeting?.participants.length ?? 0) + 1} of ${sessionLimits.maxParticipants} · ${remainingSeats} seats left`)}
      {row("Encryption", "Encrypted in transit (WebRTC DTLS-SRTP)")}
      <div className="mt-4">
        <span className="m-label">Plan for your next meeting</span>
        <div className="grid grid-cols-3 gap-2">
          {(Object.keys(MEETING_PLANS) as MeetingPlanTier[]).map((t) => {
            const p = MEETING_PLANS[t];
            return (
              <button key={t} type="button" aria-pressed={currentPlanTier === t} onClick={() => setPlanTier(t)} className="rounded-xl px-3 py-2 text-left"
                style={{ background: currentPlanTier === t ? 'var(--m-accent-tint)' : 'var(--m-raised)', border: `1px solid ${currentPlanTier === t ? 'var(--m-accent)' : 'transparent'}`, color: 'var(--m-text)', font: 'inherit', cursor: 'pointer' }}>
                <span className="block text-[13px] font-semibold capitalize">{t}</span>
                <span className="m-muted block text-[11.5px]">{p.maxParticipants} people · {p.maxDurationMinutes ? `${p.maxDurationMinutes} min` : 'no limit'}</span>
              </button>
            );
          })}
        </div>
        <p className="m-faint mt-2 text-[12px]">This meeting keeps the limits it started with.</p>
      </div>
      <div className="mt-4 flex gap-2">
        <input readOnly id="info-link" className="m-input" value={link} aria-label="Meeting link" onFocus={(e) => e.currentTarget.select()} />
        <button type="button" className="m-btn m-btn-primary flex-none" onClick={() => copy(link, 'Meeting link')}><Copy size={14} aria-hidden />Copy link</button>
      </div>
    </MeetingDialog>
  );
}

export function InviteDialog() {
  const ui = useMeetingUi();
  const { activeMeeting, inviteParticipantByEmail, sessionLimits, remainingSeats } = useMeetingSession();
  const copy = useCopy();
  const [emails, setEmails] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  if (ui.dialog !== 'invite') return null;
  const link = meetingLink(activeMeeting?.roomId);
  const total = (activeMeeting?.participants.length ?? 0) + 1;
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emails.trim()) return;
    setBusy(true);
    const r = await inviteParticipantByEmail(emails.trim());
    setBusy(false);
    setResult({ ok: r.success, text: r.message });
    if (r.success) setEmails('');
  };
  return (
    <MeetingDialog open onClose={() => { setResult(null); ui.closeDialog(); }} title="Invite people" description={`${total} of ${sessionLimits.maxParticipants} in the meeting · ${remainingSeats} seats left`} icon={<UserPlus size={19} />} width={480}>
      <span className="m-label">Meeting link</span>
      <div className="mb-4 flex gap-2">
        <input readOnly id="invite-link" className="m-input" value={link} aria-label="Meeting link" onFocus={(e) => e.currentTarget.select()} />
        <button type="button" className="m-btn flex-none" onClick={() => copy(link, 'Meeting link')}><Copy size={14} aria-hidden />Copy</button>
      </div>
      <form onSubmit={send} className="space-y-2">
        <label className="m-label" htmlFor="invite-emails">Invite by email</label>
        <textarea id="invite-emails" data-autofocus rows={3} className="m-input" placeholder={'ana@acme.com, li@acme.com'} value={emails} onChange={(e) => setEmails(e.target.value)} />
        <p className="m-faint text-[12px]">Separate addresses with commas or new lines.</p>
        {result && <p className="text-[13px]" role="status" style={{ color: result.ok ? 'var(--m-ok)' : 'var(--m-danger)' }}>{result.text}</p>}
        <div className="flex justify-end">
          <button type="submit" className="m-btn m-btn-primary" disabled={busy || !emails.trim() || remainingSeats === 0}>{busy ? 'Sending…' : 'Send invites'}</button>
        </div>
      </form>
    </MeetingDialog>
  );
}

export function LeaveDialog({ onLeave, onEndForAll, onDashboard }: { onLeave: () => void; onEndForAll: () => void; onDashboard: () => void }) {
  const ui = useMeetingUi();
  const { activeMeeting } = useMeetingSession();
  if (ui.dialog !== 'leave') return null;
  return (
    <MeetingDialog open onClose={ui.closeDialog} title="Leave this meeting?" width={420}
      description={activeMeeting?.isHost ? 'You can leave and let the meeting continue, or end it for everyone.' : 'The meeting continues for everyone else.'}
      icon={<PhoneOff size={19} />}>
      <div className="grid gap-2">
        <button type="button" data-autofocus className="m-btn m-btn-danger" onClick={() => { ui.closeDialog(); onLeave(); }}><LogOut size={15} aria-hidden />Leave meeting</button>
        {activeMeeting?.isHost && <button type="button" className="m-btn" style={{ color: 'var(--m-danger)' }} onClick={() => { ui.closeDialog(); onEndForAll(); }}><PhoneOff size={15} aria-hidden />End meeting for everyone</button>}
        <button type="button" className="m-btn" onClick={() => { ui.closeDialog(); onDashboard(); }}>Keep it running and go to dashboard</button>
        <button type="button" className="m-btn m-btn-ghost" onClick={ui.closeDialog}>Cancel</button>
      </div>
    </MeetingDialog>
  );
}

export function RecordConsentDialog({ onStarted }: { onStarted: () => void }) {
  const ui = useMeetingUi();
  const { setRecordingConsentGranted, startRecording, sendChatMessage } = useMeetingSession();
  const notify = useNotify();
  const [agree, setAgree] = useState(true);
  if (ui.dialog !== 'record-consent') return null;
  return (
    <MeetingDialog open onClose={ui.closeDialog} title="Record this meeting?" icon={<Disc size={19} />} width={440}
      description="Audio, video and the transcript are saved to your Greet Hub recordings. Everyone sees that the meeting is being recorded."
      footer={<>
        <button type="button" className="m-btn m-btn-ghost" onClick={ui.closeDialog}>Cancel</button>
        <button type="button" className="m-btn m-btn-danger" disabled={!agree} onClick={async () => {
          ui.closeDialog();
          setRecordingConsentGranted(true);
          const ok = await startRecording();
          if (ok) { sendChatMessage('🔴 Recording started.'); notify('Recording started', 'success'); onStarted(); }
          else notify('Recording couldn’t start. Check that your browser allows screen and audio capture.', 'error');
        }}><Circle size={12} fill="currentColor" aria-hidden />Start recording</button>
      </>}>
      <label htmlFor="rec-consent" className="flex cursor-pointer items-start gap-2.5 rounded-xl p-3 text-[13.5px]" style={{ background: 'var(--m-raised)' }}>
        <input id="rec-consent" type="checkbox" className="mt-0.5" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
        <span>I have permission from everyone in the meeting to record it.</span>
      </label>
    </MeetingDialog>
  );
}

export function ShortcutsDialog() {
  const ui = useMeetingUi();
  return (
    <MeetingDialog open={ui.dialog === 'shortcuts'} onClose={ui.closeDialog} title="Keyboard shortcuts" icon={<Keyboard size={19} />} width={440}
      description="Shortcuts work when you’re not typing in a field.">
      <dl className="space-y-0">
        {SHORTCUTS.map((s) => (
          <div key={s.keys} className="flex items-center justify-between py-2 text-[13.5px]" style={{ borderBottom: '1px solid var(--m-line)' }}>
            <dt>{s.label}</dt><dd><kbd className="m-kbd">{s.keys}</kbd></dd>
          </div>
        ))}
      </dl>
    </MeetingDialog>
  );
}

const HELP: { q: string; a: string }[] = [
  { q: 'Others can’t hear me', a: 'Check the microphone button isn’t red, then open More → Audio settings and pick the right microphone. The level bar should move when you speak.' },
  { q: 'My camera is black', a: 'Another app may be using the camera. Close it, then turn your camera off and on again. In Video settings you can choose a different camera.' },
  { q: 'Video is choppy', a: 'Turn on Low-bandwidth mode in More, or lower Video quality in Video settings. The signal icon at the top shows your connection quality.' },
  { q: 'Screen sharing doesn’t start', a: 'Your browser asks which screen, window or tab to share. If you closed that prompt, press Share screen again. On macOS, allow screen recording for your browser in System Settings.' },
  { q: 'How long can a meeting run?', a: 'Meetings on the Standard plan end automatically after 60 minutes, with a warning 5 minutes before. Up to 100 people can join, host included.' },
];

export function HelpDialog() {
  const ui = useMeetingUi();
  return (
    <MeetingDialog open={ui.dialog === 'help'} onClose={ui.closeDialog} title="Help and support" icon={<HelpCircle size={19} />} width={520}>
      <div className="space-y-2">
        {HELP.map((h) => (
          <details key={h.q} className="rounded-xl px-3.5 py-2.5" style={{ background: 'var(--m-raised)' }}>
            <summary className="cursor-pointer text-[13.5px] font-semibold">{h.q}</summary>
            <p className="m-muted mt-1.5 text-[13px] leading-relaxed">{h.a}</p>
          </details>
        ))}
      </div>
      <p className="m-muted mt-4 text-[13px]">Still stuck? Contact your workspace admin, or press <kbd className="m-kbd">?</kbd> to see keyboard shortcuts.</p>
    </MeetingDialog>
  );
}

const VIRTUAL_BACKGROUNDS = [
  { id: 'office', label: 'Office', css: 'linear-gradient(135deg,#d9dde8,#aeb6c9)' },
  { id: 'dusk', label: 'Dusk', css: 'linear-gradient(135deg,#2b2d55,#7a4b8c)' },
  { id: 'forest', label: 'Forest', css: 'linear-gradient(135deg,#1f3d33,#4f7a5c)' },
  { id: 'studio', label: 'Studio', css: 'linear-gradient(135deg,#121318,#3a3d4a)' },
];

export function BackgroundDialog() {
  const ui = useMeetingUi();
  const { localStream } = useMeetingSession();
  const notify = useNotify();
  const [blur, setBlur] = useState(false);
  if (ui.dialog !== 'background') return null;
  const canBlur = supportsBackgroundBlur(localStream);
  const tab = ui.backgroundTab;
  return (
    <MeetingDialog open onClose={ui.closeDialog} title="Background and effects" icon={<Sparkles size={19} />} width={520}>
      <div className="m-seg mb-4" role="tablist" aria-label="Background">
        <button type="button" role="tab" aria-selected={tab === 'effects'} onClick={() => ui.openDialog('background', { backgroundTab: 'effects' })}>Effects</button>
        <button type="button" role="tab" aria-selected={tab === 'virtual'} onClick={() => ui.openDialog('background', { backgroundTab: 'virtual' })}>Virtual background</button>
      </div>
      {tab === 'effects' ? (
        <div className="space-y-4" role="tabpanel">
          <label htmlFor="bg-blur" className="flex items-center gap-3 rounded-xl px-3 py-2.5" style={{ background: 'var(--m-raised)', opacity: canBlur ? 1 : 0.6 }}>
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] font-medium">Blur my background</span>
              <span className="m-muted block text-[12px]">{canBlur ? 'Uses your device’s built-in background blur.' : 'Your camera or browser doesn’t offer background blur.'}</span>
            </span>
            <input id="bg-blur" type="checkbox" className="sr-only" disabled={!canBlur} checked={blur}
              onChange={async (e) => { const on = e.target.checked; if (await setBackgroundBlur(localStream, on)) setBlur(on); else notify('Background blur isn’t available on this device.', 'warning'); }} />
            <span className="m-switch" data-on={blur} aria-hidden />
          </label>
          <div>
            <span className="m-label">Appearance</span>
            <div className="grid grid-cols-3 gap-2">
              {(Object.keys(VIDEO_FILTERS) as VideoFilterId[]).map((f) => (
                <button key={f} type="button" aria-pressed={ui.videoFilter === f} onClick={() => ui.setPref('videoFilter', f)}
                  className="flex items-center justify-between rounded-xl px-3 py-2.5 text-[13px]"
                  style={{ background: ui.videoFilter === f ? 'var(--m-accent-tint)' : 'var(--m-raised)', border: `1px solid ${ui.videoFilter === f ? 'var(--m-accent)' : 'transparent'}`, color: 'var(--m-text)', font: 'inherit', cursor: 'pointer' }}>
                  {VIDEO_FILTERS[f].label}{ui.videoFilter === f && <Check size={14} aria-hidden />}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-3" role="tabpanel">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {VIRTUAL_BACKGROUNDS.map((b) => (
              <div key={b.id} className="flex flex-col gap-1">
                <span className="block rounded-xl" style={{ aspectRatio: '16 / 10', background: b.css, opacity: 0.55 }} aria-hidden />
                <span className="m-muted text-[12px]">{b.label}</span>
              </div>
            ))}
          </div>
          <p className="flex items-start gap-2 rounded-xl px-3 py-2.5 text-[13px]" style={{ background: 'var(--m-raised)' }}>
            <ImageIcon size={15} className="mt-0.5 flex-none m-faint" aria-hidden />
            Replacing your background needs a person-segmentation model, which isn’t set up in this workspace yet. Background blur works where your device supports it.
          </p>
        </div>
      )}
    </MeetingDialog>
  );
}
