/**
 * Dashboard metrics: pure functions over the organization's own records (deals, leads, tickets).
 * Every number is computed from those records; when a figure can't be computed (no earlier data,
 * nothing closed yet) the result says so (null) instead of inventing a value.
 */

export type RangeKey = 'today' | '7d' | '30d' | '90d' | 'custom';
export type BucketUnit = 'hour' | 'day' | 'week';

export interface DashboardDeal {
  id: string; name?: string; client?: string; value?: number | string; stage?: string; owner?: string;
  channelOrigin?: string; createdAt?: string; updatedAt?: string;
}
export interface DashboardLead {
  id: string; name?: string; email?: string; company?: string; source?: string; status?: string; score?: number;
  owner?: string; isConverted?: boolean; createdAt?: string;
}
export interface DashboardTicket {
  id: string; subject?: string; customerName?: string; status?: string; priority?: string; createdAt?: string;
}
export interface DashboardData { deals: DashboardDeal[]; leads: DashboardLead[]; tickets: DashboardTicket[] }

export interface ResolvedRange {
  key: RangeKey;
  start: number; end: number;          // current period [start, end)
  prevStart: number; prevEnd: number;  // the same length immediately before
  unit: BucketUnit;
  label: string;                       // "Last 30 days"
  compareLabel: string;                // "vs previous 30 days"
}

const DAY = 86_400_000;
const HOUR = 3_600_000;

export const RANGE_OPTIONS: { key: RangeKey; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
  { key: '90d', label: '90 days' },
  { key: 'custom', label: 'Custom' },
];

function startOfDay(t: number) { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); }

/** Turns a range choice into concrete timestamps, a comparison period and a chart bucket size. */
export function resolveRange(key: RangeKey, now: number = Date.now(), custom?: { from?: string; to?: string }): ResolvedRange {
  const endOfToday = startOfDay(now) + DAY;
  let start: number, end: number, label: string;
  if (key === 'today') { start = startOfDay(now); end = endOfToday; label = 'Today'; }
  else if (key === 'custom' && custom?.from && custom?.to) {
    const a = startOfDay(new Date(`${custom.from}T00:00:00`).getTime());
    const b = startOfDay(new Date(`${custom.to}T00:00:00`).getTime()) + DAY;
    start = Math.min(a, b - DAY); end = Math.max(b, a + DAY);
    label = `${fmtDay(start)} – ${fmtDay(end - DAY)}`;
  } else {
    const days = key === '7d' ? 7 : key === '90d' ? 90 : 30;
    start = endOfToday - days * DAY; end = endOfToday; label = `Last ${days} days`;
    if (key === 'custom') key = '30d';
  }
  const len = end - start;
  const days = Math.round(len / DAY);
  const unit: BucketUnit = days <= 1 ? 'hour' : days <= 45 ? 'day' : 'week';
  const compareLabel = days <= 1 ? 'vs yesterday' : `vs previous ${days} days`;
  return { key, start, end, prevStart: start - len, prevEnd: start, unit, label, compareLabel };
}

export function fmtDay(t: number) { return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }

export interface Bucket { start: number; end: number; label: string }

/** Chart buckets covering the range (hours for one day, days up to ~6 weeks, then weeks). */
export function bucketsFor(r: ResolvedRange): Bucket[] {
  const step = r.unit === 'hour' ? 3 * HOUR : r.unit === 'day' ? DAY : 7 * DAY;
  const out: Bucket[] = [];
  for (let s = r.start; s < r.end; s += step) {
    const e = Math.min(s + step, r.end);
    const label = r.unit === 'hour'
      ? new Date(s).toLocaleTimeString(undefined, { hour: 'numeric' })
      : fmtDay(s);
    out.push({ start: s, end: e, label });
  }
  return out;
}

const ts = (v?: string) => { const t = v ? Date.parse(v) : NaN; return Number.isFinite(t) ? t : null; };
const inRange = (v: string | undefined, a: number, b: number) => { const t = ts(v); return t !== null && t >= a && t < b; };
const money = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
export const isOpenDeal = (d: DashboardDeal) => d.stage !== 'won' && d.stage !== 'lost';
const isConverted = (l: DashboardLead) => !!l.isConverted || l.status === 'converted';
/** A deal's close time: the last update of a won/lost deal (there is no separate close-date field). */
const closedAt = (d: DashboardDeal) => d.updatedAt || d.createdAt;

export interface Kpi {
  id: 'new_leads' | 'pipeline_added' | 'won_revenue' | 'win_rate' | 'lead_conversion' | 'open_tickets';
  label: string;
  value: number | null;            // null = can't be computed for this period
  previous: number | null;
  /** Relative change in percent (null when there's no earlier figure to compare with). */
  changePct: number | null;
  format: 'number' | 'currency' | 'percent';
  /** Higher is better (true) or worse (false); drives the colour of the change. */
  higherIsBetter: boolean;
  series: number[];                // one point per bucket, for the sparkline
  hint: string;                    // how the figure is computed (tooltip)
  secondary?: string;              // small extra line
  view: string;                    // where to go for details
}

