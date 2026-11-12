/**
 * Dashboard: "Ask your CRM", the CRM agent. Questions are answered from the organization's own records
 * (POST /api/crm-agent/ask: tenant- and permission-scoped retrieval, then Claude or Gemini). Every answer
 * shows the records it was based on and which of them it cites; answers that cite none are flagged.
 */
import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Database, ExternalLink, FileSearch, Loader2, SearchX, Send, Sparkles } from 'lucide-react';
import { Badge, Button, Skeleton, cx, focusRing } from './ui';
import { CcSection } from './CommandCenterSections';

type SourceType = 'contact' | 'company' | 'lead' | 'deal' | 'task';
interface Source { ref: string; id: string; type: SourceType; title: string; view: string; facts: string[] }
interface AgentResponse {
  status: 'answered' | 'no_results' | 'ai_not_configured';
  answer?: string; sources: Source[]; cited: string[]; grounded: boolean;
  searched: SourceType[]; recordsSearched: number; provider?: string; model?: string; notice?: string;
}
interface Turn { question: string; result?: AgentResponse; error?: string }

const TYPE_LABEL: Record<SourceType, string> = { contact: 'Contact', company: 'Company', lead: 'Lead', deal: 'Deal', task: 'Task' };
const PLURAL: Record<SourceType, string> = { contact: 'contacts', company: 'companies', lead: 'leads', deal: 'deals', task: 'tasks' };
const SUGGESTIONS = ['Which deals are closing this month?', 'What tasks are overdue?', 'Who are my hottest leads?', 'Which deals look stale?'];

/** Renders the answer with [S1] citations as small links to the matching source. */
function AnswerText({ text, onCite }: { text: string; onCite: (ref: string) => void }) {
  const parts = text.split(/(\[S\d{1,2}\])/g);
  return (
    <div className="whitespace-pre-wrap text-[14px] leading-relaxed text-[var(--text)]">
      {parts.map((p, i) => {
        const m = p.match(/^\[(S\d{1,2})\]$/);
        if (!m) return <React.Fragment key={i}>{p}</React.Fragment>;
        return (
          <button key={i} type="button" onClick={() => onCite(m[1])} aria-label={`Source ${m[1]}`}
            className={cx('mx-0.5 inline-flex items-center rounded bg-[var(--accent-soft)] px-1 align-baseline text-[11px] font-semibold text-[var(--accent-text)] hover:underline', focusRing)}>
            {m[1]}
          </button>
        );
      })}
    </div>
  );
}

