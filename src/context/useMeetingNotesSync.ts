/**
 * Keeps the Call Canvas notes in sync with the CRM (/api/meeting-notes).
 *
 *  - Autosaves the author's draft ~1.5 s after typing stops (and on demand, e.g. on blur).
 *  - Keeps an unsent copy in this browser per meeting, so a dropped connection loses nothing.
 *  - finalize() saves the latest text and marks the notes final ("saved to the CRM"); the meeting
 *    calls it when the host ends the meeting or the person leaves, before tearing anything down.
 * The status always reflects what the server actually confirmed.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export type NotesSaveStatus = 'empty' | 'unsaved' | 'saving' | 'saved' | 'error' | 'finalizing' | 'final';

export interface NotesLead { id: string; name: string }

export interface MeetingNotesSync {
  noteId: string | null;
  status: NotesSaveStatus;
  /** Time the server last confirmed a save. */
  savedAt: number | null;
  error: string | null;
  lead: NotesLead | null;
  setLead: (lead: NotesLead | null) => void;
  /** Save the draft now (e.g. on blur or Retry). */
  saveNow: () => Promise<boolean>;
  /** Save and mark final. Returns 'final', 'empty' (nothing to save) or 'failed'. */
  finalize: () => Promise<'final' | 'empty' | 'failed'>;
}

const DRAFT_KEY = (meetingKey: string) => `obsidian_meeting_notes:${meetingKey}`;
const AUTOSAVE_MS = 1500;

/** True once the notes contain something beyond the meeting's starting template. */
const written = (c: { body: string; baseline: string }) => !!c.body.trim() && c.body.trim() !== c.baseline.trim();

/** Server ids are [A-Za-z0-9_-]{1,128}; local meeting ids are mapped onto that. */
export function meetingKeyFor(id: string | null | undefined): string | null {
  if (!id) return null;
  const k = String(id).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 128);
  return k || null;
}

function randomNoteId() {
  const bytes = new Uint8Array(10);
  (globalThis.crypto || (window as any).crypto).getRandomValues(bytes);
  return `mnote_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

interface StoredDraft { noteId: string; body: string; lead: NotesLead | null; final?: boolean }
function readDraft(meetingKey: string): StoredDraft | null {
  try { const raw = localStorage.getItem(DRAFT_KEY(meetingKey)); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
function writeDraft(meetingKey: string, d: StoredDraft | null) {
  try { if (d) localStorage.setItem(DRAFT_KEY(meetingKey), JSON.stringify(d)); else localStorage.removeItem(DRAFT_KEY(meetingKey)); } catch { /* storage unavailable */ }
}

async function api(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: any }> {
  try {
    const res = await fetch(`/api/meeting-notes${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok && data?.success !== false, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: {} };
  }
}

const describe = (r: { status: number; data: any }) =>
  r.status === 0 ? 'You appear to be offline. Your notes are kept in this browser.'
  : r.data?.error || `The notes couldn't be saved (${r.status}).`;