function change(cur: number | null, prev: number | null): number | null {
  if (cur === null || prev === null) return null;
  if (prev === 0) return cur === 0 ? 0 : null;
  return ((cur - prev) / Math.abs(prev)) * 100;
}

function winRate(deals: DashboardDeal[], a: number, b: number): number | null {
  const closed = deals.filter((d) => (d.stage === 'won' || d.stage === 'lost') && inRange(closedAt(d), a, b));
  if (!closed.length) return null;
  return (closed.filter((d) => d.stage === 'won').length / closed.length) * 100;
}

function conversion(leads: DashboardLead[], a: number, b: number): number | null {
  const created = leads.filter((l) => inRange(l.createdAt, a, b));
  if (!created.length) return null;
  return (created.filter(isConverted).length / created.length) * 100;
}

export function computeKpis(data: DashboardData, r: ResolvedRange): Kpi[] {
  const B = bucketsFor(r);
  const { deals, leads, tickets } = data;
  const countIn = <T,>(rows: T[], at: (x: T) => string | undefined, a: number, b: number) => rows.filter((x) => inRange(at(x), a, b)).length;
  const sumIn = <T,>(rows: T[], at: (x: T) => string | undefined, val: (x: T) => number, a: number, b: number) =>
    rows.filter((x) => inRange(at(x), a, b)).reduce((s, x) => s + val(x), 0);

  const won = deals.filter((d) => d.stage === 'won');
  const openDeals = deals.filter(isOpenDeal);
  const openTickets = tickets.filter((t) => t.status !== 'resolved');
  const critical = openTickets.filter((t) => t.priority === 'critical').length;

  const newLeads = countIn(leads, (l) => l.createdAt, r.start, r.end);
  const newLeadsPrev = countIn(leads, (l) => l.createdAt, r.prevStart, r.prevEnd);
  const added = sumIn(deals, (d) => d.createdAt, (d) => money(d.value), r.start, r.end);
  const addedPrev = sumIn(deals, (d) => d.createdAt, (d) => money(d.value), r.prevStart, r.prevEnd);
  const wonRev = sumIn(won, closedAt, (d) => money(d.value), r.start, r.end);
  const wonRevPrev = sumIn(won, closedAt, (d) => money(d.value), r.prevStart, r.prevEnd);
  const wr = winRate(deals, r.start, r.end), wrPrev = winRate(deals, r.prevStart, r.prevEnd);
  const cv = conversion(leads, r.start, r.end), cvPrev = conversion(leads, r.prevStart, r.prevEnd);
  const newTickets = countIn(tickets, (t) => t.createdAt, r.start, r.end);
  const newTicketsPrev = countIn(tickets, (t) => t.createdAt, r.prevStart, r.prevEnd);
  const openValue = openDeals.reduce((s, d) => s + money(d.value), 0);

  return [
    {
      id: 'new_leads', label: 'New leads', value: newLeads, previous: newLeadsPrev, changePct: change(newLeads, newLeadsPrev),
      format: 'number', higherIsBetter: true, view: 'leads',
      series: B.map((b) => countIn(leads, (l) => l.createdAt, b.start, b.end)),
      hint: 'Leads created in this period, from every channel.',
      secondary: `${leads.length.toLocaleString()} in total`,
    },
    {
      id: 'pipeline_added', label: 'Pipeline added', value: added, previous: addedPrev, changePct: change(added, addedPrev),
      format: 'currency', higherIsBetter: true, view: 'deals',
      series: B.map((b) => sumIn(deals, (d) => d.createdAt, (d) => money(d.value), b.start, b.end)),
      hint: 'Total value of deals created in this period.',
      secondary: `${formatValue(openValue, 'currency')} open across ${openDeals.length} deal${openDeals.length === 1 ? '' : 's'}`,
    },
    {
      id: 'won_revenue', label: 'Won revenue', value: wonRev, previous: wonRevPrev, changePct: change(wonRev, wonRevPrev),
      format: 'currency', higherIsBetter: true, view: 'deals',
      series: B.map((b) => sumIn(won, closedAt, (d) => money(d.value), b.start, b.end)),
      hint: 'Value of deals marked Won in this period (dated by their last stage change).',
      secondary: `${won.filter((d) => inRange(closedAt(d), r.start, r.end)).length} deal(s) won`,
    },
    {
      id: 'win_rate', label: 'Win rate', value: wr, previous: wrPrev, changePct: wr !== null && wrPrev !== null ? wr - wrPrev : null,
      format: 'percent', higherIsBetter: true, view: 'deals',
      series: B.map((b) => winRate(deals, b.start, b.end) ?? 0),
      hint: 'Won ÷ (won + lost) for deals closed in this period. Change is in percentage points.',
      secondary: wr === null ? 'No deals closed in this period' : undefined,
    },
    {
      id: 'lead_conversion', label: 'Lead conversion', value: cv, previous: cvPrev, changePct: cv !== null && cvPrev !== null ? cv - cvPrev : null,
      format: 'percent', higherIsBetter: true, view: 'leads',
      series: B.map((b) => conversion(leads, b.start, b.end) ?? 0),
      hint: 'Share of leads created in this period that have been converted. Change is in percentage points.',
      secondary: cv === null ? 'No leads created in this period' : undefined,
    },
    {
      id: 'open_tickets', label: 'Open tickets', value: openTickets.length, previous: null, changePct: change(newTickets, newTicketsPrev),
      format: 'number', higherIsBetter: false, view: 'dashboard',
      series: B.map((b) => countIn(tickets, (t) => t.createdAt, b.start, b.end)),
      hint: 'Support tickets not yet resolved (right now). The change compares tickets opened in this period with the previous one.',
      secondary: critical ? `${critical} critical` : `${newTickets} opened in this period`,
    },
  ];
}

