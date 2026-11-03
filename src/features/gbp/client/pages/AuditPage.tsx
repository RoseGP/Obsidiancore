/** Profile audit: run (background job), scores, issues with why/fix/priority/effort/benefit, PDF report. */
import React, { useMemo, useState } from 'react';
import { CheckCircle2, CircleDashed, ClipboardCheck, Download, RefreshCw, XCircle } from 'lucide-react';
import { Area as AreaC, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AREA_LABEL, EFFORT_LABEL, PRIORITY_LABEL, type Area, type AuditResult, type GLocation, type Priority } from '../api';
import { downloadAuditPdf } from '../auditPdf';
import { routeForAction, useGrowth, useLoad } from '../GrowthStore';
import { Alert, Badge, Bar, Button, Card, Empty, PageHeader, PRIORITY_TONE, ScoreRing, Skeleton, Tabs, fmtDate, fmtDateTime, useToast } from '../ui';

export default function AuditPage() {
  const { api, location, go, reload } = useGrowth();
  const toast = useToast();
  const q = useLoad(() => api<{ audit: AuditResult | null; history: { at: string; overall: number }[]; location: GLocation; profile: any }>(`/growth/audit?location=${encodeURIComponent(location!.name)}`), [location?.name]);
  const [job, setJob] = useState<{ step: string; progress: number } | null>(null);
  const [area, setArea] = useState<'all' | Area>('all');
  const [prio, setPrio] = useState<'all' | Priority>('all');
  const [view, setView] = useState<'issues' | 'checks'>('issues');

  const run = async () => {
    try {
      let j = await api<any>('/growth/audits', { method: 'POST', json: { location: location!.name } });
      while (j.status === 'queued' || j.status === 'running') { setJob({ step: j.step, progress: j.progress }); await new Promise((r) => setTimeout(r, 800)); j = await api<any>(`/growth/jobs/${j.id}`); }
      if (j.status === 'failed') throw new Error(j.error);
      toast('ok', 'Audit complete'); await q.reload(); reload();
    } catch (e: any) { toast('danger', e.message || 'The audit failed.'); }
    finally { setJob(null); }
  };

  const a = q.data?.audit;
  const issues = useMemo(() => (a?.issues ?? []).filter((i) => (area === 'all' || i.area === area) && (prio === 'all' || i.issue.priority === prio)), [a, area, prio]);

  return (
    <div className="space-y-5 g-fade">
      <PageHeader title="Profile audit" description="37 checks on completeness, local SEO, information quality, reputation, content and maintenance, using your live Google data."
        actions={<>
          {a && <Button icon={<Download size={15} />} onClick={() => downloadAuditPdf(q.data!.location, a)}>Download PDF</Button>}
          <Button variant="primary" icon={<RefreshCw size={15} />} loading={!!job} onClick={run}>{a ? 'Run new audit' : 'Run audit'}</Button>
        </>} />

      {job && (
        <div className="g-card g-card-pad" aria-live="polite">
          <p className="mb-2 text-[13.5px] font-semibold">{job.step}…</p>
          <div className="h-2 overflow-hidden rounded-full" style={{ background: 'var(--g-raised)' }}><div className="h-full rounded-full" style={{ width: `${job.progress}%`, background: 'var(--g-accent)', transition: 'width .4s' }} /></div>
        </div>
      )}

      {q.loading ? <Skeleton h={280} /> : q.error ? <Alert tone="danger" title={q.error} /> : !a ? (
        <Card><Empty icon={<ClipboardCheck size={20} />} title="No audit yet" body="Run your first audit to get a Profile Health score and a prioritised list of improvements." action={<Button variant="primary" onClick={run} loading={!!job}>Run audit</Button>} /></Card>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
            <Card title="Profile Health" description={`Audited ${fmtDateTime(a.generatedAt)}. This app’s assessment, not a Google score.`}>
              <div className="flex flex-wrap items-center gap-6">
                <ScoreRing value={a.overall} size={132} label="Profile Health" />
                <ul className="min-w-[200px] flex-1 space-y-2.5">
                  {(Object.keys(a.areas) as Area[]).map((k) => (
                    <li key={k}><button type="button" onClick={() => { setArea(k); setView('issues'); }} className="w-full text-left" style={{ background: 'none', border: 0, padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer' }}>
                      <div className="mb-1 flex justify-between text-[12.5px]"><span className="g-muted">{AREA_LABEL[k]}</span><span className="g-num font-semibold">{a.areas[k] ?? 'n/a'}</span></div><Bar value={a.areas[k]} />
                    </button></li>
                  ))}
                </ul>
              </div>
            </Card>
            <Card title="Score history" description="Overall Profile Health over time.">
              {q.data!.history.length < 2 ? <p className="g-muted text-[13.5px]">Run another audit later to see your progress here.</p> : (
                <div style={{ height: 190 }}>
                  <ResponsiveContainer>
                    <AreaChart data={q.data!.history.map((h) => ({ date: fmtDate(h.at), score: h.overall }))} margin={{ left: -20, right: 8, top: 8 }}>
                      <defs><linearGradient id="gpAuditFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--g-accent)" stopOpacity={0.35} /><stop offset="100%" stopColor="var(--g-accent)" stopOpacity={0} /></linearGradient></defs>
                      <CartesianGrid stroke="var(--g-line)" vertical={false} />
                      <XAxis dataKey="date" tick={{ fill: 'var(--g-faint)', fontSize: 11 }} axisLine={false} tickLine={false} />
                      <YAxis domain={[0, 100]} tick={{ fill: 'var(--g-faint)', fontSize: 11 }} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={{ background: 'var(--g-surface)', border: '1px solid var(--g-line)', borderRadius: 10, color: 'var(--g-text)' }} />
                      <AreaC type="monotone" dataKey="score" stroke="var(--g-accent)" strokeWidth={2} fill="url(#gpAuditFill)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>
          </div>

          {a.notes.length > 0 && <Alert tone="info">{a.notes.map((n) => <p key={n}>{n}</p>)}</Alert>}

          <Card title={view === 'issues' ? `Issues to fix (${issues.length})` : `All checks (${a.checks.length})`}
            actions={<Tabs value={view} onChange={setView} label="View" options={[{ value: 'issues', label: 'Issues' }, { value: 'checks', label: 'All checks' }]} />}>
            {view === 'issues' ? (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  <select className="g-select" style={{ width: 'auto', minHeight: 34 }} aria-label="Filter by area" value={area} onChange={(e) => setArea(e.target.value as any)}>
                    <option value="all">All areas</option>{(Object.keys(AREA_LABEL) as Area[]).map((k) => <option key={k} value={k}>{AREA_LABEL[k]}</option>)}
                  </select>
                  <select className="g-select" style={{ width: 'auto', minHeight: 34 }} aria-label="Filter by priority" value={prio} onChange={(e) => setPrio(e.target.value as any)}>
                    <option value="all">All priorities</option>{(['critical', 'high', 'medium', 'low'] as Priority[]).map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
                  </select>
                </div>
                {!issues.length ? <Alert tone="ok" title="No issues in this view." /> : issues.map((c) => (
                  <article key={c.id} className="rounded-xl p-4" style={{ background: 'var(--g-raised)' }}>
                    <div className="flex flex-wrap items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2"><h3 className="text-[15px] font-semibold">{c.issue.title}</h3><Badge tone={PRIORITY_TONE[c.issue.priority]}>{PRIORITY_LABEL[c.issue.priority]}</Badge><Badge>{EFFORT_LABEL[c.issue.effort]} · ~{c.issue.effortMinutes} min</Badge><span className="g-faint text-[12px]">{AREA_LABEL[c.area]}</span></div>
                        <p className="mt-1.5 text-[13.5px]">{c.issue.description}</p>
                      </div>
                      <Button size="sm" variant="primary" onClick={() => go(routeForAction(c.issue.action.type), { focus: c.issue.action.type })}>{c.issue.action.label}</Button>
                    </div>
                    <dl className="mt-3 grid gap-3 text-[13px] md:grid-cols-3">
                      <div><dt className="g-faint text-[12px] font-semibold">Why it matters</dt><dd className="mt-0.5">{c.issue.whyItMatters}</dd></div>
                      <div><dt className="g-faint text-[12px] font-semibold">What to do</dt><dd className="mt-0.5">{c.issue.solution}</dd></div>
                      <div><dt className="g-faint text-[12px] font-semibold">Expected benefit</dt><dd className="g-muted mt-0.5">{c.issue.expectedBenefit}</dd></div>
                    </dl>
                  </article>
                ))}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="g-table">
                  <thead><tr><th>Result</th><th>Check</th><th>Area</th><th>Note</th></tr></thead>
                  <tbody>{a.checks.map((c) => (
                    <tr key={c.id}>
                      <td>{c.status === 'passed' ? <span className="inline-flex items-center gap-1" style={{ color: 'var(--g-ok)' }}><CheckCircle2 size={15} aria-hidden />Pass</span> : c.status === 'failed' ? <span className="inline-flex items-center gap-1" style={{ color: 'var(--g-danger)' }}><XCircle size={15} aria-hidden />Fix</span> : <span className="g-faint inline-flex items-center gap-1"><CircleDashed size={15} aria-hidden />Not checked</span>}</td>
                      <td className="font-medium">{c.label}</td><td className="g-muted">{AREA_LABEL[c.area]}</td><td className="g-faint">{c.note ?? ''}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