export function useMeetingNotesSync(opts: {
  meetingId: string | null;
  title: string;
  body: string;
  /** Replace the notes text (used to restore an unsent draft). */
  setBody: (body: string) => void;
  onFinalized?: (result: 'final' | 'failed', message: string) => void;
}): MeetingNotesSync {
  const meetingKey = meetingKeyFor(opts.meetingId);
  const [noteId, setNoteId] = useState<string | null>(null);
  const [status, setStatus] = useState<NotesSaveStatus>('empty');
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lead, setLeadState] = useState<NotesLead | null>(null);

  const live = useRef({ meetingKey, noteId: null as string | null, body: opts.body, title: opts.title, lead: null as NotesLead | null, lastSaved: null as string | null, final: false, baseline: '' });
  live.current.body = opts.body;
  live.current.title = opts.title;
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onFinalized = useRef(opts.onFinalized);
  onFinalized.current = opts.onFinalized;
  const setBodyRef = useRef(opts.setBody);
  setBodyRef.current = opts.setBody;

  // New meeting: pick up an unsent draft from this browser, or start a fresh note id.
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    // The meeting may start with a template (title, date, room). Only what the person adds counts as notes.
    live.current = { ...live.current, meetingKey, noteId: null, lead: null, lastSaved: null, final: false, baseline: live.current.body };
    setSavedAt(null); setError(null);
    if (!meetingKey) { setNoteId(null); setLeadState(null); setStatus('empty'); return; }
    const stored = readDraft(meetingKey);
    const id = stored?.noteId && /^[A-Za-z0-9_-]{1,128}$/.test(stored.noteId) ? stored.noteId : randomNoteId();
    live.current.noteId = id;
    live.current.lead = stored?.lead ?? null;
    live.current.final = !!stored?.final;
    setNoteId(id); setLeadState(stored?.lead ?? null);
    // Restore an unsent draft only into notes nobody has typed in yet (empty or just the template).
    if (stored?.body && stored.body !== live.current.body && live.current.body.trim() === live.current.baseline.trim()) setBodyRef.current(stored.body);
    setStatus(stored?.final ? 'final' : stored?.body ? 'unsaved' : 'empty');
  }, [meetingKey]);

  const fingerprint = () => JSON.stringify([live.current.body, live.current.title, live.current.lead?.id ?? null]);

  const putDraft = useCallback(async (): Promise<boolean> => {
    const c = live.current;
    if (!c.meetingKey || !c.noteId || c.final) return c.final;
    const fp = fingerprint();
    if (fp === c.lastSaved) { setStatus('saved'); return true; }
    if (!written(c) && !c.lastSaved) { setStatus('empty'); return true; } // nothing written yet: don't create an empty note
    setStatus('saving'); setError(null);
    const r = await api(`/${encodeURIComponent(c.noteId)}`, {
      method: 'PUT',
      body: JSON.stringify({ meetingKey: c.meetingKey, title: c.title || 'Meeting notes', body: c.body, leadId: c.lead?.id ?? null }),
    });
    if (live.current.noteId !== c.noteId) return false; // meeting changed meanwhile
    if (r.ok) {
      c.lastSaved = fp;
      setSavedAt(Date.now());
      setStatus(fingerprint() === fp ? 'saved' : 'unsaved');
      return true;
    }
    if (r.data?.code === 'notes_final') { c.final = true; setStatus('final'); return true; }
    setError(describe(r)); setStatus('error');
    return false;
  }, []);

  const queue = useCallback(<T,>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.current.then(fn, fn);
    chain.current = next.catch(() => {});
    return next;
  }, []);

  const saveNow = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    return queue(putDraft);
  }, [queue, putDraft]);

  // Text, title or lead changed: keep a local copy and autosave shortly after typing stops.
  useEffect(() => {
    const c = live.current;
    if (!meetingKey || !c.noteId || c.final) return;
    writeDraft(meetingKey, { noteId: c.noteId, body: opts.body, lead: c.lead });
    if (fingerprint() === c.lastSaved) return;
    if (!written(c) && !c.lastSaved) { setStatus('empty'); return; }
    setStatus('unsaved');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { timer.current = null; void queue(putDraft); }, AUTOSAVE_MS);
    return () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  }, [opts.body, opts.title, lead, meetingKey, queue, putDraft]);

  const setLead = useCallback((l: NotesLead | null) => {
    live.current.lead = l;
    setLeadState(l);
  }, []);

  const finalize = useCallback(async (): Promise<'final' | 'empty' | 'failed'> => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    return queue(async () => {
      const c = live.current;
      if (!c.meetingKey || !c.noteId) return 'empty' as const;
      if (c.final) return 'final' as const;
      if (!written(c) && !c.lastSaved) return 'empty' as const;
      setStatus('finalizing');
      const saved = await putDraft();
      if (!saved) {
        const msg = 'Your meeting notes couldn\'t be saved to the CRM. They\'re kept in this browser; open the meeting notes again to retry.';
        setStatus('error'); onFinalized.current?.('failed', msg);
        return 'failed' as const;
      }
      const r = await api(`/${encodeURIComponent(c.noteId)}/complete`, { method: 'POST' });
      if (!r.ok) {
        const msg = 'Notes saved as draft; couldn\'t finalize. ' + describe(r);
        setError(describe(r)); setStatus('error'); onFinalized.current?.('failed', msg);
        return 'failed' as const;
      }
      c.final = true;
      writeDraft(c.meetingKey, null);
      setStatus('final'); setSavedAt(Date.now());
      onFinalized.current?.('final', c.lead ? `Meeting notes saved to the CRM and to ${c.lead.name}.` : 'Meeting notes saved to the CRM.');
      return 'final' as const;
    });
  }, [queue, putDraft]);

  return { noteId, status, savedAt, error, lead, setLead, saveNow, finalize };
}
