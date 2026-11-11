/**
 * Lead Intelligence: explainable Hot/Warm/Cold scoring from real signals, predictions, next best action,
 * auto-classification of new leads, one-click conversion, AI brief honesty, tenant isolation.
 * Run: npx tsx src/server/crm/__tests__/leadIntelligence.test.ts
 */
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';

let passed = 0; const ok = (n: string) => { passed++; console.log('  ✓', n); };
Object.assign(process.env, { NODE_ENV: 'test', SOCIAL_ACCOUNTS_DEV_AUTH: 'true', CRM_STORE: 'memory' });
delete process.env.GEMINI_API_KEY; delete process.env.ANTHROPIC_API_KEY;

const { MemoryDocStore, setDocStore } = await import('../../data/docStore');
const store = new MemoryDocStore(); setDocStore(store);
const { analyzeLead } = await import('../leadIntelligence');
const { guard, PUBLIC } = await import('../../routeGuards');
const leadsRouter = (await import('../../../routes/leadsApi')).default;
const intel = (await import('../../../routes/leadIntelligenceApi')).default;

const NOW = new Date('2026-06-15T15:00:00').getTime();
const H = 3_600_000, DAY = 86_400_000;
const iso = (ms: number) => new Date(NOW + ms).toISOString();
const none = { messages: [], activities: [], tasks: [], proposals: [], meetings: [], deals: [] };
const ctx = { typicalDealValue: 5000, calibration: { hot: null, warm: null, cold: null, closedDeals: 0 } };

// ---- Pure scoring ----
const cold = analyzeLead({ id: 'c', name: 'Cal Cold', email: 'cal@gmail.com', status: 'new', createdAt: iso(-20 * DAY), qualification: {} }, none, ctx, NOW);
assert.equal(cold.classification, 'cold'); assert.ok(cold.score < 40);
assert.match(cold.explanation, /^Cold lead/); assert.equal(cold.qualified, false);
assert.equal(cold.prediction.followUp.when, 'In 2 weeks');
assert.equal(cold.prediction.potentialValue, 5000); assert.match(cold.prediction.valueBasis, /typical deal size/);
assert.ok(cold.factors.find((f) => f.id === 'budget')!.evidence.includes('No budget information yet'));
assert.equal(cold.factors.reduce((s, f) => s + f.weight, 0), 100);
ok('a lead with no signals is Cold, says what is missing, and is nurtured, not chased');

const hotLead = {
  id: 'h', name: 'Hana Hot', email: 'hana@acme.test', phone: '+1 555 0100', company: 'Acme', title: 'Operations Director', source: 'referral',
  status: 'qualified', createdAt: iso(-3 * H), notes: 'Wants a quote for three locations.',
  qualification: { budget: 15000, authority: 'decision_maker', need: 'Online booking, intake forms and SMS reminders for three clinics, integrated with their calendar.', timeline: 'This month' },
};
const hotSignals = {
  ...none,
  messages: [
    { at: iso(-2 * H), fromCustomer: false, text: 'Thanks for your interest, when can we talk?', channel: 'WHATSAPP' },
    { at: iso(-90 * 60_000), fromCustomer: true, text: 'Can you send pricing? We are ready to get started.', channel: 'WHATSAPP' },
  ],
  meetings: [{ title: 'Discovery call', start: iso(DAY) }],
};
const hot = analyzeLead(hotLead, hotSignals, ctx, NOW);
assert.equal(hot.classification, 'hot'); assert.ok(hot.score >= 65, `score ${hot.score}`);
assert.match(hot.explanation, /^Hot lead/);
assert.equal(hot.prediction.potentialValue, 15000); assert.equal(hot.prediction.valueBasis, 'Budget the lead stated');
assert.equal(hot.prediction.followUp.when, 'Now'); assert.match(hot.prediction.followUp.reason, /waiting for a reply/);
assert.equal(hot.nextBestAction!.type, 'reply'); // a waiting customer beats the meeting tomorrow assert.equal(hot.nextBestAction!.label, 'Reply on WhatsApp'); assert.equal(hot.nextBestAction!.view, 'voice_messages');
assert.ok(hot.factors.find((f) => f.id === 'intent')!.evidence.some((e) => /pricing|ready to|quote/.test(e)));
assert.ok(hot.prediction.approach.some((a) => /referral/i.test(a)));
assert.ok(hot.prediction.closingProbability > cold.prediction.closingProbability);
assert.match(hot.prediction.probabilityBasis, /Estimated from the score/);
ok('budget + intent + decision maker + recent WhatsApp = Hot, follow up now, next action: reply on WhatsApp');

const answered = { ...hotSignals, messages: [...hotSignals.messages, { at: iso(-60 * 60_000), fromCustomer: false, text: 'Sure, sending it now.', channel: 'WHATSAPP' }] };
const prep = analyzeLead(hotLead, answered, ctx, NOW);
assert.equal(prep.nextBestAction!.type, 'schedule'); assert.match(prep.nextBestAction!.label, /Prepare for “Discovery call”/);
const replied = analyzeLead(hotLead, { ...answered, meetings: [] }, ctx, NOW);
assert.equal(replied.nextBestAction!.type, 'convert'); assert.match(replied.nextBestAction!.detail, /\$15,000/);
ok('once answered: prepare for the upcoming call; with no call booked, a qualified hot lead with budget gets “Convert to opportunity”');

const newStrong = analyzeLead({ ...hotLead, status: 'new', createdAt: iso(-10 * 60_000) }, { ...none, meetings: [{ title: 'Discovery call', start: iso(DAY) }] }, ctx, NOW);
assert.equal(newStrong.classification, 'hot', `brand-new strong lead scored ${newStrong.score}`);
ok('a brand-new lead with budget, authority, urgent need, intent and a booked call is Hot without needing history');

