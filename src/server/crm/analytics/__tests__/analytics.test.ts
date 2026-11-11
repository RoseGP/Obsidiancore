/**
 * Analytics math on known fixtures: forecast (smoothing, age penalty, buckets, the variance band, sparse data,
 * deals without a value), pipeline health, RFM segments (quintiles vs fixed thresholds, prospects not scored),
 * fuzzy entity matching (nicknames, company suffixes, common surnames, blocking, symmetry) and deal actions.
 * Run: npx tsx src/server/crm/analytics/__tests__/analytics.test.ts
 */
import assert from 'node:assert/strict';
import { stageHistory, completedStays, furthestStageReached } from '../common';
import { buildForecast, buildOrgModel, agePenalty, parseCloseDate, bucketOf, PRIOR_STRENGTH } from '../forecast';
import { buildPipelineHealth } from '../pipelineHealth';
import { buildSegments } from '../segments';
import { buildDealActions } from '../dealActions';
import {
  blockingKeys, candidatePairs, companySimilarity, findMatchingPairs, jaroWinkler, matchAgainst, matchLeadsToContacts, matchScore, nicknameMatch, soundex,
} from '../entityMatch';

let passed = 0; const ok = (n: string) => { passed++; console.log('  ✓', n); };
const near = (a: number, b: number, eps = 1e-3, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} expected ${b}, got ${a}`);

const NOW = Date.parse('2026-11-15T12:00:00Z');
const DAY = 86_400_000;
const iso = (offsetDays: number) => new Date(NOW + offsetDays * DAY).toISOString();

// ---------------------------------------------------------------- stage history
{
  const d = { id: 'x', stage: 'proposal', createdAt: iso(-30), stageHistory: [{ stage: 'discovery', from: null, at: iso(-30) }, { stage: 'qualified', from: 'discovery', at: iso(-20) }, { stage: 'proposal', from: 'qualified', at: iso(-5) }] };
  const h = stageHistory(d);
  assert.equal(h.source, 'recorded'); assert.deepEqual(h.entries.map((e) => e.stage), ['discovery', 'qualified', 'proposal']);
  assert.deepEqual(completedStays(h).map((s) => [s.stage, Math.round(s.days)]), [['discovery', 10], ['qualified', 15]]);
  const fromFeed = stageHistory({ id: 'y', stage: 'negotiation', createdAt: iso(-40) }, [
    { type: 'stage_advanced', targetId: 'y', description: 'Stage moved to PROPOSAL (70% probability).', timestamp: iso(-20) },
    { type: 'stage_advanced', targetId: 'y', description: 'Stage moved to NEGOTIATION (85% probability).', timestamp: iso(-3) },
  ]);
  assert.equal(fromFeed.source, 'activity_log'); assert.deepEqual(fromFeed.entries.map((e) => e.stage), ['proposal', 'negotiation']);
  assert.equal(furthestStageReached({ stage: 'lost', lostFromStage: 'qualified' }, stageHistory({ id: 'z', stage: 'lost', createdAt: iso(-9) })), 2);
  assert.equal(furthestStageReached({ stage: 'lost' }, stageHistory({ id: 'z', stage: 'lost', createdAt: iso(-9) })), null);
  ok('stage history: recorded entries, the activity log fallback, completed stays and the furthest stage reached (unknown stays unknown)');
}

// ---------------------------------------------------------------- forecast fixture
// 6 won deals (cycles 30–80 days, each spent its whole cycle in Proposal) and 4 lost (2 from Discovery, 2 from Proposal).
const won = [30, 40, 50, 60, 70, 80].map((cycle, i) => {
  const closed = [iso(-40), iso(-66), iso(-87), iso(-190), iso(-200), iso(-210)][i];
  const created = new Date(Date.parse(closed) - cycle * DAY).toISOString();
  return { id: `won${i}`, name: `Won ${i}`, stage: 'won', value: [1000, 2000, 3000, 4000, 5000, 6000][i], createdAt: created, updatedAt: closed,
    stageHistory: [{ stage: 'proposal', from: null, at: created }, { stage: 'won', from: 'proposal', at: closed }] };
});
const lost = [0, 1, 2, 3].map((i) => ({ id: `lost${i}`, name: `Lost ${i}`, stage: 'lost', value: 500, createdAt: iso(-300), updatedAt: iso(-250), lostFromStage: i < 2 ? 'discovery' : 'proposal' }));
const open = [
  { id: 'A', name: 'Alpha', stage: 'proposal', value: 10000, expectedClose: '2026-11-25', createdAt: iso(-30), stageEnteredAt: iso(-10), contactId: 'c_ann' },
  { id: 'B', name: 'Beta', stage: 'proposal', value: 20000, expectedClose: '2026-12-10', createdAt: iso(-200), stageEnteredAt: iso(-165) },
  { id: 'C', name: 'Gamma', stage: 'discovery', createdAt: iso(-10), stageEnteredAt: iso(-10) },
  { id: 'D', name: 'Delta', stage: 'lead', value: 5000, expectedClose: 'Next Month', createdAt: iso(-100) },
  { id: 'E', name: 'Epsilon', stage: 'negotiation', value: 8000, expectedClose: '2026-10-01', createdAt: iso(-60), stageEnteredAt: iso(-5) },
];
const deals = [...won, ...lost, ...open];

{
  const m = buildOrgModel(deals);
  assert.equal(m.closedDeals, 10); assert.equal(m.wonDeals, 6); assert.equal(m.unknownLost, 0);
  // lead: all 10 reached it, 6 won → (6 + 5·0.20) / 15
  near(m.stages.lead.probability, (6 + PRIOR_STRENGTH * 0.2) / 15);
  near(m.stages.discovery.probability, (6 + 5 * 0.3) / 15);
  near(m.stages.qualified.probability, (6 + 5 * 0.5) / 13); // 6 won + 2 lost from Proposal
  near(m.stages.proposal.probability, (6 + 5 * 0.7) / 13);
  near(m.stages.negotiation.probability, (6 + 5 * 0.85) / 11); // only won deals passed Negotiation
  assert.equal(m.stages.proposal.basisKind, 'history'); assert.equal(m.stages.negotiation.closedReached, 6);
  assert.equal(m.stages.proposal.typicalSource, 'history'); assert.equal(m.stages.proposal.typicalDays, 55); // median of 30..80
  assert.equal(m.stages.discovery.typicalSource, 'default'); assert.equal(m.stages.discovery.typicalDays, 14);
  assert.deepEqual(m.salesCycle, { days: 55, source: 'history', wonDeals: 6 });
  ok('stage win rates: won ÷ closed that reached the stage, smoothed with a Beta prior (k=5) toward the default; median time in stage and sales cycle');
}

{
  assert.equal(agePenalty(null), 1); assert.equal(agePenalty(1.5), 1); assert.equal(agePenalty(2), 1);
  near(agePenalty(3), 0.85); near(agePenalty(4), 0.7); assert.equal(agePenalty(50), 0.5);
  assert.equal(parseCloseDate('Next Month'), null); assert.equal(parseCloseDate(''), null);
  assert.equal(parseCloseDate('2026-12-10'), Date.parse('2026-12-10T00:00:00Z')); assert.equal(parseCloseDate('2027-01'), Date.parse('2027-01-01T00:00:00Z'));
  ok('age penalty is 1 up to 2× the typical time, −15% per extra multiple, never below 0.5; only real dates count as close dates');
}

const F = buildForecast(deals, [], NOW, { months: 3 });
{
  const by = Object.fromEntries(F.deals.map((d) => [d.id, d]));
  const pProposal = (6 + 3.5) / 13, pNeg = (6 + 4.25) / 11, pLead = 7 / 15;
  near(by.A.probability, pProposal); assert.equal(by.A.age.penalized, false); assert.equal(by.A.expectedClose.month, '2026-11'); assert.equal(by.A.expectedClose.estimated, false);
  assert.match(by.A.basis, /^Your history \(n=8\)/);
  // B: 165 days in Proposal = 3× the typical 55 → × 0.85
  assert.equal(by.B.age.penalized, true); near(by.B.age.multiplier, 0.85, 0.005); near(by.B.probability, pProposal * 0.85);
  assert.match(by.B.age.note, /3× the typical 55 days/);
  // C: no value, no close date → created + 55-day median cycle, estimated
  assert.equal(by.C.valueSet, false); assert.equal(by.C.value, null); assert.equal(by.C.expectedValue, 0);
  assert.equal(by.C.expectedClose.estimated, true); assert.equal(by.C.expectedClose.month, '2026-12'); assert.match(by.C.expectedClose.note, /median sales cycle of 55 days/);
  // D: "Next Month" isn't a date → estimated; the estimate (created + 55 d) passed → this month. 100 days in Lead vs default 14 → floor 0.5.
  assert.equal(by.D.expectedClose.estimated, true); assert.equal(by.D.expectedClose.month, '2026-11'); assert.match(by.D.expectedClose.note, /“Next Month” isn’t a date/);
  near(by.D.probability, pLead * 0.5);
  // E: close date in the past → overdue, counted in this month
  assert.equal(by.E.expectedClose.overdue, true); assert.equal(by.E.expectedClose.month, '2026-11'); near(by.E.probability, pNeg);
  ok('per-deal forecast: probability with its basis, age penalty with the reason, close month from the date or an estimate');

  const nov = F.buckets[0], dec = F.buckets[1], jan = F.buckets[2];
  assert.deepEqual(F.buckets.map((b) => b.month), ['2026-11', '2026-12', '2027-01']);
  assert.equal(nov.deals, 3); assert.equal(nov.commit, 18000); assert.equal(nov.bestCase, 18000); assert.equal(nov.pipeline, 23000);
  // Buckets use the per-deal probabilities as reported (rounded to 0.1%), so the totals can be re-done by hand.
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  const rows: Array<[number, number]> = [[r3(pProposal), 10000], [r3(pLead * 0.5), 5000], [r3(pNeg), 8000]];
  const exp = rows.reduce((s, [p, v]) => s + p * v, 0);
  assert.equal(nov.expected, Math.round(exp));
  const sd = Math.sqrt(rows.reduce((s, [p, v]) => s + p * (1 - p) * v * v, 0));
  assert.equal(nov.low, Math.round(exp - 1.28 * sd)); assert.equal(nov.high, Math.round(exp + 1.28 * sd));
  // December: B (0.621 → best case, not commit) and C (no value)
  assert.equal(dec.deals, 2); assert.equal(dec.noValue, 1); assert.equal(dec.commit, 0); assert.equal(dec.bestCase, 20000); assert.equal(dec.pipeline, 20000);
  assert.equal(jan.deals, 0); assert.equal(jan.expected, 0); assert.equal(jan.low, 0); assert.equal(jan.high, 0);
  assert.equal(F.total.deals, 5); assert.equal(F.total.pipeline, 43000); assert.equal(F.later.deals, 0);
  ok('buckets: commit (p ≥ 0.7), best case (p ≥ 0.4), pipeline, expected Σ p·v and the ±1.28·√Σ p(1−p)v² band');

  const lowFloor = bucketOf([{ value: 100000, probability: 0.1, valueSet: true } as any]);
  assert.equal(lowFloor.low, 0); assert.equal(lowFloor.expected, 10000); assert.ok(lowFloor.high > 10000);
  ok('the range is floored at $0');

  assert.deepEqual(F.history.months.map((m) => m.month), ['2026-08', '2026-09', '2026-10']);
  assert.deepEqual(F.history.months.map((m) => m.won), [3000, 2000, 1000]);
  assert.equal(F.history.total, 6000);
  assert.equal(F.confidence, 'medium'); // 10 closed (< 20)
  assert.deepEqual(F.noValue, [{ id: 'C', name: 'Gamma', stage: 'Discovery' }]);
  assert.ok(F.notes.some((n) => /no value set and counts as \$0/.test(n)));
  assert.ok(F.notes.some((n) => /past its close date/.test(n)));
  ok('history: won revenue in each of the last 3 months; deals with no value are listed and counted as $0');
}

{
  const sparse = buildForecast([won[0], lost[0], { ...open[0] }], [], NOW, { months: 3 });
  assert.equal(sparse.confidence, 'low');
  assert.equal(sparse.deals[0].basisKind, 'default'); assert.equal(sparse.deals[0].probability, 0.7);
  assert.match(sparse.deals[0].basis, /^Default stage rate, not enough history \(n=1; needs 5 closed deals that reached Proposal\)/);
  assert.ok(sparse.notes.some((n) => /Only 2 closed deals/.test(n)));
  assert.ok(sparse.notes.some((n) => /default/.test(n)));
  const none = buildForecast(won, [], NOW, { months: 6 });
  assert.equal(none.confidence, 'low'); assert.equal(none.deals.length, 0); assert.equal(none.buckets.length, 6);
  assert.ok(none.notes[0].includes('no open deals')); assert.equal(none.total.expected, 0);
  const empty = buildForecast([], [], NOW);
  assert.equal(empty.confidence, 'low'); assert.equal(empty.months, 3); assert.equal(empty.history.total, 0);
  // Deal created in a legacy board stage and an unknown lost deal: still counted honestly.
  const legacy = buildForecast([{ id: 'L', stage: 'proposal_sent', value: 100, createdAt: iso(-1) }, { id: 'U', stage: 'lost', createdAt: iso(-50) }], [], NOW);
  assert.equal(legacy.deals[0].stage, 'proposal'); assert.equal(legacy.model.unknownLost, 1);
  ok('sparse data: fewer than 5 closed deals or no open deals → low confidence, default rates and plain notes; nothing invented');
}

// ---------------------------------------------------------------- pipeline health
{
  const leads = [
    { id: 'l1', source: 'referral', status: 'converted', isConverted: true, convertedDealId: 'won0' },
    { id: 'l2', source: 'referral', status: 'new' },
    { id: 'l3', source: 'website', status: 'new' },
    { id: 'l4' },
  ];
  const H = buildPipelineHealth(deals, leads, [], NOW);
  const st = Object.fromEntries(H.stages.map((s) => [s.stage, s]));
  // Discovery: 10 closed deals reached it and 8 went further (6 won + 2 lost from Proposal); open A, B and E are past it
  // (moved on and advanced); C is still in it (not counted yet); D never reached it.
  assert.equal(st.discovery.movedOn, 13); assert.equal(st.discovery.advanced, 11); near(st.discovery.conversion!, 11 / 13);
  assert.equal(st.proposal.open, 2); assert.equal(st.proposal.openValue, 30000);
  assert.equal(st.negotiation.movedOn, 6); assert.equal(st.negotiation.conversion, 1);
  assert.deepEqual(H.stale.map((s) => s.id).sort(), ['B', 'D']);
  const ref = H.sources.find((s) => s.source === 'referral')!;
  assert.equal(ref.leads, 2); assert.equal(ref.converted, 1); assert.equal(ref.conversion, 0.5); assert.equal(ref.wonDeals, 1); assert.equal(ref.wonValue, 1000); assert.equal(ref.smallSample, true);
  assert.equal(H.sources.find((s) => s.source === 'unknown')!.label, 'Not recorded');
  ok('pipeline health: conversion between stages, open value, stale deals (> 2× typical) and lead source conversion with won value');
}

// ---------------------------------------------------------------- segments
{
  const contacts = [
    { id: 'c_ann', name: 'Ann Archer', email: 'ann@archer.test' },
    { id: 'c_ben', name: 'Ben Brook', email: 'ben@brook.test' },
    { id: 'c_cat', name: 'Cat Prospect', email: 'cat@x.test' },
    { id: 'c_old', name: 'Old Ann', email: 'ann.old@archer.test', mergedInto: 'c_ann' },
  ];
  const leads = [{ id: 'lead_ben', email: 'ben@brook.test', convertedDealId: 'd_ben' }];
  const sdeals = [
    { id: 'd_ann1', stage: 'won', value: 4000, contactId: 'c_old', createdAt: iso(-60), closedAt: iso(-10) },     // merged → Ann
    { id: 'd_ben', stage: 'won', value: 1000, createdAt: iso(-400), closedAt: iso(-200) },                       // via the lead
    { id: 'd_glob', stage: 'won', client: 'Globex Corp.', createdAt: iso(-30), closedAt: iso(-20) },               // no value, company only
    { id: 'd_none', stage: 'won', value: 50, createdAt: iso(-30), closedAt: iso(-5) },                              // can't be tied to anyone
    { id: 'd_open', stage: 'proposal', value: 9, contactId: 'c_cat', createdAt: iso(-3) },
  ];
  const items = [{ id: 'i1', description: 'Work', quantity: '1', unitPrice: '1500', taxRate: '' }];
  const invoices = [
    { id: 'inv1', lifecycle: 'sent', currency: 'USD', clientId: 'cl1', billTo: { email: '' }, items, discount: { type: 'fixed', value: '' }, fees: [] },
    { id: 'inv2', lifecycle: 'sent', currency: 'USD', clientId: 'cl1', billTo: { email: '' }, items, discount: { type: 'fixed', value: '' }, fees: [] },  // unpaid
    { id: 'inv3', lifecycle: 'sent', currency: 'EUR', clientId: null, billTo: { email: 'ann@archer.test' }, items, discount: { type: 'fixed', value: '' }, fees: [] },
  ];
  const payments = [
    { id: 'p1', invoiceId: 'inv1', amount: '1500.00', currency: 'USD', status: 'confirmed', date: iso(-3).slice(0, 10) },
    { id: 'p2', invoiceId: 'inv2', amount: '100.00', currency: 'USD', status: 'confirmed', date: iso(-3).slice(0, 10) },
    { id: 'p3', invoiceId: 'inv3', amount: '1500.00', currency: 'EUR', status: 'confirmed', date: iso(-3).slice(0, 10) },
  ];
  const S = buildSegments({ contacts, companies: [], leads, deals: sdeals, feed: [], invoices, payments, billingClients: [{ id: 'cl1', contactId: 'c_ann' }], currency: 'USD' }, NOW);
  assert.equal(S.method, 'fixed'); assert.equal(S.customers, 3); assert.equal(S.prospects, 1);
  const all = S.segments.flatMap((s) => s.members);
  const ann = all.find((m) => m.id === 'c_ann')!;
  assert.equal(ann.frequency, 2); assert.equal(ann.monetary, 5500); assert.equal(ann.recencyDays, 3); assert.equal(ann.r, 5);
  const ben = all.find((m) => m.id === 'c_ben')!;
  assert.equal(ben.frequency, 1); assert.equal(ben.recencyDays, 200); assert.equal(ben.r, 2);
  const glob = all.find((m) => m.type === 'company')!;
  assert.equal(glob.name, 'Globex Corp.'); assert.equal(glob.monetary, 0); assert.match(glob.reason, /without a value/);
  assert.ok(!all.some((m) => m.id === 'c_cat'), 'prospects are not scored');
  assert.equal(S.unmatched.deals, 1);
  assert.ok(S.notes.some((n) => /another currency than USD/.test(n)));
  assert.ok(S.notes.some((n) => /fixed thresholds/.test(n)));
  assert.match(S.thresholds.explanation, /fixed thresholds are used/);
  // Fixed monetary score: median customer total is Ann 5500 / Ben 1000 / Globex 0 → 1000. Ann 5.5× → 5, Ben 1× → 3, Globex 0 → 1.
  assert.equal(ann.m, 5); assert.equal(ben.m, 3); assert.equal(glob.m, 1);
  assert.equal(ann.segment, 'promising'); assert.equal(ben.segment, 'hibernating');
  ok('segments with fixed thresholds: purchases linked through merged contacts, leads, invoicing clients and companies; unpaid, other-currency and unmatched purchases left out; prospects counted, not scored');

  // 25 customers with distinct recency/frequency/value → quintiles, 5 per score.
  const many = Array.from({ length: 25 }, (_, i) => ({ id: `q${i}`, name: `Customer ${i}`, email: `q${i}@x.test` }));
  const qdeals = many.flatMap((c, i) => Array.from({ length: (i % 5) + 1 }, (_, k) => ({ id: `qd${i}_${k}`, stage: 'won', value: 100 * (i + 1), contactId: c.id, createdAt: iso(-i * 10 - 30 - k), closedAt: iso(-i * 10 - k) })));
  const Q = buildSegments({ contacts: many, companies: [], leads: [], deals: qdeals, feed: [], invoices: [], payments: [], billingClients: [], currency: 'USD' }, NOW);
  assert.equal(Q.method, 'quintiles'); assert.equal(Q.customers, 25); assert.equal(Q.prospects, 0);
  assert.deepEqual(Q.thresholds.recency.map((b) => b.customers), [5, 5, 5, 5, 5]);
  const qm = Q.segments.flatMap((s) => s.members);
  assert.equal(qm.find((m) => m.id === 'q0')!.r, 5); assert.equal(qm.find((m) => m.id === 'q24')!.r, 1);
  assert.equal(qm.find((m) => m.id === 'q24')!.m, 5); // highest total
  assert.match(Q.thresholds.explanation, /a fifth of your own customers/);
  assert.equal(Q.segments.reduce((s, g) => s + g.count, 0), 25);
  ok('segments with 20+ customers use quintiles of the organization’s own customers');

  // Engagement as a secondary signal for At risk.
  const quiet = buildSegments({ contacts: [{ id: 'k', name: 'Kim', email: 'kim@x.test' }], companies: [], leads: [], feed: [], invoices: [], payments: [], billingClients: [], currency: 'USD',
    deals: [0, 1, 2].map((k) => ({ id: `k${k}`, stage: 'won', value: 100, contactId: 'k', createdAt: iso(-200), closedAt: iso(-120 - k)})) }, NOW);
  const kim = quiet.segments.flatMap((s) => s.members)[0];
  assert.equal(kim.r, 3); assert.equal(kim.f, 3); assert.equal(kim.segment, 'at_risk'); assert.match(kim.reason, /no recorded activity/);
  const engaged = buildSegments({ contacts: [{ id: 'k', name: 'Kim', email: 'kim@x.test' }], companies: [], leads: [], invoices: [], payments: [], billingClients: [], currency: 'USD',
    feed: [{ targetId: 'k', timestamp: iso(-2) }], deals: [0, 1, 2].map((k) => ({ id: `k${k}`, stage: 'won', value: 100, contactId: 'k', createdAt: iso(-200), closedAt: iso(-120 - k)})) }, NOW);
  assert.equal(engaged.segments.flatMap((s) => s.members)[0].segment, 'loyal');
  const empty = buildSegments({ contacts: [{ id: 'p', name: 'P' }], companies: [], leads: [], deals: [], feed: [], invoices: [], payments: [], billingClients: [], currency: 'USD' }, NOW);
  assert.equal(empty.customers, 0); assert.equal(empty.prospects, 1); assert.ok(empty.notes[0].startsWith('No purchases yet'));
  ok('last activity: a fading customer with no activity for 90+ days is At risk; recent activity keeps them Loyal; no purchases → empty with a note');
}

// ---------------------------------------------------------------- entity matching
{
  assert.equal(soundex('Robert'), 'R163'); assert.equal(soundex('Rupert'), 'R163'); assert.equal(soundex('Ashcraft'), 'A261'); assert.equal(soundex('Tymczak'), 'T522'); assert.equal(soundex('Pfister'), 'P236');
  near(jaroWinkler('martha', 'marhta'), 0.9611); near(jaroWinkler('dixon', 'dicksonx'), 0.8133); assert.equal(jaroWinkler('abc', 'abc'), 1); assert.equal(jaroWinkler('', 'x'), 0);
  assert.ok(nicknameMatch('bob', 'robert') && nicknameMatch('jon', 'jonathan') && nicknameMatch('jonathan', 'john') && !nicknameMatch('john', 'jane'));
  assert.equal(companySimilarity('The Acme Co., Inc.', 'ACME LLC'), 1); assert.equal(companySimilarity('Acme Robotics', 'Acme'), 0.5); assert.equal(companySimilarity('', 'Acme'), null);
  ok('Soundex, Jaro-Winkler, the nickname map and company normalization (Inc/LLC/Co/The removed, token Jaccard)');

  const jon = { id: '1', name: 'Jon Smith', company: 'Acme Inc', phone: '+1 555 123 4567' };
  const jonathan = { id: '2', name: 'Jonathan Smith', company: 'ACME, LLC', phone: '555-123-4567' };
  let m = matchScore(jon, jonathan);
  assert.equal(m.level, 'likely'); assert.ok(m.reasons.includes('Same phone')); assert.ok(m.reasons.some((r) => /Jon\/Jonathan/.test(r))); assert.ok(m.reasons.includes('Same company after normalization'));
  m = matchScore({ id: '1', name: 'Bob Jones', email: 'bob@acme.com' }, { id: '2', name: 'Robert Jones', email: 'robert.jones@acme.com' });
  assert.equal(m.level, 'likely'); assert.ok(m.reasons.some((r) => /Bob\/Robert/.test(r))); assert.ok(m.reasons.includes('Same email domain (acme.com)'));
  m = matchScore({ id: '1', name: 'Jon Smith', company: 'The Acme Co.' }, { id: '2', name: 'Jonathan Smith', company: 'Acme Corporation' });
  assert.equal(m.level, 'likely');
  ok('nickname and company-suffix matches are likely, with explicit reasons');

  const john = { id: '1', name: 'John Smith', company: 'Acme', email: 'john@acme.com' };
  const jane = { id: '2', name: 'Jane Smith', company: 'Acme', email: 'jane@acme.com' };
  assert.equal(matchScore(john, jane).level, 'none'); assert.ok(matchScore(john, jane).reasons.includes('Different first names'));
  assert.equal(matchScore({ id: '1', name: 'John Smith', company: 'Acme' }, { id: '2', name: 'John Smith', company: 'Globex' }).level, 'none');
  assert.equal(matchScore({ id: '1', name: 'Maria Garcia' }, { id: '2', name: 'Maria Garcia' }).level, 'none', 'a name alone is not enough');
  const family = matchScore({ id: '1', name: 'John Smith', phone: '555 010 0100' }, { id: '2', name: 'Jane Smith', phone: '5550100100' });
  assert.equal(family.score, 0.75); assert.match(family.summary, /maybe a shared number/);
  ok('people who only share a common surname (or just a name) are not matched; a shared phone with different first names is only “possible”');

  // (Jon and John Smith at Acme would match: Jon is a short form of John. Mary and Jane only share the surname.)
  const mary = { id: '3', name: 'Mary Smith', company: 'Acme', email: 'mary@acme.com' };
  assert.equal(matchScore(jon, john).level, 'likely');
  const people = [jon, jonathan, mary, jane, { id: '5', name: 'Zed Quux', email: 'zed@quux.test' }, { id: '6', name: 'Ann Lee', email: 'ann@lee.test' }];
  const pairs = candidatePairs(people);
  assert.ok(pairs.some(([a, b]) => a === 0 && b === 1));
  assert.ok(!pairs.some(([a, b]) => a === 4 || b === 4 || a === 5 || b === 5), 'unrelated records share no block');
  assert.ok(pairs.length < (people.length * (people.length - 1)) / 2);
  assert.ok(blockingKeys(jonathan).includes('p:1234567') && blockingKeys(jonathan).includes('c:acme') && blockingKeys(jonathan).includes(`s:${soundex('smith')}`));
  assert.ok(blockingKeys({ id: 'b', name: 'Bob Jones', email: 'bob@acme.com' }).includes('e:acme.com:r'), 'nickname initial joins Robert’s block');
  const found = findMatchingPairs(people);
  assert.equal(found.length, 1); assert.deepEqual([found[0].a, found[0].b], [0, 1]);
  ok('blocking: only records that share a key are compared, so unrelated people are never scored');

  const sample = [jon, jonathan, john, jane, { id: '7', name: 'H. Lee', phone: '555-010-0100' }, { id: '8', name: 'Hana Lee', phone: '+1 (555) 010-0100', email: 'hana@acme.test' }, { id: '9', name: 'Lee Hana', company: 'Acme' }];
  for (const a of sample) for (const b of sample) assert.equal(matchScore(a, b).score, matchScore(b, a).score, `${a.name} / ${b.name}`);
  ok('scores are symmetric');

  const best = matchAgainst({ id: 'new', name: 'Jonny Smith', company: 'acme' }, people);
  assert.ok(best.length >= 1 && ['1', '2'].includes(best[0].record.id));
  const leadMatches = matchLeadsToContacts(
    [{ id: 'lead1', name: 'Robert Jones', email: 'robert.jones@acme.com' }, { id: 'lead2', name: 'Robert Jones', email: 'robert.jones@acme.com', isConverted: true, convertedContactId: 'cB' }, { id: 'lead3', name: 'Nobody', email: 'x@y.test' }],
    [{ id: 'cB', name: 'Bob Jones', email: 'bob@acme.com' }]);
  assert.equal(leadMatches.length, 1); assert.equal(leadMatches[0].lead.id, 'lead1'); assert.equal(leadMatches[0].contact.id, 'cB'); assert.equal(leadMatches[0].level, 'likely');
  ok('a new contact or an open lead is compared with existing contacts (“this lead looks like contact X”); linked leads are skipped');
}

// ---------------------------------------------------------------- deal actions
{
  const live = deals.map((d) => ({ ...d }));
  const tasks = [{ id: 't1', dealId: 'A', status: 'open', completed: false }, { id: 't2', dealId: 'E', status: 'done', completed: true, completedAt: iso(-1) }];
  const proposals = [{ id: 'p', number: 'P-0001', status: 'draft', crmContactId: 'c_ann' }];
  const R = buildDealActions({ forecasts: F.deals, deals: live, tasks, feed: [{ targetId: 'B', timestamp: iso(-40) }], proposals, leads: [] }, NOW);
  const by = Object.fromEntries(R.deals.map((r) => [r.dealId, r]));
  // A: in Proposal with only a draft; has an open task.
  assert.equal(by.A.primary.type, 'proposal_missing'); assert.equal(by.A.primary.label, 'Send the draft proposal'); assert.ok(!by.A.actions.some((a) => a.type === 'no_open_task'));
  // B: stuck in Proposal, no proposal, no task, high value (20,000 ≥ 2 × median 9,000) and quiet for 40 days.
  assert.deepEqual(by.B.actions.map((a) => a.type), ['proposal_missing', 'stuck', 're_engage', 'no_open_task']);
  assert.match(by.B.actions.find((a) => a.type === 're_engage')!.reason, /no activity for 40 days/);
  // E: close date passed → update or mark lost (top urgency); its only task is done.
  assert.equal(by.E.primary.type, 'close_date_passed'); assert.match(by.E.primary.reason, /passed 45 days ago/); assert.ok(by.E.actions.some((a) => a.type === 'no_open_task'));
  // C: no value → expected value 0 → last, and says so.
  assert.equal(R.deals[R.deals.length - 1].dealId, 'C'); assert.match(by.C.primary.reason, /No value set/);
  for (const r of R.deals) near(r.priority, r.expectedValue * r.urgency, 0.02);
  for (let i = 1; i < R.deals.length; i++) assert.ok(R.deals[i - 1].priority >= R.deals[i].priority);
  assert.equal(R.typicalValue, 9000);
  const none = buildDealActions({ forecasts: [], deals: [], tasks: [], feed: [], proposals: [], leads: [] }, NOW);
  assert.deepEqual(none.deals, []); assert.equal(none.notes[0], 'No open deals: nothing to act on.');
  ok('deal actions: each rule with its reason; priority = expected value × urgency; deals without a value rank last');
}

console.log(`\n${passed} passed (analytics)`);
