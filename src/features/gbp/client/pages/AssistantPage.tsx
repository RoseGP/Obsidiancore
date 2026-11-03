/** AI growth assistant grounded in the business's own data; suggests actions the owner can prepare and approve. */
import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, Bot, Send, Trash2 } from 'lucide-react';
import { routeForAction, useGrowth, useLoad } from '../GrowthStore';
import { Alert, Button, Card, PageHeader, Prose, useToast } from '../ui';

const STARTERS = ['How can I improve my Google Business Profile?', 'Why is my business not getting enough visibility?', 'What should I improve first?', 'Which services should I add?', 'How can I improve my business description?', 'What are my competitors doing better?', 'How should I respond to my latest negative review?', 'What should I publish this week?'];
type Msg = { role: 'user' | 'assistant'; content: string; actions?: { type: string; label: string; detail?: string }[] };

export default function AssistantPage() {
  const { api, location, dash, go } = useGrowth();
  const toast = useToast();
  const hist = useLoad(() => api<{ role: 'user' | 'assistant'; content: string }[]>('/growth/assistant'), []);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { if (hist.data) setMsgs(hist.data); }, [hist.data]);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [msgs.length, busy]);

  const ask = async (m: string) => {
    const q = m.trim(); if (!q || busy) return;
    setMsgs((x) => [...x, { role: 'user', content: q }]); setText(''); setBusy(true);
    try { const r = await api<{ reply: string; actions: Msg['actions'] }>('/growth/assistant', { method: 'POST', json: { location: location!.name, message: q } }); setMsgs((x) => [...x, { role: 'assistant', content: r.reply, actions: r.actions }]); }
    catch (e: any) { toast('danger', e.message); setMsgs((x) => x.slice(0, -1)); setText(q); }
    finally { setBusy(false); }
  };
  const clear = async () => { await api('/growth/assistant', { method: 'DELETE' }).catch(() => undefined); setMsgs([]); };

  return (
    <div className="flex h-full flex-col space-y-4 g-fade">
      <PageHeader title="AI growth assistant" description={`Ask anything about growing ${location?.title ?? 'your business'} on Google. Answers use your profile, latest audit, reviews and competitors.`}
        actions={msgs.length ? <Button icon={<Trash2 size={15} />} onClick={clear}>New conversation</Button> : undefined} />
      {!dash?.aiConfigured && <Alert tone="info" title="AI isn’t configured on the server">An administrator can set GEMINI_API_KEY to turn on the assistant.</Alert>}
      {!dash?.locations.find((l) => l.location.name === location?.name)?.growthAudit && <Alert tone="info" title="Run an audit first for sharper answers" action={<Button size="sm" onClick={() => go('audit')}>Run audit</Button>} />}
      <Card pad={false} className="flex min-h-[460px] flex-1 flex-col">
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5" aria-live="polite">
          {!msgs.length && (
            <div className="space-y-4">
              <div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: 'var(--g-accent-tint)', color: 'var(--g-accent)' }}><Bot size={20} aria-hidden /></span><p className="text-[14px] font-semibold">What would you like to know?</p></div>
              <div className="flex flex-wrap gap-2">{STARTERS.map((s) => <button key={s} type="button" disabled={!dash?.aiConfigured} onClick={() => ask(s)} className="g-btn g-btn-sm" style={{ height: 'auto', padding: '7px 11px', whiteSpace: 'normal', textAlign: 'left' }}>{s}</button>)}</div>
            </div>
          )}
          {msgs.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] px-4 py-3 text-[14px] ${m.role === 'user' ? 'g-chat-me' : 'g-chat-ai'}`}>
                {m.role === 'assistant' ? <Prose text={m.content} /> : m.content}
                {m.actions && m.actions.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">{m.actions.map((a, j) => <Button key={j} size="sm" onClick={() => go(routeForAction(a.type), { focus: a.type })} title={a.detail}>{a.label}<ArrowRight size={13} aria-hidden /></Button>)}</div>
                )}
              </div>
            </div>
          ))}
          {busy && <div className="g-chat-ai w-fit px-4 py-3 text-[14px]"><span className="g-muted">Thinking…</span></div>}
          <div ref={end} />
        </div>
        <form className="flex gap-2 p-3" style={{ borderTop: '1px solid var(--g-line)' }} onSubmit={(e) => { e.preventDefault(); ask(text); }}>
          <textarea className="g-textarea min-w-0 flex-1" rows={1} style={{ minHeight: 42, maxHeight: 140 }} aria-label="Your question" placeholder="Ask a follow-up…" value={text} disabled={!dash?.aiConfigured}
            onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(text); } }} />
          <Button type="submit" variant="primary" icon={<Send size={15} />} loading={busy} disabled={!text.trim() || !dash?.aiConfigured}>Send</Button>
        </form>
      </Card>
      <p className="g-faint text-[12px]">The assistant can’t change your profile. Suggested actions open the right page so you can review and approve.</p>
    </div>
  );
}