export function formatValue(v: number | null, format: Kpi['format'], currency = 'USD'): string {
  if (v === null || !Number.isFinite(v)) return '—';
  if (format === 'percent') return `${v.toFixed(v >= 10 || v === 0 ? 0 : 1)}%`;
  if (format === 'currency') {
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency, notation: Math.abs(v) >= 100_000 ? 'compact' : 'standard', maximumFractionDigits: Math.abs(v) >= 100_000 ? 1 : 0 }).format(v);
    } catch { return `$${Math.round(v).toLocaleString()}`; }
  }
  return Math.round(v).toLocaleString();
}

/** Leads created and revenue won per bucket, plus deals created, for the performance chart. */
export function performanceSeries(data: DashboardData, r: ResolvedRange) {
  return bucketsFor(r).map((b) => ({
    label: b.label,
    start: b.start,
    leads: data.leads.filter((l) => inRange(l.createdAt, b.start, b.end)).length,
    deals: data.deals.filter((d) => inRange(d.createdAt, b.start, b.end)).length,
    won: data.deals.filter((d) => d.stage === 'won' && inRange(closedAt(d), b.start, b.end)).reduce((s, d) => s + money(d.value), 0),
  }));
}

export const STAGES: { id: string; label: string }[] = [
  { id: 'lead', label: 'Lead' }, { id: 'discovery', label: 'Discovery' }, { id: 'qualified', label: 'Qualified' },
  { id: 'proposal', label: 'Proposal' }, { id: 'negotiation', label: 'Negotiation' },
];

/** Open deals per stage (count and value), in pipeline order. */
export function pipelineByStage(deals: DashboardDeal[]) {
  return STAGES.map((s) => {
    const rows = deals.filter((d) => d.stage === s.id);
    return { stage: s.id, label: s.label, count: rows.length, value: rows.reduce((sum, d) => sum + money(d.value), 0) };
  });
}

