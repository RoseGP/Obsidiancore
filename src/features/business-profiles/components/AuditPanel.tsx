/** Audit results: score, category breakdown, prioritized actions, all findings, history trend. */
import React, { useMemo, useState } from 'react';
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChevronDown, ChevronRight, ClipboardCheck } from 'lucide-react';
import type { AuditFinding, AuditResult, AuditSummary, FindingCategory } from '../domain/types';
import { Badge, Button, Card, Meter, Notice, ProvenanceBadge, ScoreRing, StatusIcon, timeAgo, cx } from './ui';

export const CATEGORY_LABEL: Record<FindingCategory, string> = { completeness: 'Completeness', accuracy: 'Accuracy', content: 'Content quality', freshness: 'Freshness', media: 'Media', consistency: 'Listing consistency' };
const LVL = { high: 'High', medium: 'Medium', low: 'Low' } as const;

export function FindingRow({ f, onFix, defaultOpen }: { f: AuditFinding; onFix?: (field: string) => void; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <li className="py-3">
      <button type="button" className="w-full flex items-start gap-3 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
        <StatusIcon status={f.status} />
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-medium text-[var(--text)]">{f.title}</span>
          {!open && f.status !== 'pass' && <span className="block text-[13px] text-[var(--text-muted)] truncate">{f.recommendation || f.explanation}</span>}
        </span>
        {(f.status === 'fail' || f.status === 'warn') && <span className="hidden md:flex gap-1.5 shrink-0"><Badge tone={f.impact === 'high' ? 'danger' : f.impact === 'medium' ? 'warning' : 'neutral'}>Impact: {LVL[f.impact]}</Badge><Badge>Effort: {LVL[f.effort]}</Badge></span>}
        {open ? <ChevronDown className="h-4 w-4 text-[var(--text-subtle)] mt-0.5" /> : <ChevronRight className="h-4 w-4 text-[var(--text-subtle)] mt-0.5" />}
      </button>
      {open && (
        <div className="ml-7 mt-2 space-y-2 text-[13px]">
          <p className="text-[var(--text)]">{f.explanation}</p>
          {f.recommendation && <p className="text-[var(--text-muted)]"><span className="font-medium text-[var(--text)]">What to do: </span>{f.recommendation}</p>}
          {f.evidence && <p className="font-mono text-[12px] bg-[var(--surface-sunken)] rounded px-2 py-1 text-[var(--text-muted)] break-words">{f.evidence}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <ProvenanceBadge source={f.source} />
            <Badge>{CATEGORY_LABEL[f.category]}</Badge>
            {f.status === 'unknown' && <Badge tone="info">Could not be checked</Badge>}
            {f.field && onFix && f.status !== 'pass' && <Button size="sm" variant="secondary" onClick={() => onFix(f.field!)}>Go to field</Button>}
          </div>
        </div>
      )}
    </li>
  );
}

export function AuditPanel({ audit, history, stale, canRun, running, onRun, onFix }: { audit: AuditResult; history: AuditSummary[]; stale: boolean; canRun: boolean; running: boolean; onRun: () => void; onFix: (field: string) => void }) {
  const [showAll, setShowAll] = useState(false);
  const [filter, setFilter] = useState<'all' | FindingCategory>('all');
  const trend = useMemo(() => history.slice().reverse().map((h) => ({ date: new Date(h.ranAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), score: h.score, completeness: h.completeness })), [history]);
  const unknown = audit.findings.filter((f) => f.status === 'unknown');
  const findings = audit.findings.filter((f) => filter === 'all' || f.category === filter);

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex flex-wrap items-center gap-6">
          <ScoreRing score={audit.score} size={84} label="Profile health" />
          <div className="flex-1 min-w-[220px]">
            <h3 className="text-[15px] font-semibold text-[var(--text)]">Profile health</h3>
            <p className="text-[13px] text-[var(--text-muted)]">This app’s own quality check over {audit.counts.pass + audit.counts.warn + audit.counts.fail} rules. It is not a Google score and doesn’t guarantee rankings or results.</p>
            <div className="mt-2 flex flex-wrap gap-2 text-[12px]">
              <Badge tone="danger">{audit.counts.fail} to fix</Badge><Badge tone="warning">{audit.counts.warn} to improve</Badge><Badge tone="success">{audit.counts.pass} passed</Badge>
              {audit.counts.unknown > 0 && <Badge tone="info">{audit.counts.unknown} not checked</Badge>}
              <Badge>Completeness {audit.completeness}%</Badge><Badge>Coverage {audit.coverage}%</Badge>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            {canRun && <Button variant="primary" icon={<ClipboardCheck className="h-4 w-4" />} loading={running} onClick={onRun}>Record audit</Button>}
            <span className="text-[12px] text-[var(--text-subtle)]">Last recorded {timeAgo(history[0]?.ranAt)}{stale ? ' · profile changed since' : ''}</span>
          </div>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(Object.keys(CATEGORY_LABEL) as FindingCategory[]).map((c) => (
            <button key={c} type="button" onClick={() => { setFilter(filter === c ? 'all' : c); setShowAll(true); }} className={cx('text-left rounded-[var(--radius-control)] border p-3 hover:bg-[var(--surface-sunken)]', filter === c ? 'border-[var(--accent)]' : 'border-[var(--border)]')}>
              <div className="flex justify-between text-[13px] mb-1.5"><span className="text-[var(--text)] font-medium">{CATEGORY_LABEL[c]}</span><span className="tabular-nums text-[var(--text-muted)]">{audit.categoryScores[c] ?? '—'}</span></div>
              {audit.categoryScores[c] !== undefined ? <Meter value={audit.categoryScores[c]!} /> : <span className="text-[12px] text-[var(--text-subtle)]">Not checked</span>}
            </button>
          ))}
        </div>
      </Card>

      {unknown.length > 0 && (
        <Notice tone="info" title="Some checks couldn’t be run">
          {unknown.map((f) => f.title).join(' · ')}. These are excluded from the score, not counted as passed.
        </Notice>
      )}

      <Card className="p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-[15px] font-semibold text-[var(--text)]">Prioritized actions</h3>
          <span className="text-[12px] text-[var(--text-subtle)]">Ordered by impact and severity, quick wins first</span>
        </div>
        {audit.priorities.length === 0 ? <p className="text-sm text-[var(--text-muted)] mt-3">Nothing to fix. Keep hours and details confirmed as things change.</p> : (
          <ol className="divide-y divide-[var(--border)]">{audit.priorities.slice(0, 8).map((f, i) => <FindingRow key={f.checkId} f={f} onFix={onFix} defaultOpen={i === 0} />)}</ol>
        )}
      </Card>

      <Card className="p-5">
        <button type="button" className="flex items-center gap-2 text-[15px] font-semibold text-[var(--text)]" onClick={() => setShowAll(!showAll)} aria-expanded={showAll}>
          {showAll ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />} All checks ({audit.findings.length}){filter !== 'all' && ` · ${CATEGORY_LABEL[filter]}`}
        </button>
        {showAll && (
          <>
            {filter !== 'all' && <Button size="sm" variant="ghost" className="mt-2" onClick={() => setFilter('all')}>Show all categories</Button>}
            <ul className="divide-y divide-[var(--border)] mt-2">{findings.map((f) => <FindingRow key={f.checkId} f={f} onFix={onFix} />)}</ul>
          </>
        )}
      </Card>

      <Card className="p-5">
        <h3 className="text-[15px] font-semibold text-[var(--text)] mb-1">Audit history</h3>
        {history.length < 2 ? <p className="text-[13px] text-[var(--text-muted)]">Record audits over time to see progress here.</p> : (
          <div className="h-44 mt-2">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--text-subtle)' }} stroke="var(--border)" />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: 'var(--text-subtle)' }} stroke="var(--border)" />
                <Tooltip contentStyle={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }} />
                <Line type="monotone" dataKey="score" name="Health" stroke="var(--accent)" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="completeness" name="Completeness" stroke="var(--success)" strokeWidth={2} strokeDasharray="4 3" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
        <ul className="mt-3 divide-y divide-[var(--border)] text-[13px]">
          {history.slice(0, 10).map((h) => (
            <li key={h.id} className="py-2 flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="w-32 text-[var(--text-muted)]">{timeAgo(h.ranAt)}</span>
              <span className="tabular-nums font-medium text-[var(--text)] w-20">Score {h.score}</span>
              <span className="tabular-nums text-[var(--text-muted)] w-28">Complete {h.completeness}%</span>
              <span className="text-[var(--text-muted)]">{h.counts.fail} fail · {h.counts.warn} warn</span>
              <span className="text-[var(--text-subtle)] truncate flex-1">{h.ranBy === 'system' ? 'Automatic (on creation)' : `by ${h.ranBy}`} · v{h.profileVersion}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

