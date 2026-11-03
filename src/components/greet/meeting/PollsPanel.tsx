/** Live polls: create a question with 2–6 options, vote once (you can change it), see results as they come in. */
import React, { useState } from 'react';
import { BarChart3, Check, Lock, Plus, X } from 'lucide-react';
import { tallyPoll, type MeetingPoll } from '../../../lib/meetingRealtime';

export function PollsPanel({ polls, votes, selfId, onCreate, onVote, onClose }: {
  polls: MeetingPoll[]; votes: Record<string, Record<string, number>>; selfId: string;
  onCreate: (q: string, options: string[]) => void; onVote: (pollId: string, i: number) => void; onClose: (pollId: string) => void;
}) {
  const [composing, setComposing] = useState(polls.length === 0);
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const valid = question.trim().length > 0 && options.filter((o) => o.trim()).length >= 2;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    onCreate(question.trim(), options.map((o) => o.trim()).filter(Boolean));
    setQuestion(''); setOptions(['', '']); setComposing(false);
  };

  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
      {composing ? (
        <form onSubmit={submit} className="m-card space-y-3 p-3.5">
          <div>
            <label className="m-label" htmlFor="poll-q">Question</label>
            <input id="poll-q" className="m-input" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="e.g. Which date works for the launch review?" maxLength={200} />
          </div>
          <div className="space-y-2">
            <span className="m-label">Options</span>
            {options.map((o, i) => (
              <div key={i} className="flex gap-2">
                <input id={`poll-opt-${i}`} className="m-input" value={o} maxLength={80} aria-label={`Option ${i + 1}`} placeholder={`Option ${i + 1}`}
                  onChange={(e) => setOptions((s) => s.map((x, j) => (j === i ? e.target.value : x)))} />
                {options.length > 2 && <button type="button" className="m-icon-btn flex-none" aria-label={`Remove option ${i + 1}`} onClick={() => setOptions((s) => s.filter((_, j) => j !== i))}><X size={16} /></button>}
              </div>
            ))}
            {options.length < 6 && <button type="button" className="m-btn m-btn-ghost m-btn-sm" onClick={() => setOptions((s) => [...s, ''])}><Plus size={14} aria-hidden />Add option</button>}
          </div>
          <div className="flex justify-end gap-2">
            {polls.length > 0 && <button type="button" className="m-btn m-btn-ghost m-btn-sm" onClick={() => setComposing(false)}>Cancel</button>}
            <button type="submit" className="m-btn m-btn-primary m-btn-sm" disabled={!valid}>Launch poll</button>
          </div>
        </form>
      ) : (
        <button type="button" className="m-btn w-full" onClick={() => setComposing(true)}><Plus size={15} aria-hidden />New poll</button>
      )}

      {[...polls].reverse().map((poll) => {
        const pv = votes[poll.id] ?? {};
        const mine = pv[selfId];
        const { counts, total } = tallyPoll(poll, pv);
        const showResults = poll.closed || mine !== undefined;
        return (
          <section key={poll.id} className="m-card space-y-2.5 p-3.5" aria-label={`Poll: ${poll.question}`}>
            <div className="flex items-start gap-2">
              <BarChart3 size={16} className="mt-0.5 flex-none" style={{ color: 'var(--m-accent)' }} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-semibold leading-snug">{poll.question}</p>
                <p className="m-faint text-[12px]">{poll.createdBy} · {total} {total === 1 ? 'vote' : 'votes'}{poll.closed ? ' · closed' : ''}</p>
              </div>
            </div>
            <div className="space-y-1.5" role="radiogroup" aria-label="Options">
              {poll.options.map((o, i) => {
                const pct = total ? Math.round((counts[i] / total) * 100) : 0;
                return (
                  <button key={i} type="button" role="radio" aria-checked={mine === i} disabled={poll.closed}
                    onClick={() => onVote(poll.id, i)}
                    className="relative flex w-full items-center gap-2 overflow-hidden rounded-xl px-3 py-2 text-left text-[13.5px]"
                    style={{ background: 'var(--m-raised)', border: `1px solid ${mine === i ? 'var(--m-accent)' : 'transparent'}`, color: 'var(--m-text)', font: 'inherit', cursor: poll.closed ? 'default' : 'pointer' }}>
                    {showResults && <span className="absolute inset-y-0 left-0 transition-[width] duration-300" style={{ width: `${pct}%`, background: 'var(--m-accent-tint)' }} aria-hidden />}
                    <span className="relative min-w-0 flex-1 truncate">{o}</span>
                    {mine === i && <Check size={14} className="relative" style={{ color: 'var(--m-accent)' }} aria-label="your vote" />}
                    {showResults && <span className="m-num relative text-[12px] font-semibold">{pct}%</span>}
                  </button>
                );
              })}
            </div>
            {!poll.closed && (
              <div className="flex justify-end">
                <button type="button" className="m-btn m-btn-ghost m-btn-sm" onClick={() => onClose(poll.id)}><Lock size={13} aria-hidden />Close poll</button>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
