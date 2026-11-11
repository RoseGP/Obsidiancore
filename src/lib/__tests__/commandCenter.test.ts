/**
 * Command Center: priority cards, agenda, headline KPIs and greeting come only from records.
 * Run: npx tsx src/lib/__tests__/commandCenter.test.ts
 */
import assert from 'node:assert/strict';
import { buildAttention, commandCenterInsights, greetingLine, headlineKpis, upcomingMeetings } from '../commandCenter';

let passed = 0; const ok = (n: string) => { passed++; console.log('  ✓', n); };
const NOW = new Date('2026-06-15T10:00:00').getTime();
const H = 3_600_000, DAY = 86_400_000;
const iso = (msFromNow: number) => new Date(NOW + msFromNow).toISOString();
const empty = { deals: [], leads: [], tickets: [] };

// ---- Empty organization ----
assert.deepEqual(buildAttention(empty, NOW), []);
assert.deepEqual(upcomingMeetings({}, NOW), []);
const k0 = headlineKpis(empty, NOW);
assert.equal(k0.length, 5); assert.deepEqual(k0.map((k) => k.value), ['0', '0', '0', '$0', '$0']);
assert.equal(k0[0].change?.text, 'No change');
assert.match(greetingLine(empty, [], NOW), /Add your first lead/);
ok('empty organization: no cards, no meetings, zero KPIs, a getting-started greeting');

// ---- Meetings: occurrences, live, horizon ----
const meetings = [
  { id: 'm1', title: 'Demo with Acme', guests: ['ada@acme.test'], roomCode: 'ROOM1', occurrences: [{ startTime: iso(20 * 60_000), endTime: iso(50 * 60_000) }, { startTime: iso(7 * DAY), endTime: iso(7 * DAY + H) }] },
  { id: 'm2', title: 'Standup', roomCode: 'ROOM2', occurrences: [{ startTime: iso(-10 * 60_000), endTime: iso(20 * 60_000) }] },
  { id: 'm3', title: 'Old', occurrences: [{ startTime: iso(-3 * H), endTime: iso(-2 * H) }] },
  { id: 'm4', title: 'Cancelled', status: 'CANCELLED', occurrences: [{ startTime: iso(H), endTime: iso(2 * H) }] },
];
const agenda = upcomingMeetings({ meetings }, NOW);
assert.deepEqual(agenda.map((a) => a.title), ['Standup', 'Demo with Acme', 'Demo with Acme']);
assert.equal(agenda[0].live, true); assert.equal(agenda[0].dayLabel, 'Today'); assert.equal(agenda[1].contact, 'ada@acme.test');
ok('agenda: every occurrence, live meetings flagged, past and cancelled ones left out');

// ---- Attention ----
const input = {
  meetings,
  leads: [
    { id: 'l1', name: 'Hot Hannah', company: 'Acme', status: 'new', score: 90, createdAt: iso(-2 * H) },
    { id: 'l2', name: 'Cold Carl', status: 'new', score: 30, createdAt: iso(-2 * H) },
    { id: 'l3', name: 'Stale Sam', status: 'contacted', score: 50, createdAt: iso(-20 * DAY), updatedAt: iso(-9 * DAY) } as any,
  ],
  deals: [
    { id: 'd1', name: 'Big deal', client: 'Globex', value: 50000, stage: 'proposal', createdAt: iso(-40 * DAY), updatedAt: iso(-20 * DAY) },
    { id: 'd2', name: 'Fresh deal', value: 1000, stage: 'proposal', createdAt: iso(-1 * DAY), updatedAt: iso(-1 * DAY) },
  ],
  tickets: [{ id: 't1', status: 'open', priority: 'critical', subject: 'Down', customerName: 'Initech', createdAt: iso(-H) }],
  proposals: [
    { id: 'p1', number: 'P-0001', title: 'Redesign', client: { company: 'Umbrella' }, status: 'viewed', sentAt: iso(-5 * DAY) },
    { id: 'p2', number: 'P-0002', status: 'sent', sentAt: iso(-1 * DAY) },
    { id: 'p3', number: 'P-0003', status: 'accepted', sentAt: iso(-9 * DAY) },
  ],
  conversations: [
    { id: 'c1', title: 'Website chat', channel: 'widget', status: 'open', lastMessage: { senderType: 'visitor', senderName: 'Vic', content: 'Hello?', createdAt: iso(-3 * H) } },
    { id: 'c2', title: 'Answered', channel: 'widget', status: 'open', lastMessage: { senderType: 'user', content: 'Hi', createdAt: iso(-H) } },
  ],
  service: { missedCalls: { count: 2, windowHours: 24 } },
};
const items = buildAttention(input, NOW);
const ids = items.map((i) => i.id);
for (const want of ['meeting:m1:0', 'meeting:m2:0', 'message:c1', 'calls:missed', 'lead:l1', 'followups:overdue', 'deal:d1', 'proposal:p1', 'ticket:t1']) assert.ok(ids.includes(want), `missing ${want}`);
for (const notWanted of ['message:c2', 'lead:l2', 'deal:d2', 'proposal:p2', 'proposal:p3', 'meeting:m1:1']) assert.ok(!ids.includes(notWanted), `unexpected ${notWanted}`);
assert.equal(items.slice(0, items.filter((i) => i.priority === 'high').length).every((i) => i.priority === 'high'), true);
assert.deepEqual(items.find((i) => i.id === 'meeting:m1:0')!.action, { type: 'join', roomCode: 'ROOM1', label: 'Join' });
assert.deepEqual(items.find((i) => i.id === 'message:c1')!.action, { type: 'reply', conversationId: 'c1', label: 'Reply' });
for (const i of items) { assert.ok(i.name && i.title && i.description && i.nextAction && i.timeLabel, `incomplete card ${i.id}`); }
ok('attention: meetings soon, unanswered messages, missed calls, hot leads, overdue follow-ups, stalled deals, waiting proposals, critical tickets; high priority first');

// ---- KPIs ----
const k = Object.fromEntries(headlineKpis(input as any, NOW).map((x) => [x.id, x]));
assert.equal(k.contacts.value, '3'); assert.equal(k.new_today.value, '2'); assert.equal(k.open_deals.value, '2');
assert.equal(k.pipeline.raw, 51000); assert.equal(k.forecast.raw, 51000 * 0.7);
assert.equal(k.open_deals.change?.text, '+1'); assert.equal(k.contacts.change?.text, '200%');
assert.equal(k.new_today.series.length, 14); assert.equal(k.new_today.series[13], 2);
ok('KPIs: totals, today, open deals, pipeline, weighted forecast and their comparisons match the records');

const g = greetingLine(input as any, items, NOW);
assert.match(g, /high-priority items need you/); assert.match(g, /2 new leads today/); assert.match(g, /Standup/);
ok('greeting summarises real priorities, new leads and the next meeting');

assert.deepEqual(commandCenterInsights(empty, NOW), []);
const ins = Object.fromEntries(commandCenterInsights({ ...input, service: { unansweredCount: 3 } } as any, NOW).map((i) => [i.id, i]));
assert.match(ins.likely_convert.detail, /Hot Hannah \(90\)/); assert.match(ins.revenue_opportunity.title, /\$51,000/);
assert.equal(ins.unanswered_trend, undefined, 'unanswered messages are shown once, in Needs Your Attention'); assert.equal(ins.reconnect, undefined);
assert.ok(Object.values(ins).every((i: any) => i.ask));
ok('insights: likely converters and late-stage revenue (no repeat of Needs Your Attention); each can be handed to the copilot');

console.log(`\n${passed} passed (command center)`);