const viewed = analyzeLead({ ...hotLead, status: 'contacted' }, { ...none, proposals: [{ number: 'P-0003', status: 'viewed', viewedAt: iso(-DAY) }] }, ctx, NOW);
assert.equal(viewed.nextBestAction!.type, 'proposal'); assert.match(viewed.nextBestAction!.label, /P-0003/);
ok('an opened, unsigned proposal makes the next action a proposal follow-up');

const negative = analyzeLead({ ...hotLead, notes: 'Not interested right now, we already use another vendor.' }, none, ctx, NOW);
assert.ok(negative.score < hot.score);
assert.ok(negative.prediction.objections.some((o) => /alternatives/.test(o)));
assert.ok(negative.prediction.objections.some((o) => /not interested/.test(o)));
const unq = analyzeLead({ ...hotLead, status: 'unqualified' }, hotSignals, ctx, NOW);
assert.ok(unq.score <= 25); assert.equal(unq.nextBestAction, null); assert.equal(unq.qualified, false);
ok('negative words and competitor mentions lower the score and appear as objections; unqualified leads are capped');

const calibrated = analyzeLead(hotLead, hotSignals, { ...ctx, calibration: { hot: 0.6, warm: 0.3, cold: 0.05, closedDeals: 14 } }, NOW);
assert.equal(calibrated.prediction.closingProbability, 60); assert.match(calibrated.prediction.probabilityBasis, /14 closed deals/);
ok('closing probability follows the organization’s own win rate once there is history');

// ---- API ----
const app = express(); app.use(express.json());
app.use('/api/leads', guard(PUBLIC.leads), leadsRouter);
app.use('/api/lead-intelligence', guard(PUBLIC.none), intel);
const as = (uid: string) => ({
  get: (p: string) => request(app).get(p).set('X-Dev-User-Id', uid),
  post: (p: string, b: any = {}) => request(app).post(p).set('X-Dev-User-Id', uid).send(b),
});
assert.equal((await request(app).get('/api/lead-intelligence')).status, 401);
ok('signed-out callers are refused');

let r = await as('olivia').post('/api/leads', { name: 'Hana Hot', email: 'hana@acme.test', company: 'Acme', title: 'Director', source: 'referral', phone: '+15550100',
  notes: 'Asked for a quote, ready to get started.', qualification: { budget: 20000, authority: 'decision_maker', need: 'Booking portal for three clinics with SMS reminders and intake forms.', timeline: 'This month' } });
assert.equal(r.status, 201); assert.ok(['hot', 'warm'].includes(r.body.lead.aiClass)); assert.ok(r.body.intelligence.explanation);
const hotId = r.body.lead.id;
r = await as('olivia').post('/api/leads', { name: 'Cal Cold', email: 'cal@gmail.com' });
const coldId = r.body.lead.id; assert.equal(r.body.lead.aiClass, 'cold');
const acts = await as('olivia').get(`/api/leads/${hotId}`);
assert.ok(JSON.stringify(acts.body).includes('Lead intelligence:'));
ok('new leads are classified the moment they are created, with the reason logged on the lead');

r = await as('olivia').get('/api/lead-intelligence');
assert.equal(r.status, 200); assert.equal(r.body.leads.length, 2); assert.equal(r.body.leads[0].leadId, hotId);
assert.equal(r.body.summary.total, 2); assert.equal(r.body.summary.cold, 1);
assert.equal(r.body.leads[1].qualified, false);
for (const k of ['closingProbability', 'potentialValue', 'followUp', 'approach', 'objections']) assert.ok(k in r.body.leads[0].prediction, k);
ok('list: scored, sorted, summarized; every lead has predictions');

assert.equal((await as('bea').get('/api/lead-intelligence')).body.leads.length, 0);
assert.equal((await as('bea').get(`/api/lead-intelligence/${hotId}`)).status, 404);
assert.equal((await as('bea').post(`/api/lead-intelligence/${hotId}/ai-brief`)).status, 503);
assert.equal((await as('bea').post(`/api/leads/${hotId}/convert`, { dealValue: 1 })).status, 404);
ok('another organization sees nothing and can’t convert');

r = await as('olivia').post(`/api/lead-intelligence/${hotId}/ai-brief`, { provider: 'claude' });
assert.equal(r.status, 503); assert.equal(r.body.code, 'ai_not_configured');
ok('the AI brief says plainly when no AI provider is configured');

const one = (await as('olivia').get(`/api/lead-intelligence/${hotId}`)).body.analysis;
r = await as('olivia').post(`/api/leads/${hotId}/convert`, { dealValue: one.prediction.potentialValue, dealStage: 'qualified', dealTitle: 'Acme booking portal' });
assert.equal(r.status, 200); assert.equal(r.body.conversion.deal.value, 20000);
r = await as('olivia').get('/api/lead-intelligence');
assert.equal(r.body.leads.length, 1); assert.equal(r.body.leads[0].leadId, coldId);
r = await as('olivia').get('/api/lead-intelligence?includeConverted=true');
const conv = r.body.leads.find((l: any) => l.leadId === hotId);
assert.equal(conv.converted, true); assert.equal(conv.nextBestAction, null); assert.equal(conv.prediction.potentialValue, 20000);
ok('one-click conversion creates a deal at the predicted value; converted leads leave the open list');

console.log(`\n${passed} passed (lead intelligence)`);
process.exit(0);
