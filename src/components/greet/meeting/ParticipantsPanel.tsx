/** Everyone in the meeting, with search, raised hands first, capacity and quick actions. */
import React, { useMemo, useState } from 'react';
import { Hand, MessageSquare, Mic, MicOff, Pin, Search, UserCheck, UserPlus, Video, VideoOff } from 'lucide-react';
import { useMeetingSession, type MeetingParticipant } from '../../../context/MeetingSessionContext';

export function ParticipantsPanel({ localName, localHandRaised, remoteHands, activeSpeakerId, onInvite, onMessage, onPin }: {
  localName: string;
  localHandRaised: boolean;
  /** Raised hands received over the real-time channel, by display name. */
  remoteHands: string[];
  activeSpeakerId: string | null;
  onInvite: () => void;
  onMessage: (id: string) => void;
  onPin: (id: string) => void;
}) {
  const { activeMeeting, sessionLimits, remainingSeats, isMicMuted, isCamOff, addParticipantToCrm } = useMeetingSession();
  const [q, setQ] = useState('');
  const people = activeMeeting?.participants ?? [];
  const total = people.length + 1;
  const term = q.trim().toLowerCase();
  const handSet = new Set(remoteHands.map((n) => n.toLowerCase()));
  const shown = useMemo(() => {
    const list = term ? people.filter((p) => `${p.name} ${p.company} ${p.email}`.toLowerCase().includes(term)) : people;
    return [...list].sort((a, b) => Number(handSet.has(b.name.toLowerCase())) - Number(handSet.has(a.name.toLowerCase())));
  }, [people, term, remoteHands]); // eslint-disable-line react-hooks/exhaustive-deps
  const pct = Math.min(100, (total / sessionLimits.maxParticipants) * 100);

  const renderRow = (p: MeetingParticipant) => {
    const hand = handSet.has(p.name.toLowerCase());
    return (
      <li key={p.id} className="group flex items-center gap-3 rounded-xl px-2.5 py-2" style={{ background: activeSpeakerId === p.id ? 'var(--m-accent-tint)' : undefined }}>
        <span className="m-avatar" style={{ width: 34, height: 34, fontSize: 12.5 }} aria-hidden>{p.avatar}</span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-[13.5px] font-medium">{p.name}{hand && <Hand size={13} className="ml-1.5 inline -translate-y-px" style={{ color: 'var(--m-warn)' }} aria-label="hand raised" />}</span>
          <span className="m-faint block truncate text-[12px]">{[p.role, p.company].filter(Boolean).join(' · ')}</span>
        </span>
        <span className="flex items-center gap-0.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
          <button type="button" className="m-icon-btn" style={{ width: 30, height: 30 }} aria-label={`Pin ${p.name}`} title="Pin" onClick={() => onPin(p.id)}><Pin size={15} /></button>
          <button type="button" className="m-icon-btn" style={{ width: 30, height: 30 }} aria-label={`Message ${p.name}`} title="Private message" onClick={() => onMessage(p.id)}><MessageSquare size={15} /></button>
          {!p.isCrmContact && <button type="button" className="m-icon-btn" style={{ width: 30, height: 30 }} aria-label={`Add ${p.name} to CRM`} title="Add to CRM" onClick={() => addParticipantToCrm(p)}><UserCheck size={15} /></button>}
        </span>
        <span className="flex items-center gap-1.5" aria-hidden>
          {p.isVideoOff ? <VideoOff size={15} className="m-faint" /> : <Video size={15} className="m-faint" />}
          {p.isMuted ? <MicOff size={15} style={{ color: 'var(--m-danger)' }} /> : <Mic size={15} style={{ color: p.isSpeaking ? 'var(--m-speaking)' : 'var(--m-faint)' }} />}
        </span>
      </li>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-3 px-4 py-3" style={{ borderBottom: '1px solid var(--m-line)' }}>
        <div className="flex items-center justify-between text-[12.5px]">
          <span className="m-muted m-num">{total} of {sessionLimits.maxParticipants} · {remainingSeats} seats left</span>
          <button type="button" className="m-btn m-btn-primary m-btn-sm" onClick={onInvite} disabled={remainingSeats === 0}><UserPlus size={14} aria-hidden />Invite</button>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--m-raised)' }} role="progressbar" aria-label="Room capacity" aria-valuenow={total} aria-valuemin={0} aria-valuemax={sessionLimits.maxParticipants}>
          <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: remainingSeats === 0 ? 'var(--m-danger)' : 'var(--m-accent)' }} />
        </div>
        <div className="relative">
          <Search size={15} className="m-faint absolute left-3 top-1/2 -translate-y-1/2" aria-hidden />
          <input id="people-search" type="search" className="m-input" style={{ paddingLeft: 34, height: 36 }} placeholder="Find someone" aria-label="Find a participant" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-2" aria-label="Participants">
        {!term && (
          <li className="flex items-center gap-3 rounded-xl px-2.5 py-2" style={{ background: activeSpeakerId === 'local-user' ? 'var(--m-accent-tint)' : undefined }}>
            <span className="m-avatar" style={{ width: 34, height: 34, fontSize: 12.5 }} aria-hidden>{localName.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}</span>
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-[13.5px] font-medium">{localName} (You){localHandRaised && <Hand size={13} className="ml-1.5 inline -translate-y-px" style={{ color: 'var(--m-warn)' }} aria-label="hand raised" />}</span>
              <span className="m-faint block text-[12px]">{activeMeeting?.isHost ? 'Host' : 'Participant'}</span>
            </span>
            <span className="flex items-center gap-1.5" aria-hidden>
              {isCamOff ? <VideoOff size={15} className="m-faint" /> : <Video size={15} className="m-faint" />}
              {isMicMuted ? <MicOff size={15} style={{ color: 'var(--m-danger)' }} /> : <Mic size={15} style={{ color: 'var(--m-faint)' }} />}
            </span>
          </li>
        )}
        {shown.map(renderRow)}
        {term && !shown.length && <li className="m-muted px-3 py-6 text-center text-[13px]">No one matches “{q.trim()}”.</li>}
        {!term && people.length === 0 && <li className="m-muted px-3 py-6 text-center text-[13px]">You’re the only one here. Invite people or share the meeting link.</li>}
      </ul>
    </div>
  );
}
