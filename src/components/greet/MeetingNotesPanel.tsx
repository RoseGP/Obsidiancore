/**
 * Call Canvas: meeting notes, saved to the CRM.
 * Drafts autosave while you type (the status line says exactly what the server confirmed); "Save to CRM"
 * makes them final, which also happens automatically when the meeting ends or you leave.
 */
import React, { useEffect, useId, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Clock, Link2, Loader2, NotebookPen, Search, X } from 'lucide-react';
import { useMeetingSession } from '../../context/MeetingSessionContext';
import type { NotesLead } from '../../context/useMeetingNotesSync';

/** Same limit as the server (MAX_NOTES_CHARS in src/services/meetingSummary.ts, a server-only module). */
const MAX_NOTES_CHARS = 20_000;
const focusRing = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400';
const fmtTime = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function LeadPicker({ value, onChange, disabled }: { value: NotesLead | null; onChange: (l: NotesLead | null) => void; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<NotesLead[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const listId = useId();
  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/leads${query.trim() ? `?search=${encodeURIComponent(query.trim())}` : ''}`, { signal: ctrl.signal });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.success === false) throw new Error(data.error || 'Leads couldn\'t load.');
        const q = query.trim().toLowerCase();
        const rows = (Array.isArray(data.leads) ? data.leads : [])
          .filter((l: any) => !q || [l.name, l.email, l.company].some((f) => typeof f === 'string' && f.toLowerCase().includes(q)))
          .slice(0, 8)
          .map((l: any) => ({ id: String(l.id), name: [l.name, l.company].filter(Boolean).join(' · ') || l.email || 'Lead' }));
        setResults(rows); setError(null);
      } catch (e: any) {
        if (e?.name !== 'AbortError') { setResults([]); setError(e?.message || 'Leads couldn\'t load.'); }
      }
    }, 250);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [open, query]);

  if (value) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-neutral-900 px-2.5 py-1.5 text-xs">
        <Link2 className="h-3.5 w-3.5 text-indigo-300 shrink-0" aria-hidden="true" />
        <span className="flex-1 truncate text-neutral-200" title={value.name}>Linked to {value.name}</span>
        {!disabled && <button type="button" onClick={() => onChange(null)} aria-label="Remove the lead link" className={`rounded p-0.5 text-neutral-400 hover:text-white cursor-pointer ${focusRing}`}><X className="h-3.5 w-3.5" /></button>}
      </div>
    );
  }
  if (disabled) return null;
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={`inline-flex items-center gap-1.5 rounded-lg border border-dashed border-white/15 px-2.5 py-1.5 text-xs text-neutral-300 hover:text-white hover:border-white/30 cursor-pointer ${focusRing}`}>
        <Link2 className="h-3.5 w-3.5" aria-hidden="true" /> Link to a lead (optional)
      </button>
    );
  }
  return (
    <div className="rounded-lg border border-white/10 bg-neutral-900 p-2 space-y-1.5">
      <div className="flex items-center gap-1.5">
        <Search className="h-3.5 w-3.5 text-neutral-500 shrink-0" aria-hidden="true" />
        <input
          autoFocus type="search" value={query} onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } }}
          placeholder="Search leads by name, email or company" aria-label="Search leads" aria-controls={listId}
          className="flex-1 min-w-0 bg-transparent text-xs text-neutral-100 placeholder:text-neutral-500 outline-none"
        />
        <button type="button" onClick={() => setOpen(false)} aria-label="Cancel" className={`rounded p-0.5 text-neutral-400 hover:text-white cursor-pointer ${focusRing}`}><X className="h-3.5 w-3.5" /></button>
      </div>
      <ul id={listId} role="listbox" aria-label="Leads" className="max-h-40 overflow-y-auto">
        {results === null && <li className="px-2 py-1.5 text-[11px] text-neutral-500">Loading leads…</li>}
        {error && <li className="px-2 py-1.5 text-[11px] text-rose-300">{error}</li>}
        {results && !error && !results.length && <li className="px-2 py-1.5 text-[11px] text-neutral-500">No matching leads.</li>}
        {results?.map((l) => (
          <li key={l.id} role="option" aria-selected="false">
            <button type="button" onClick={() => { onChange(l); setOpen(false); setQuery(''); }} className={`w-full truncate rounded px-2 py-1.5 text-left text-xs text-neutral-200 hover:bg-white/5 cursor-pointer ${focusRing}`}>{l.name}</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function MeetingNotesPanel() {
  const { activeMeeting, updateMeetingNotes, meetingNotes } = useMeetingSession();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [confirming, setConfirming] = useState(false);
  if (!activeMeeting) return null;
  const notes = activeMeeting.notes || '';
  const { status, savedAt, error, lead } = meetingNotes;
  const final = status === 'final';
  const busy = status === 'saving' || status === 'finalizing';
  const over = notes.length > MAX_NOTES_CHARS;

  const insertTimestamp = () => {
    const tag = `[${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}] `;
    const el = ref.current;
    if (!el) { updateMeetingNotes(`${notes}${notes && !notes.endsWith('\n') ? '\n' : ''}${tag}`); return; }
    const start = el.selectionStart ?? notes.length, end = el.selectionEnd ?? notes.length;
    const before = notes.slice(0, start);
    const prefix = before && !before.endsWith('\n') ? '\n' : '';
    const next = `${before}${prefix}${tag}${notes.slice(end)}`;
    updateMeetingNotes(next);
    requestAnimationFrame(() => { el.focus(); const pos = start + prefix.length + tag.length; el.setSelectionRange(pos, pos); });
  };

  const statusLine = (() => {
    switch (status) {
      case 'empty': return { icon: <Clock className="h-3.5 w-3.5" />, text: 'Start typing. Notes save automatically.', tone: 'text-neutral-500' };
      case 'unsaved': return { icon: <Clock className="h-3.5 w-3.5" />, text: 'Not saved yet', tone: 'text-neutral-400' };
      case 'saving': return { icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />, text: 'Saving…', tone: 'text-neutral-300' };
      case 'finalizing': return { icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />, text: 'Saving to the CRM…', tone: 'text-neutral-300' };
      case 'saved': return { icon: <CheckCircle2 className="h-3.5 w-3.5" />, text: `Draft saved${savedAt ? ` ${fmtTime(savedAt)}` : ''}`, tone: 'text-emerald-300' };
      case 'final': return { icon: <CheckCircle2 className="h-3.5 w-3.5" />, text: `Saved to the CRM${savedAt ? ` at ${fmtTime(savedAt)}` : ''}${lead ? ` and to ${lead.name}` : ''}`, tone: 'text-emerald-300' };
      case 'error': return { icon: <AlertCircle className="h-3.5 w-3.5" />, text: error || 'Couldn\'t save.', tone: 'text-rose-300' };
    }
  })();

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden" id="meeting-notes-panel">
      <div className="px-4 pt-4 pb-3 space-y-2 border-b border-white/5">
        <div className="flex items-start gap-2">
          <NotebookPen className="h-4 w-4 mt-0.5 text-indigo-300 shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-white truncate" title={activeMeeting.title}>{activeMeeting.title || 'Meeting notes'}</h3>
            <p className="text-[11px] text-neutral-400">Only you can edit your notes. They're saved to the CRM when the meeting ends.</p>
          </div>
        </div>
        <LeadPicker value={lead} onChange={meetingNotes.setLead} disabled={final} />
      </div>

      <div className="flex-1 min-h-0 flex flex-col px-4 py-3 gap-2">
        <div className="flex items-center justify-between">
          <label htmlFor="meeting-notes-text" className="text-[11px] font-bold uppercase tracking-wider text-neutral-400">Notes</label>
          {!final && (
            <button type="button" onClick={insertTimestamp} className={`text-[11px] font-semibold text-indigo-300 hover:text-indigo-200 cursor-pointer rounded px-1 ${focusRing}`}>
              + Timestamp
            </button>
          )}
        </div>
        <textarea
          id="meeting-notes-text"
          ref={ref}
          value={notes}
          readOnly={final}
          onChange={(e) => updateMeetingNotes(e.target.value)}
          onBlur={() => { if (!final) void meetingNotes.saveNow(); }}
          aria-describedby="meeting-notes-status meeting-notes-count"
          aria-invalid={over}
          placeholder="Decisions, questions, next steps…"
          className={`flex-1 min-h-[180px] w-full resize-none rounded-xl border bg-neutral-900 p-3 text-[13px] leading-relaxed text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:border-indigo-500 ${over ? 'border-rose-500' : 'border-white/10'} ${final ? 'opacity-80' : ''}`}
        />
        <div className="flex items-center justify-between gap-2 text-[11px]">
          <p id="meeting-notes-status" role="status" aria-live="polite" className={`flex items-center gap-1.5 min-w-0 ${statusLine.tone}`}>
            <span aria-hidden="true" className="shrink-0">{statusLine.icon}</span>
            <span className="truncate" title={statusLine.text}>{statusLine.text}</span>
            {status === 'error' && !final && (
              <button type="button" onClick={() => void meetingNotes.saveNow()} className={`shrink-0 font-semibold text-white underline underline-offset-2 cursor-pointer ${focusRing}`}>Retry</button>
            )}
          </p>
          <span id="meeting-notes-count" className={`shrink-0 tabular-nums ${over ? 'text-rose-300' : 'text-neutral-500'}`}>
            {notes.length.toLocaleString()} / {MAX_NOTES_CHARS.toLocaleString()}
          </span>
        </div>
      </div>

      <div className="px-4 pb-4 pt-1">
        {final ? (
          <p className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-2 text-xs text-emerald-200">
            These notes are saved to the CRM and can't be changed. You'll find them in the activity feed{lead ? ` and on ${lead.name}` : ''}.
          </p>
        ) : confirming ? (
          <div className="rounded-lg border border-white/10 bg-neutral-900 p-3 space-y-2">
            <p className="text-xs text-neutral-200">Save to the CRM now? You won't be able to edit these notes afterwards.</p>
            <div className="flex gap-2">
              <button type="button" onClick={async () => { setConfirming(false); await meetingNotes.finalize(); }} className={`flex-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 px-3 py-2 text-xs font-semibold text-white cursor-pointer ${focusRing}`}>Save to CRM</button>
              <button type="button" onClick={() => setConfirming(false)} className={`rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-neutral-300 hover:text-white cursor-pointer ${focusRing}`}>Keep editing</button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={busy || over || status === 'empty'}
            title={status === 'empty' ? 'Write something first' : undefined}
            className={`w-full rounded-lg bg-indigo-600 hover:bg-indigo-500 px-3 py-2 text-xs font-semibold text-white cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${focusRing}`}
          >
            Save to CRM
          </button>
        )}
      </div>
    </div>
  );
}
