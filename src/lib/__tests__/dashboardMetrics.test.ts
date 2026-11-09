/**
 * Dashboard metrics are computed only from records; missing comparisons are null, not invented.
 * Run: npx tsx src/lib/__tests__/dashboardMetrics.test.ts
 */
import assert from 'node:assert/strict';
import {
  resolveRange, bucketsFor, computeKpis, buildInsights, toCsv, exportRows, leadSources, pipelineByStage, formatValue, relativeTime,
} from '../dashboardMetrics';

let passed = 0; const ok = (n: string) => { passed++; console.log('  ✓', n); };
const NOW = new Date('2026-06-15T12:00:00').getTime();
const DAY = 86_400_000;
const at = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString();

// ---- Ranges ----
const r30 = resolveRange('30d', NOW);
assert.equal(Math.round((r30.end - r30.start) / DAY), 30); assert.equal(r30.prevEnd, r30.start); assert.equal(r30.unit, 'day');
assert.equal(bucketsFor(r30).length, 30);
const r90 = resolveRange('90d', NOW); assert.equal(r90.unit, 'week'); assert.equal(bucketsFor(r90).length, 13);
const rt = resolveRange('today', NOW); assert.equal(rt.unit, 'hour'); assert.equal(bucketsFor(rt).length, 8); assert.equal(rt.compareLabel, 'vs yesterday');
const rc = resolveRange('custom', NOW, { from: '2026-06-01', to: '2026-06-10' });
assert.equal(Math.round((rc.end - rc.start) / DAY), 10);
const rcSwapped = resolveRange('custom', NOW, { from: '2026-06-10', to: '2026-06-01' });
assert.equal(rcSwapped.start <= rcSwapped.end, true);
assert.equal(resolveRange('custom', NOW).key, '30d');
ok('ranges: fixed, today (hourly), custom (inclusive, order-safe), fallback; previous period is adjacent');

// ---- Empty organization ----
const empty = computeKpis({ deals: [], leads: [], tickets: [] }, r30);
assert.equal(empty.find((k) => k.id === 'new_leads')!.value, 0);
assert.equal(empty.find((k) => k.id === 'win_rate')!.value, null);
assert.equal(empty.find((k) => k.id === 'lead_conversion')!.value, null);
assert.equal(empty.find((k) => k.id === 'win_rate')!.changePct, null);
assert.deepEqual(buildInsights({ deals: [], leads: [], tickets: [] }, r30, NOW), []);
assert.equal(formatValue(null, 'percent'), '—');
ok('empty organization: zeros where counts are zero, "—" where a rate can\'t be computed, no insights');

// ---- Real figures ----
const data = {
  leads: [
    ...Array.from({ length: 6 }, (_, i) => ({ id: `l${i}`, name: `Lead ${i}`, source: 'website', status: i < 2 ? 'converted' : 'new', score: i === 3 ? 80 : 40, owner: i === 4 ? '' : 'Olivia', createdAt: at(i + 1) })),
    ...Array.from({ length: 3 }, (_, i) => ({ id: `p${i}`, source: 'email', status: 'new', owner: 'Olivia', createdAt: at(35 + i) })),
  ],
  deals: [
    { id: 'd1', value: 1000, stage: 'won', createdAt: at(20), updatedAt: at(2) },
    { id: 'd2', value: 500, stage: 'lost', createdAt: at(20), updatedAt: at(3) },
    { id: 'd3', value: 2000, stage: 'proposal', createdAt: at(5), updatedAt: at(5) },
    { id: 'd4', value: 700, stage: 'qualified', createdAt: at(40), updatedAt: at(30) },
    { id: 'd5', value: 300, stage: 'won', createdAt: at(50), updatedAt: at(45) },
  ],
  tickets: [
    { id: 't1', status: 'open', priority: 'critical', subject: 'Login broken', createdAt: at(1) },
    { id: 't2', status: 'resolved', priority: 'low', createdAt: at(2) },
  ],
};
const k = Object.fromEntries(computeKpis(data, r30).map((x) => [x.id, x]));
assert.equal(k.new_leads.value, 6); assert.equal(k.new_leads.previous, 3); assert.equal(Math.round(k.new_leads.changePct!), 100);
assert.equal(k.pipeline_added.value, 3500);
assert.equal(k.won_revenue.value, 1000); assert.equal(k.won_revenue.previous, 300);
assert.equal(k.win_rate.value, 50); assert.equal(k.win_rate.previous, 100); assert.equal(k.win_rate.changePct, -50);
assert.equal(Math.round(k.lead_conversion.value!), 33); assert.equal(k.lead_conversion.previous, 0);
assert.equal(k.open_tickets.value, 1); assert.match(k.open_tickets.secondary!, /1 critical/);
assert.equal(k.new_leads.series.reduce((a: number, b: number) => a + b, 0), 6);
assert.equal(k.new_leads.series.length, 30);
ok('KPIs: counts, values, win rate (pp change), conversion, open tickets and sparklines match the records');

assert.deepEqual(pipelineByStage(data.deals).filter((s) => s.count).map((s) => [s.stage, s.count, s.value]), [['qualified', 1, 700], ['proposal', 1, 2000]]);
assert.deepEqual(leadSources(data.leads, r30).map((s) => [s.label, s.count]), [['Website', 6]]);
ok('pipeline by stage covers open deals only; sources count this period only');

const ins = Object.fromEntries(buildInsights(data, r30, NOW).map((i) => [i.id, i]));
assert.equal(ins.lead_trend.tone, 'positive'); assert.match(ins.lead_trend.title, /up 100%/);
assert.match(ins.stalled.title, /^1 deal/);           // d4 untouched for 30 days
assert.match(ins.critical_tickets.detail, /Login broken/);
assert.match(ins.hot_leads.title, /^1 high-scoring/);
assert.match(ins.unassigned.title, /^1 lead/);
assert.equal(ins.top_source, undefined);               // one source only: no comparison to make
ok('insights appear only when the records support them');

// ---- Export ----
const ex = exportRows(data, r30);
assert.equal(ex.leads.length, 6); assert.equal(ex.summary.length, 6);
assert.equal(ex.deals.some((d) => d.name === undefined && d.value === 300), false);
const csv = toCsv([{ a: '=SUM(A1)', b: 'x, "y"' }, { a: 'plain', b: '' }]);
assert.equal(csv, `a,b\r\n'=SUM(A1),"x, ""y"""\r\nplain,`);
ok('CSV export: period rows only, quoting, and formula injection neutralised');

assert.equal(relativeTime(at(0), NOW), 'Just now'); assert.equal(relativeTime(at(1.5), NOW), 'Yesterday'); assert.equal(relativeTime(undefined, NOW), '');
ok('relative times');

console.log(`\n${passed} passed (dashboard metrics)`);
