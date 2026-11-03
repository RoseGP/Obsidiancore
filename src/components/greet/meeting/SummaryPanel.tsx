/** AI meeting summary with action items, built from the transcript, chat and notes. */
import React, { useState } from 'react';
import { CheckSquare, Copy, ListChecks, Loader2, Plus, Sparkles } from 'lucide-react';
import { useMeetingSession } from '../../../context/MeetingSessionContext';
import { getApiAuthHeaders } from '../../../lib/apiAuth';
import { summarizeMeeting, type MeetingSummary, type SummaryInputLine } from '../../../lib/meetingSummary';
import { useNotify } from './NotificationSystem';

export function SummaryPanel() {
  const { activeMeeting, liveTranscript, addFollowupTask } = useMeetingSession();
  const notify = useNotify();
  const [summary, setSummary] = useState<MeetingSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState<Set<string>>(new Set());

  const collect = (): SummaryInputLine[] => [
    ...liveTranscript.map((t) => ({ speaker: t.speakerName, text: t.text, at: t.timeSeconds })),
    ...(activeMeeting?.messages ?? []).filter((m) => !m.attachments?.length).map((m) => ({ speaker: m.isYou ? 'You' : m.senderName, text: m.text })),
    ...(activeMeeting?.notes ? activeMeeting.notes.split('\n').filter((l) => l.trim() && !l.startsWith('#') && !l.startsWith('**')).map((l) => ({ speaker: 'Notes', text: l.replace(/^-\s*/, '') })) : []),
  ];

  const generate = async () => {
    setBusy(true);
    const lines = collect();
    try {
      const res = await fetch('/api/meetings/summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getApiAuthHeaders()) },
        body: JSON.stringify({ title: activeMeeting?.title, lines }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setSummary(await res.json());
    } catch {
      setSummary(summarizeMeeting(lines, { title: activeMeeting?.title }));
    } finally { setBusy(false); }
  };

  const addTask = (text: string, owner?: string) => {
    const due = new Date(Date.now() + 2 * 86400000).toISOString().split('T')[0];
    addFollowupTask({ title: text, dueDate: due, priority: 'medium', contactName: owner || 'Unassigned' });
    setAdded((s) => new Set(s).add(text));
  };

  const copy = () => {
    if (!summary) return;
    const txt = [summary.overview, '', 'Key points:', ...summary.keyPoints.map((p) => `- ${p}`),
      ...(summary.decisions.length ? ['', 'Decisions:', ...summary.decisions.map((d) => `- ${d}`)] : []),
      '', 'Action items:', ...summary.actionItems.map((a) => `- [ ] ${a.text}${a.owner ? ` (${a.owner})` : ''}${a.due ? ` — ${a.due}` : ''}`)].join('\n');
    navigator.clipboard.writeText(txt).then(() => notify('Summary copied', 'success')).catch(() => notify('Couldn’t copy. Select the text instead.', 'warning'));
  };

  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
      <div className="m-card space-y-2 p-3.5">
        <p className="text-[13.5px]">Summarizes the live transcript, chat and meeting notes, and pulls out action items.</p>
        <div className="flex gap-2">
          <button type="button" className="m-btn m-btn-primary m-btn-sm" onClick={generate} disabled={busy}>
            {busy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Sparkles size={14} aria-hidden />}{summary ? 'Regenerate' : 'Generate summary'}
          </button>
          {summary && <button type="button" className="m-btn m-btn-sm" onClick={copy}><Copy size={14} aria-hidden />Copy</button>}
        </div>
      </div>

      {summary && (
        <div className="space-y-4" aria-live="polite">
          <p className="m-faint text-[11.5px] font-semibold uppercase tracking-[0.08em]">{summary.source === 'ai' ? 'AI summary' : 'On-device summary'}</p>
          <p className="text-[14px] leading-relaxed">{summary.overview}</p>
          {summary.keyPoints.length > 0 && (
            <section>
              <h3 className="mb-1.5 text-[13px] font-semibold">Key points</h3>
              <ul className="list-disc space-y-1 pl-5 text-[13.5px]">{summary.keyPoints.map((p) => <li key={p}>{p}</li>)}</ul>
            </section>
          )}
          {summary.decisions.length > 0 && (
            <section>
              <h3 className="mb-1.5 text-[13px] font-semibold">Decisions</h3>
              <ul className="list-disc space-y-1 pl-5 text-[13.5px]">{summary.decisions.map((p) => <li key={p}>{p}</li>)}</ul>
            </section>
          )}
          <section>
            <div className="mb-1.5 flex items-center justify-between">
              <h3 className="flex items-center gap-1.5 text-[13px] font-semibold"><ListChecks size={15} aria-hidden />Action items</h3>
              {summary.actionItems.some((a) => !added.has(a.text)) && (
                <button type="button" className="m-btn m-btn-ghost m-btn-sm" onClick={() => summary.actionItems.forEach((a) => !added.has(a.text) && addTask(a.text, a.owner))}>Add all to tasks</button>
              )}
            </div>
            {summary.actionItems.length === 0 ? <p className="m-muted text-[13px]">No action items found.</p> : (
              <ul className="space-y-1.5">
                {summary.actionItems.map((a) => (
                  <li key={a.text} className="flex items-start gap-2 rounded-xl px-3 py-2" style={{ background: 'var(--m-raised)' }}>
                    <CheckSquare size={15} className="mt-0.5 flex-none m-faint" aria-hidden />
                    <span className="min-w-0 flex-1 text-[13.5px]">{a.text}<span className="m-faint block text-[12px]">{[a.owner, a.due].filter(Boolean).join(' · ') || 'No owner'}</span></span>
                    {added.has(a.text) ? <span className="text-[12px]" style={{ color: 'var(--m-ok)' }}>Added</span>
                      : <button type="button" className="m-icon-btn" style={{ width: 28, height: 28 }} aria-label={`Add “${a.text}” to follow-up tasks`} onClick={() => addTask(a.text, a.owner)}><Plus size={15} /></button>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