const SOURCE_LABELS: Record<string, string> = {
  whatsapp: 'WhatsApp', email: 'Email', voice: 'Phone', inbound_call: 'Phone', linkedin: 'LinkedIn', website: 'Website',
  referral: 'Referral', ad_campaign: 'Ads', widget: 'Live chat', sms: 'SMS', instagram: 'Instagram', facebook: 'Facebook',
};
export const sourceLabel = (s?: string) => (s ? SOURCE_LABELS[s] || s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ') : 'Unknown');

/** Where this period's leads came from, largest first. */
export function leadSources(leads: DashboardLead[], r: ResolvedRange) {
  const counts = new Map<string, number>();
  for (const l of leads) if (inRange(l.createdAt, r.start, r.end)) { const k = sourceLabel(l.source); counts.set(k, (counts.get(k) || 0) + 1); }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  return [...counts.entries()].map(([label, count]) => ({ label, count, pct: total ? (count / total) * 100 : 0 })).sort((a, b) => b.count - a.count);
}

export interface Insight {
  id: string;
  tone: 'positive' | 'warning' | 'info';
  title: string;
  detail: string;
  action?: { label: string; view: string };
}

/**
 * Plain observations drawn from the records. Each one only appears when the data supports it;
 * there is no guessing and no AI text here.
 */
export function buildInsights(data: DashboardData, r: ResolvedRange, now: number = Date.now()): Insight[] {
  const out: Insight[] = [];
  const kpis = computeKpis(data, r);
  const leadsKpi = kpis.find((k) => k.id === 'new_leads')!;
  if (leadsKpi.previous !== null && leadsKpi.previous >= 3 && leadsKpi.changePct !== null && Math.abs(leadsKpi.changePct) >= 20) {
    const up = leadsKpi.changePct > 0;
    out.push({
      id: 'lead_trend', tone: up ? 'positive' : 'warning',
      title: `New leads ${up ? 'up' : 'down'} ${Math.abs(Math.round(leadsKpi.changePct))}%`,
      detail: `${leadsKpi.value} this period ${r.compareLabel.replace('vs', 'against')} (${leadsKpi.previous}).`,
      action: { label: 'View leads', view: 'leads' },
    });
  }
  const stalled = data.deals.filter((d) => isOpenDeal(d) && (ts(d.updatedAt || d.createdAt) ?? now) < now - 14 * DAY);
  if (stalled.length) {
    const value = stalled.reduce((s, d) => s + money(d.value), 0);
    out.push({
      id: 'stalled', tone: 'warning',
      title: `${stalled.length} deal${stalled.length === 1 ? '' : 's'} haven't moved in 14+ days`,
      detail: `${formatValue(value, 'currency')} of pipeline is waiting on a next step.`,
      action: { label: 'Review deals', view: 'deals' },
    });
  }
  const critical = data.tickets.filter((t) => t.status !== 'resolved' && t.priority === 'critical');
  if (critical.length) {
    out.push({
      id: 'critical_tickets', tone: 'warning',
      title: `${critical.length} critical ticket${critical.length === 1 ? '' : 's'} open`,
      detail: critical.slice(0, 2).map((t) => t.subject || t.customerName || 'Untitled').join(' · '),
      action: { label: 'Open work queues', view: 'dashboard#work-queues' },
    });
  }
  const hot = data.leads.filter((l) => (l.status === 'new' || !l.status) && Number(l.score) >= 70);
  if (hot.length) {
    out.push({
      id: 'hot_leads', tone: 'info',
      title: `${hot.length} high-scoring lead${hot.length === 1 ? '' : 's'} not contacted yet`,
      detail: `Score 70+ and still marked New${hot[0]?.name ? `, e.g. ${hot[0].name}` : ''}.`,
      action: { label: 'Contact them', view: 'leads' },
    });
  }
  const unassigned = data.leads.filter((l) => !isConverted(l) && !l.owner);
  if (unassigned.length) {
    out.push({
      id: 'unassigned', tone: 'info',
      title: `${unassigned.length} lead${unassigned.length === 1 ? '' : 's'} without an owner`,
      detail: 'Assign an owner so someone follows up.',
      action: { label: 'Assign owners', view: 'leads' },
    });
  }
  const sources = leadSources(data.leads, r);
  if (sources.length >= 2 && sources[0].count >= 5) {
    out.push({
      id: 'top_source', tone: 'positive',
      title: `${sources[0].label} brings the most leads`,
      detail: `${Math.round(sources[0].pct)}% of this period's ${sources.reduce((s, x) => s + x.count, 0)} leads.`,
    });
  }
  return out;
}

/** CSV with a header row; values quoted and protected against spreadsheet formula injection. */
export function toCsv(rows: Record<string, unknown>[], columns?: string[]): string {
  const cols = columns || [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const cell = (v: unknown) => {
    let s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.map(cell).join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\r\n');
}

/** Rows for export, limited to the selected period. */
export function exportRows(data: DashboardData, r: ResolvedRange) {
  const kpis = computeKpis(data, r);
  return {
    summary: kpis.map((k) => ({ metric: k.label, period: r.label, value: formatValue(k.value, k.format), previous_period: formatValue(k.previous, k.format), how_computed: k.hint })),
    deals: data.deals.filter((d) => inRange(d.createdAt, r.start, r.end) || inRange(d.updatedAt, r.start, r.end))
      .map((d) => ({ name: d.name, client: d.client, value: money(d.value), stage: d.stage, owner: d.owner || '', source: d.channelOrigin || '', created: d.createdAt, updated: d.updatedAt })),
    leads: data.leads.filter((l) => inRange(l.createdAt, r.start, r.end))
      .map((l) => ({ name: l.name, email: l.email, company: l.company || '', source: sourceLabel(l.source), status: l.status, score: l.score ?? '', owner: l.owner || '', created: l.createdAt })),
  };
}

/** "3 minutes ago", "Yesterday", "Mar 4". */
export function relativeTime(iso: string | undefined, now: number = Date.now()): string {
  const t = ts(iso);
  if (t === null) return '';
  const s = Math.round((now - t) / 1000);
  if (s < 60) return 'Just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 2 * 86_400) return 'Yesterday';
  if (s < 7 * 86_400) return `${Math.floor(s / 86_400)} days ago`;
  return fmtDay(t);
}