export default function CrmAgentPanel({ onNavigate, collapsed, onToggle }: { onNavigate: (view: string) => void; collapsed?: boolean; onToggle?: () => void }) {
  const [question, setQuestion] = useState('');
  const [turn, setTurn] = useState<Turn | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ai: { claude: boolean; gemini: boolean }; searches: SourceType[] } | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let live = true;
    fetch('/api/crm-agent/status').then((r) => (r.ok ? r.json() : null)).then((d) => { if (live && d?.success) setStatus({ ai: d.ai, searches: d.searches }); }).catch(() => undefined);
    return () => { live = false; abortRef.current?.abort(); };
  }, []);

  const ask = async (q: string) => {
    const text = q.trim();
    if (text.length < 3 || busy) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setBusy(true); setHighlight(null); setTurn({ question: text });
    try {
      const res = await fetch('/api/crm-agent/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: text }), signal: ctrl.signal });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) setTurn({ question: text, error: data?.error || 'The CRM agent couldn’t answer right now. Try again.' });
      else setTurn({ question: text, result: data as AgentResponse });
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setTurn({ question: text, error: 'Couldn’t reach the server. Check your connection and try again.' });
    } finally {
      if (abortRef.current === ctrl) setBusy(false);
    }
  };

  const r = turn?.result;
  const aiReady = status ? status.ai.claude || status.ai.gemini : null;
  const shownSources = r ? (r.status === 'answered' && r.cited.length ? r.sources.filter((s) => r.cited.includes(s.ref)) : r.sources) : [];
  const otherSources = r && r.status === 'answered' && r.cited.length ? r.sources.filter((s) => !r.cited.includes(s.ref)) : [];

  return (
    <CcSection id="crm_agent" title="Ask your CRM" icon={<Database className="h-4 w-4" />} collapsed={collapsed} onToggle={onToggle}
      subtitle="Answers come from your organization's records that you're allowed to see, with the records they're based on."
      badge={aiReady === false ? <Badge tone="warning">AI not configured</Badge> : undefined}>
      <div className="space-y-4 px-4 pb-5 sm:px-5">
        <form onSubmit={(e) => { e.preventDefault(); void ask(question); }} className="flex flex-col gap-2 sm:flex-row" aria-label="Ask a question about your CRM records">
          <label htmlFor="crm-agent-input" className="sr-only">Question about your CRM records</label>
          <input id="crm-agent-input" value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={1000}
            placeholder="e.g. Which deals with Acme are closing this month?" autoComplete="off"
            className={cx('h-10 flex-1 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-3 text-[14px] text-[var(--text)] placeholder:text-[var(--text-subtle)]', focusRing)} />
          <Button type="submit" variant="primary" className="h-10" disabled={busy || question.trim().length < 3} icon={busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}>
            {busy ? 'Searching…' : 'Ask'}
          </Button>
        </form>

        {!turn && (
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-[var(--text-muted)]">
            <span>Try:</span>
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" onClick={() => { setQuestion(s); void ask(s); }} disabled={busy}
                className={cx('rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 hover:bg-[var(--surface-sunken)] hover:text-[var(--text)] disabled:opacity-50', focusRing)}>{s}</button>
            ))}
            {status && <span className="w-full text-[11px] text-[var(--text-subtle)]">Searches your {status.searches.map((t) => PLURAL[t]).join(', ') || 'records'}.</span>}
          </div>
        )}

        {turn && (
          <div className="space-y-3" aria-live="polite">
            <p className="text-[13px] text-[var(--text-muted)]"><span className="font-medium text-[var(--text)]">You asked:</span> {turn.question}</p>

            {busy && <div className="space-y-2" role="status" aria-label="Searching your records"><Skeleton className="h-4 w-3/4" /><Skeleton className="h-4 w-2/3" /><Skeleton className="h-4 w-1/2" /></div>}

            {!busy && turn.error && (
              <div role="alert" className="flex items-start gap-2 rounded-[var(--radius-card)] bg-[var(--danger-soft)] px-3 py-2.5 text-[13px] text-[var(--danger)]">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span className="flex-1">{turn.error}</span>
                <Button size="sm" variant="secondary" onClick={() => void ask(turn.question)}>Try again</Button>
              </div>
            )}

            {!busy && r?.status === 'no_results' && (
              <div className="flex items-start gap-2 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface-sunken)] px-3 py-3 text-[13px] text-[var(--text)]">
                <SearchX className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-muted)]" />
                <span>No records you can see match this question{r.recordsSearched ? ` (searched ${r.recordsSearched.toLocaleString()} records)` : ' (there are no records yet)'}. Try names, companies, stages or words from your notes.</span>
              </div>
            )}

            {!busy && r?.status === 'ai_not_configured' && (
              <div role="status" className="flex items-start gap-2 rounded-[var(--radius-card)] bg-[var(--warning-soft)] px-3 py-2.5 text-[13px] text-[var(--text)]">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--warning)]" />
                <span>AI answers aren't configured on this server (an administrator adds ANTHROPIC_API_KEY or GEMINI_API_KEY). Here are the most relevant records found for your question.</span>
              </div>
            )}

            {!busy && r?.status === 'answered' && (
              <div className="space-y-2 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-3.5">
                <AnswerText text={r.answer || ''} onCite={(ref) => { setHighlight(ref); document.getElementById(`crm-src-${ref}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }} />
                <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--text-subtle)]">
                  {r.grounded
                    ? <><FileSearch className="h-3.5 w-3.5" />Based on {r.cited.length} of your CRM record{r.cited.length === 1 ? '' : 's'}</>
                    : <><AlertTriangle className="h-3.5 w-3.5 text-[var(--warning)]" /><span className="text-[var(--warning)]">This answer doesn't cite your records; treat it with care.</span></>}
                  {r.provider && <span>· {r.provider === 'claude' ? 'Claude' : 'Gemini'}</span>}
                  {r.notice && <span>· {r.notice}</span>}
                </p>
              </div>
            )}

            {!busy && r && r.status !== 'no_results' && (
              <div>
                <h3 className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-[var(--text-muted)]"><Sparkles className="h-3.5 w-3.5" />{r.status === 'answered' && r.cited.length ? 'Records cited' : 'Records found'}</h3>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {shownSources.map((s) => (
                    <li key={s.ref} id={`crm-src-${s.ref}`} className={cx('rounded-[var(--radius-control)] border p-2.5 text-[12px]', highlight === s.ref ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-[var(--border)] bg-[var(--surface-sunken)]')}>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[10px] text-[var(--text-subtle)]">{s.ref}</span>
                        <Badge tone="neutral">{TYPE_LABEL[s.type]}</Badge>
                        <span className="min-w-0 flex-1 truncate font-medium text-[var(--text)]">{s.title}</span>
                        <button type="button" onClick={() => onNavigate(s.view)} aria-label={`Open ${TYPE_LABEL[s.type].toLowerCase()} ${s.title}`} className={cx('rounded p-0.5 text-[var(--text-muted)] hover:text-[var(--text)]', focusRing)}><ExternalLink className="h-3.5 w-3.5" /></button>
                      </div>
                      {s.facts.length > 0 && <p className="mt-1 line-clamp-2 text-[var(--text-muted)]">{s.facts.slice(0, 3).join(' · ')}</p>}
                    </li>
                  ))}
                </ul>
                {otherSources.length > 0 && <p className="mt-1.5 text-[11px] text-[var(--text-subtle)]">Also searched but not cited: {otherSources.map((s) => s.title).join(', ')}.</p>}
              </div>
            )}
          </div>
        )}
      </div>
    </CcSection>
  );
}
