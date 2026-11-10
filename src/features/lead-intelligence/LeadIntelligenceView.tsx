/**
 * Lead Intelligence Center: every open lead scored and classified Hot / Warm / Cold with the evidence,
 * predictions (closing probability, value, follow-up timing, approach, objections), a next best action,
 * an optional written analysis from Claude or Gemini, and one-click conversion into an opportunity.
 * Data: GET /api/lead-intelligence, POST /api/lead-intelligence/:id/ai-brief, POST /api/leads/:id/convert.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  AlertTriangle, ArrowRight, Brain, CalendarClock, CheckCircle2, ChevronRight, CircleDollarSign, Clock, Flame, Loader2, MessageCircle,
  RefreshCw, Search, ShieldAlert, Snowflake, Sparkles, Sun, Target, TrendingUp, X, Zap,
} from 'lucide-react';
import { Badge, Button, Card, EmptyState, IconButton, Segmented, Skeleton, cx, focusRing } from '../../components/dashboard/ui';
import { invalidateDashboard } from '../../lib/dashboardData';

type Cls = 'hot' | 'warm' | 'cold';
interface Factor { id: string; label: string; weight: number; score: number; evidence: string[] }
interface Nba { type: 'reply' | 'convert' | 'schedule' | 'proposal' | 'contact' | 'nurture'; label: string; detail: string; view?: string }
interface Analysis {
  leadId: string; name: string; company: string; email: string; phone: string; source: string; status: string; owner: string; createdAt: string;
  converted: boolean; convertedDealId?: string; score: number; classification: Cls; explanation: string; factors: Factor[];
  prediction: { closingProbability: number; probabilityBasis: string; potentialValue: number | null; valueBasis: string;
    followUp: { when: string; dueAt: string | null; reason: string; bestTime: string | null }; approach: string[]; objections: string[] };
  qualified: boolean; nextBestAction: Nba | null; lastActivityAt: string | null;
}
interface Summary { hot: number; warm: number; cold: number; total: number; qualified: number; pipelinePotential: number; avgProbability: number | null; calibrated: boolean; closedDeals: number; typicalDealValue: number | null }

const CLS: Record<Cls, { label: string; icon: React.ComponentType<{ className?: string }>; tone: 'danger' | 'warning' | 'info'; ring: string; text: string; glow: string }> = {
  hot: { label: 'Hot', icon: Flame, tone: 'danger', ring: '#fb7185', text: 'text-[var(--danger)]', glow: 'shadow-[0_0_24px_-8px_rgb(251_113_133/0.7)]' },
  warm: { label: 'Warm', icon: Sun, tone: 'warning', ring: '#fbbf24', text: 'text-[var(--warning)]', glow: '' },
  cold: { label: 'Cold', icon: Snowflake, tone: 'info', ring: '#22d3ee', text: 'text-[var(--info)]', glow: '' },
};
const money = (n: number | null) => (n === null ? '—' : new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0, notation: n >= 100_000 ? 'compact' : 'standard' }).format(n));
const SOURCE: Record<string, string> = { website: 'Website', email: 'Email', whatsapp: 'WhatsApp', referral: 'Referral', linkedin: 'LinkedIn', voice: 'Phone', inbound_call: 'Phone', ad_campaign: 'Ads', sms: 'SMS' };

async function api(url: string, init?: RequestInit) {
  const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) { const e: any = new Error(data.error || `Request failed (${res.status}).`); e.code = data.code; e.status = res.status; throw e; }
  return data;
}

function ScoreRing({ score, cls, size = 52 }: { score: number; cls: Cls; size?: number }) {
  const r = size / 2 - 5, c = 2 * Math.PI * r;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={`Score ${score} out of 100`}>
      <svg viewBox={`0 0 ${size} ${size}`} className="-rotate-90" width={size} height={size} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-sunken)" strokeWidth="5" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={CLS[cls].ring} strokeWidth="5" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - score / 100)} style={{ transition: 'stroke-dashoffset .6s ease' }} />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[14px] font-semibold text-[var(--text)] tabular-nums">{score}</span>
    </div>
  );
}

function ClassBadge({ cls }: { cls: Cls }) {
  const m = CLS[cls]; const Icon = m.icon;
  return <Badge tone={m.tone}><Icon className="h-3 w-3" aria-hidden="true" />{m.label}</Badge>;
}

export default function LeadIntelligenceView({ onNavigate, onQuickAction }: { onNavigate: (view: string) => void; onQuickAction?: (type: 'lead' | 'deal' | 'event') => void }) {
  const [data, setData] = useState<{ summary: Summary; leads: Analysis[]; analyzedAt: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | Cls | 'qualified'>('all');
  const [sort, setSort] = useState<'score' | 'probability' | 'value' | 'followup' | 'newest'>('score');
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [converting, setConverting] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: 'ok' | 'error'; text: string; action?: { label: string; view: string } } | null>(null);
  const notify = (t: typeof toast) => { setToast(t); setTimeout(() => setToast(null), 6000); };

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setData(await api('/api/lead-intelligence')); }
    catch (e: any) { setError(e.status === 401 || e.status === 403 ? 'You don’t have access to this organization’s leads.' : 'Lead intelligence couldn’t load. Try again.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const leads = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = (data?.leads || []).filter((l) => (filter === 'all' || (filter === 'qualified' ? l.qualified : l.classification === filter))
      && (!q || `${l.name} ${l.company} ${l.email}`.toLowerCase().includes(q)));
    const due = (l: Analysis) => (l.prediction.followUp.dueAt ? Date.parse(l.prediction.followUp.dueAt) : Infinity);
    return [...rows].sort((a, b) => sort === 'probability' ? b.prediction.closingProbability - a.prediction.closingProbability
      : sort === 'value' ? (b.prediction.potentialValue || 0) - (a.prediction.potentialValue || 0)
      : sort === 'followup' ? due(a) - due(b)
      : sort === 'newest' ? String(b.createdAt).localeCompare(String(a.createdAt)) : b.score - a.score);
  }, [data, filter, sort, query]);
  const open = data?.leads.find((l) => l.leadId === openId) || null;

  const convert = async (l: Analysis, overrides?: { value?: number; stage?: string; title?: string }) => {
    setConverting(l.leadId);
    try {
      const value = overrides?.value ?? l.prediction.potentialValue ?? 0;
      const r = await api(`/api/leads/${encodeURIComponent(l.leadId)}/convert`, { method: 'POST', body: JSON.stringify({ dealValue: value, dealStage: overrides?.stage || 'qualified', dealTitle: overrides?.title || `${l.company || l.name} opportunity` }) });
      invalidateDashboard();
      notify({ kind: 'ok', text: `${l.name} is now an opportunity: “${r.conversion.deal.name}” (${money(r.conversion.deal.value)}).`, action: { label: 'Open pipeline', view: 'deals' } });
      setOpenId(null);
      await load();
    } catch (e: any) { notify({ kind: 'error', text: e.message || 'The lead couldn’t be converted. Try again.' }); }
    finally { setConverting(null); }
  };

  const runAction = (l: Analysis, a: Nba) => {
    if (a.type === 'convert') return void convert(l);
    if (a.type === 'schedule') return onQuickAction ? onQuickAction('event') : onNavigate('calendar');
    if (a.type === 'proposal') {
      try { const u = new URL(window.location.href); u.searchParams.set('subtab', 'proposals'); window.history.replaceState(null, '', u.toString()); } catch { /* ignore */ }
      return onNavigate('proposals');
    }
    onNavigate(a.view || 'leads');
  };

  const s = data?.summary;
  return (
    <div className="mx-auto w-full max-w-[1440px] px-4 sm:px-6 lg:px-8 py-5 sm:py-7 space-y-5">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[var(--cc-cyan)]"><Brain className="h-3.5 w-3.5" aria-hidden="true" />AI Lead Intelligence</p>
          <h1 className="mt-1 text-[26px] sm:text-[30px] font-semibold tracking-[-0.03em] bg-gradient-to-r from-white via-[#cfd6ff] to-[#8fe9ff] bg-clip-text text-transparent">Lead Intelligence Center</h1>
          <p className="mt-1 text-[14px] text-[var(--text-muted)] max-w-2xl">Every lead scored on engagement, conversations, buying intent, budget, requirements, responsiveness and deal value, with the next best action.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-[var(--text-subtle)]" aria-live="polite">{loading ? 'Analyzing…' : data ? `Analyzed ${new Date(data.analyzedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : ''}</span>
          <Button variant="secondary" icon={<RefreshCw className={cx('h-4 w-4', loading && 'animate-spin')} />} onClick={() => void load()} disabled={loading}>Re-analyze</Button>
        </div>
      </header>

      {error && <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[var(--danger-soft)] px-4 py-3 text-[13px] text-[var(--danger)]"><span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4" />{error}</span><Button size="sm" variant="secondary" onClick={() => void load()}>Try again</Button></div>}

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {(['hot', 'warm', 'cold'] as Cls[]).map((c) => {
          const m = CLS[c]; const Icon = m.icon; const n = s?.[c] ?? 0; const on = filter === c;
          return (
            <button key={c} type="button" onClick={() => setFilter(on ? 'all' : c)} aria-pressed={on}
              className={cx('cc-card text-left rounded-[var(--radius-panel)] border p-4 transition-all cursor-pointer hover:-translate-y-px', focusRing, on ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-[var(--border)] bg-[var(--surface)]', c === 'hot' && n > 0 && m.glow)}>
              <span className={cx('flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.08em]', m.text)}><Icon className="h-4 w-4" aria-hidden="true" />{m.label} leads</span>
              <span className="mt-1 block text-[28px] font-semibold text-[var(--text)] tabular-nums">{loading && !s ? '…' : n}</span>
              <span className="text-[11px] text-[var(--text-subtle)]">{c === 'hot' ? 'Score 65+ · act today' : c === 'warm' ? 'Score 40–64 · nurture closely' : 'Under 40 · long-term nurture'}</span>
            </button>
          );
        })}
        <Card as="div" className="p-4">
          <span className="flex items-center gap-1.5 text-[12px] text-[var(--text-muted)]"><CircleDollarSign className="h-4 w-4 text-[var(--accent-text)]" aria-hidden="true" />Expected from qualified leads</span>
          <span className="mt-1 block text-[24px] font-semibold text-[var(--text)] tabular-nums">{s ? money(s.pipelinePotential) : '…'}</span>
          <span className="text-[11px] text-[var(--text-subtle)]">Value × closing probability · {s?.qualified ?? 0} qualified</span>
        </Card>
        <Card as="div" className="p-4">
          <span className="flex items-center gap-1.5 text-[12px] text-[var(--text-muted)]"><Target className="h-4 w-4 text-[var(--accent-text)]" aria-hidden="true" />Average closing probability</span>
          <span className="mt-1 block text-[24px] font-semibold text-[var(--text)] tabular-nums">{s?.avgProbability != null ? `${s.avgProbability}%` : '—'}</span>
          <span className="text-[11px] text-[var(--text-subtle)]">{s?.calibrated ? `Calibrated on ${s.closedDeals} closed deals` : 'Score-based until 10+ deals from leads close'}</span>
        </Card>
      </div>

      {/* Toolbar */}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented label="Show" value={filter} onChange={setFilter} options={[{ value: 'all', label: 'All' }, { value: 'qualified', label: 'Qualified' }, { value: 'hot', label: 'Hot' }, { value: 'warm', label: 'Warm' }, { value: 'cold', label: 'Cold' }]} />
          <label className="relative">
            <span className="sr-only">Search leads</span>
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-subtle)]" aria-hidden="true" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, company, email" className={cx('h-9 w-full sm:w-64 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface-sunken)] pl-8 pr-3 text-[13px] text-[var(--text)] placeholder:text-[var(--text-subtle)]', focusRing)} />
          </label>
        </div>
        <label className="flex items-center gap-2 text-[12px] text-[var(--text-muted)]">Sort by
          <select value={sort} onChange={(e) => setSort(e.target.value as any)} className={cx('h-9 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface-sunken)] px-2 text-[13px] text-[var(--text)]', focusRing)}>
            <option value="score">Score</option><option value="probability">Closing probability</option><option value="value">Potential value</option><option value="followup">Follow-up due</option><option value="newest">Newest</option>
          </select>
        </label>
      </div>

      {/* Lead list */}
      {loading && !data ? (
        <div className="space-y-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28 w-full rounded-[var(--radius-panel)]" />)}</div>
      ) : !leads.length ? (
        <Card className="py-6"><EmptyState icon={<Brain className="h-4 w-4" />}
          title={data?.leads.length ? 'No leads match' : 'No open leads to analyze'}
          body={data?.leads.length ? 'Try another filter or search.' : 'New leads are analyzed the moment they arrive from forms, chat, calls or your team.'}
          action={!data?.leads.length && onQuickAction ? <Button size="sm" variant="secondary" onClick={() => onQuickAction('lead')}>Add a lead</Button> : undefined} /></Card>
      ) : (
        <ul className="space-y-3" aria-label="Leads by score">
          {leads.map((l) => {
            const a = l.nextBestAction;
            return (
              <li key={l.leadId}>
                <Card as="div" className={cx('p-4 hover:border-[var(--border-strong)]', l.classification === 'hot' && CLS.hot.glow)}>
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                    <button type="button" onClick={() => setOpenId(l.leadId)} className={cx('flex items-center gap-3 min-w-0 flex-1 text-left rounded-lg cursor-pointer', focusRing)} aria-label={`Open analysis for ${l.name}`}>
                      <ScoreRing score={l.score} cls={l.classification} />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[15px] font-semibold text-[var(--text)] truncate">{l.name}</span>
                          <ClassBadge cls={l.classification} />
                          {l.qualified && <Badge tone="success"><CheckCircle2 className="h-3 w-3" aria-hidden="true" />Qualified</Badge>}
                        </div>
                        <p className="text-[12px] text-[var(--text-muted)] truncate">{[l.company, SOURCE[l.source] || l.source, l.owner && `Owner: ${l.owner}`].filter(Boolean).join(' · ')}</p>
                        <p className="mt-1 text-[12px] text-[var(--text)] line-clamp-2"><Sparkles className="inline h-3 w-3 mr-1 text-[var(--cc-cyan)]" aria-hidden="true" />{l.explanation}</p>
                      </div>
                    </button>
                    <dl className="grid grid-cols-3 gap-3 lg:w-[360px] shrink-0">
                      <div><dt className="text-[10px] uppercase tracking-[0.08em] text-[var(--text-subtle)]">Close chance</dt><dd className="text-[15px] font-semibold text-[var(--text)] tabular-nums">{l.prediction.closingProbability}%</dd></div>
                      <div><dt className="text-[10px] uppercase tracking-[0.08em] text-[var(--text-subtle)]">Potential</dt><dd className="text-[15px] font-semibold text-[var(--text)] tabular-nums">{money(l.prediction.potentialValue)}</dd></div>
                      <div><dt className="text-[10px] uppercase tracking-[0.08em] text-[var(--text-subtle)]">Follow up</dt><dd className={cx('text-[13px] font-semibold', l.prediction.followUp.when === 'Now' ? 'text-[var(--danger)]' : 'text-[var(--text)]')}>{l.prediction.followUp.when}</dd></div>
                    </dl>
                    <div className="flex flex-wrap items-center gap-2 lg:justify-end lg:w-[300px] shrink-0">
                      {a && a.type !== 'convert' && <Button size="sm" variant="secondary" onClick={() => runAction(l, a)} title={a.detail}><Zap className="h-3.5 w-3.5 text-[var(--cc-cyan)]" aria-hidden="true" />{a.label}</Button>}
                      {l.qualified && <Button size="sm" variant="primary" disabled={converting === l.leadId} onClick={() => void convert(l)} title={`Create a ${money(l.prediction.potentialValue)} deal in your pipeline`}>
                        {converting === l.leadId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <TrendingUp className="h-3.5 w-3.5" />}Convert to opportunity
                      </Button>}
                      <IconButton label={`Details for ${l.name}`} onClick={() => setOpenId(l.leadId)}><ChevronRight className="h-4 w-4" /></IconButton>
                    </div>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {open && <LeadDrawer lead={open} onClose={() => setOpenId(null)} onConvert={convert} converting={converting === open.leadId} onAction={(a) => runAction(open, a)} />}

      {toast && (
        <div role={toast.kind === 'error' ? 'alert' : 'status'} className="fixed bottom-20 sm:bottom-6 left-1/2 -translate-x-1/2 z-[90] flex flex-wrap items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] px-4 py-2.5 text-[13px] text-[var(--text)] shadow-2xl max-w-[calc(100vw-2rem)]">
          {toast.kind === 'error' ? <AlertTriangle className="h-4 w-4 text-[var(--danger)]" /> : <CheckCircle2 className="h-4 w-4 text-[var(--success)]" />}
          <span>{toast.text}</span>
          {toast.action && <button type="button" onClick={() => onNavigate(toast.action!.view)} className="font-semibold text-[var(--accent-text)] underline cursor-pointer">{toast.action.label}</button>}
        </div>
      )}
    </div>
  );
}

function LeadDrawer({ lead: l, onClose, onConvert, converting, onAction }: { lead: Analysis; onClose: () => void; onConvert: (l: Analysis, o?: { value?: number; stage?: string; title?: string }) => void; converting: boolean; onAction: (a: Nba) => void }) {
  const [brief, setBrief] = useState<{ text: string; provider: string } | null>(null);
  const [briefError, setBriefError] = useState<string | null>(null);
  const [briefBusy, setBriefBusy] = useState(false);
  const [provider, setProvider] = useState<'claude' | 'gemini'>('claude');
  const [providers, setProviders] = useState<{ claude: boolean; gemini: boolean } | null>(null);
  const [value, setValue] = useState(String(l.prediction.potentialValue ?? ''));
  const [stage, setStage] = useState('qualified');
  const [title, setTitle] = useState(`${l.company || l.name} opportunity`);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    fetch('/api/chat/models').then((r) => (r.ok ? r.json() : null)).then((d) => {
      const p = { claude: !!d?.providers?.claude?.configured, gemini: !!d?.providers?.gemini?.configured };
      setProviders(p); if (!p.claude && p.gemini) setProvider('gemini');
    }).catch(() => setProviders({ claude: false, gemini: false }));
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const generate = async () => {
    setBriefBusy(true); setBriefError(null);
    try { const r = await api(`/api/lead-intelligence/${encodeURIComponent(l.leadId)}/ai-brief`, { method: 'POST', body: JSON.stringify({ provider }) }); setBrief({ text: r.brief, provider: r.provider }); }
    catch (e: any) { setBriefError(e.message); }
    finally { setBriefBusy(false); }
  };
  const p = l.prediction;
  const noAi = providers && !providers.claude && !providers.gemini;

  return (
    <div className="fixed inset-0 z-[85] flex justify-end" role="dialog" aria-modal="true" aria-labelledby="li-title">
      <div className="absolute inset-0 bg-[#03060d]/70 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <aside className="relative h-full w-full max-w-[640px] overflow-y-auto border-l border-[var(--border)] bg-[#0a1020] shadow-2xl">
        <div className="sticky top-0 z-10 flex items-start gap-3 border-b border-[var(--border)] bg-[#0a1020]/95 backdrop-blur px-5 py-4">
          <ScoreRing score={l.score} cls={l.classification} size={56} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2"><h2 id="li-title" className="text-[18px] font-semibold text-[var(--text)] truncate">{l.name}</h2><ClassBadge cls={l.classification} />{l.qualified && <Badge tone="success">Qualified</Badge>}</div>
            <p className="text-[12px] text-[var(--text-muted)] truncate">{[l.company, l.email, l.phone].filter(Boolean).join(' · ')}</p>
          </div>
          <IconButton label="Close" onClick={onClose}><X className="h-4 w-4" /></IconButton>
        </div>

        <div className="space-y-5 px-5 py-5">
          <section aria-labelledby="li-why">
            <h3 id="li-why" className="mb-1.5 flex items-center gap-1.5 text-[13px] font-semibold text-[var(--text)]"><Sparkles className="h-4 w-4 text-[var(--cc-cyan)]" aria-hidden="true" />Why this rating</h3>
            <p className="text-[13px] text-[var(--text)]">{l.explanation}</p>
          </section>

          <section aria-labelledby="li-factors">
            <h3 id="li-factors" className="mb-2 text-[13px] font-semibold text-[var(--text)]">What the score is made of</h3>
            <ul className="space-y-3">
              {l.factors.map((f) => (
                <li key={f.id}>
                  <div className="flex items-center justify-between text-[12px]"><span className="text-[var(--text)] font-medium">{f.label}</span><span className="text-[var(--text-muted)] tabular-nums">{f.score}/100 · weight {f.weight}%</span></div>
                  <div className="mt-1 h-1.5 rounded-full bg-[var(--surface-sunken)] overflow-hidden" aria-hidden="true"><div className="h-full rounded-full bg-gradient-to-r from-[#5b6cff] to-[#22d3ee]" style={{ width: `${f.score}%` }} /></div>
                  <p className="mt-1 text-[11px] text-[var(--text-muted)]">{f.evidence.join(' · ')}</p>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="li-pred" className="rounded-xl border border-[var(--border)] bg-[var(--surface-sunken)] p-4 space-y-3">
            <h3 id="li-pred" className="text-[13px] font-semibold text-[var(--text)]">Sales prediction</h3>
            <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div><dt className="text-[11px] text-[var(--text-subtle)]">Closing probability</dt><dd className="text-[20px] font-semibold text-[var(--text)] tabular-nums">{p.closingProbability}%</dd><dd className="text-[10px] text-[var(--text-subtle)]">{p.probabilityBasis}</dd></div>
              <div><dt className="text-[11px] text-[var(--text-subtle)]">Potential deal value</dt><dd className="text-[20px] font-semibold text-[var(--text)] tabular-nums">{money(p.potentialValue)}</dd><dd className="text-[10px] text-[var(--text-subtle)]">{p.valueBasis}</dd></div>
              <div><dt className="text-[11px] text-[var(--text-subtle)]">Follow up</dt><dd className={cx('text-[16px] font-semibold', p.followUp.when === 'Now' ? 'text-[var(--danger)]' : 'text-[var(--text)]')}><Clock className="inline h-4 w-4 mr-1" aria-hidden="true" />{p.followUp.when}</dd><dd className="text-[10px] text-[var(--text-subtle)]">{p.followUp.reason}{p.followUp.bestTime ? ` ${p.followUp.bestTime}.` : ''}</dd></div>
            </dl>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-subtle)]">Suggested approach</p><ul className="space-y-1">{p.approach.map((x) => <li key={x} className="flex gap-1.5 text-[12px] text-[var(--text)]"><TrendingUp className="h-3.5 w-3.5 mt-0.5 shrink-0 text-[var(--success)]" aria-hidden="true" />{x}</li>)}</ul></div>
              <div><p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-subtle)]">Potential objections</p><ul className="space-y-1">{p.objections.map((x) => <li key={x} className="flex gap-1.5 text-[12px] text-[var(--text)]"><ShieldAlert className="h-3.5 w-3.5 mt-0.5 shrink-0 text-[var(--warning)]" aria-hidden="true" />{x}</li>)}</ul></div>
            </div>
          </section>

          {l.nextBestAction && (
            <section aria-labelledby="li-nba" className="rounded-xl border border-[var(--accent)]/50 bg-[var(--accent-soft)] p-4">
              <h3 id="li-nba" className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--accent-text)]"><Zap className="h-3.5 w-3.5" aria-hidden="true" />Next best action</h3>
              <p className="mt-1 text-[15px] font-semibold text-[var(--text)]">{l.nextBestAction.label}</p>
              <p className="text-[12px] text-[var(--text-muted)]">{l.nextBestAction.detail}</p>
              {l.nextBestAction.type !== 'convert' && <Button className="mt-3" size="sm" variant="primary" onClick={() => onAction(l.nextBestAction!)}>{l.nextBestAction.type === 'reply' ? <MessageCircle className="h-3.5 w-3.5" /> : l.nextBestAction.type === 'schedule' ? <CalendarClock className="h-3.5 w-3.5" /> : <ArrowRight className="h-3.5 w-3.5" />}Do it now</Button>}
            </section>
          )}

          {!l.converted && (
            <section aria-labelledby="li-convert" className="rounded-xl border border-[var(--border)] p-4 space-y-3">
              <h3 id="li-convert" className="text-[13px] font-semibold text-[var(--text)]">Convert to opportunity</h3>
              <p className="text-[12px] text-[var(--text-muted)]">Creates a contact, company and deal from this lead. Prefilled with the predicted value; change anything first if you like.</p>
              <div className="grid gap-2 sm:grid-cols-3">
                <label className="text-[11px] text-[var(--text-muted)] sm:col-span-3">Deal name<input value={title} onChange={(e) => setTitle(e.target.value)} className={cx('mt-1 h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-sunken)] px-3 text-[13px] text-[var(--text)]', focusRing)} /></label>
                <label className="text-[11px] text-[var(--text-muted)]">Value (USD)<input type="number" min="0" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} className={cx('mt-1 h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-sunken)] px-3 text-[13px] text-[var(--text)] tabular-nums', focusRing)} /></label>
                <label className="text-[11px] text-[var(--text-muted)]">Stage<select value={stage} onChange={(e) => setStage(e.target.value)} className={cx('mt-1 h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-sunken)] px-2 text-[13px] text-[var(--text)]', focusRing)}><option value="discovery">Discovery</option><option value="qualified">Qualified</option><option value="proposal">Proposal</option><option value="negotiation">Negotiation</option></select></label>
                <div className="flex items-end"><Button className="w-full" variant="primary" disabled={converting || !title.trim() || Number(value) < 0} onClick={() => onConvert(l, { value: Number(value) || 0, stage, title: title.trim() })}>{converting ? <Loader2 className="h-4 w-4 animate-spin" /> : <TrendingUp className="h-4 w-4" />}Convert</Button></div>
              </div>
              {!l.qualified && <p className="text-[11px] text-[var(--warning)]">This lead isn’t qualified yet ({CLS[l.classification].label}). You can still convert it.</p>}
            </section>
          )}

          <section aria-labelledby="li-ai" className="rounded-xl border border-[var(--border)] p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 id="li-ai" className="flex items-center gap-1.5 text-[13px] font-semibold text-[var(--text)]"><Brain className="h-4 w-4 text-[var(--cc-violet)]" aria-hidden="true" />AI analysis</h3>
              <div className="flex items-center gap-2">
                <Segmented label="AI provider" size="sm" value={provider} onChange={setProvider} options={[{ value: 'claude', label: 'Claude' }, { value: 'gemini', label: 'Gemini' }]} />
                <Button size="sm" variant="secondary" onClick={() => void generate()} disabled={briefBusy || !!noAi}>{briefBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}{brief ? 'Regenerate' : 'Write analysis'}</Button>
              </div>
            </div>
            {noAi && <p className="text-[12px] text-[var(--warning)]">No AI provider is configured on this server, so a written analysis isn’t available. Everything above is calculated from your records.</p>}
            {providers && !noAi && !providers[provider] && <p className="text-[12px] text-[var(--text-muted)]">{provider === 'claude' ? 'Claude' : 'Gemini'} isn’t configured; the other provider will answer.</p>}
            {briefError && <p role="alert" className="text-[12px] text-[var(--danger)]">{briefError}</p>}
            {brief ? <div className="assistant-md text-[13px]"><Markdown remarkPlugins={[remarkGfm]}>{brief.text}</Markdown><p className="mt-2 text-[10px] text-[var(--text-subtle)]">Written by {brief.provider === 'gemini' ? 'Gemini' : 'Claude'} from the facts above. Check before acting.</p></div>
              : !noAi && <p className="text-[12px] text-[var(--text-muted)]">A tailored brief: why they’re {CLS[l.classification].label.toLowerCase()}, how to win them, answers to likely objections, and what to do next.</p>}
          </section>
        </div>
      </aside>
    </div>
  );
}
