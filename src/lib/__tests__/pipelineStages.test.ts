/**
 * One pipeline vocabulary: every lead status / deal stage has exactly one board column, drops map back to
 * a valid status/stage, lost deals land in Lost (not Proposal sent), and the routes the board calls exist.
 * Run: npx tsx src/lib/__tests__/pipelineStages.test.ts
 */
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import {
  BOARD_COLUMNS, DEAL_STAGES, DEAL_STAGE_PROBABILITY, LEAD_STATUSES, columnForDealStage, columnForLeadStatus,
  dealStageForColumn, isBoardColumn, leadStatusForColumn,
} from '../pipelineStages';

let passed = 0; const ok = (n: string) => { passed++; console.log('  ✓', n); };

for (const s of LEAD_STATUSES) assert.ok(isBoardColumn(columnForLeadStatus(s)));
for (const s of DEAL_STAGES) assert.ok(isBoardColumn(columnForDealStage(s)));
ok('every lead status and deal stage maps to a board column');

assert.equal(columnForDealStage('lost'), 'closed_lost');
assert.equal(columnForDealStage('won'), 'closed_won');
assert.equal(columnForDealStage('proposal'), 'proposal_sent');
assert.equal(columnForLeadStatus('unqualified'), 'unqualified');
assert.equal(columnForDealStage('something_else'), 'new_leads');
assert.equal(columnForDealStage(undefined), 'new_leads');
ok('lost deals go to Lost, unqualified leads to Unqualified, unknown stages never jump ahead');

for (const c of BOARD_COLUMNS) {
  assert.ok((DEAL_STAGES as readonly string[]).includes(dealStageForColumn(c)));
  const ls = leadStatusForColumn(c);
  if (ls !== null) assert.ok((LEAD_STATUSES as readonly string[]).includes(ls) && ls !== 'converted');
}
for (const s of DEAL_STAGES) if (s !== 'discovery' && s !== 'lead') assert.equal(dealStageForColumn(columnForDealStage(s)), s);
assert.equal(leadStatusForColumn('proposal_sent'), null);
assert.equal(leadStatusForColumn('closed_won'), null);
for (const s of DEAL_STAGES) assert.equal(typeof DEAL_STAGE_PROBABILITY[s], 'number');
ok('dropping on a column gives a valid stage/status (leads need a deal for proposal, negotiation, won)');

// ---- The routes the board calls ----
Object.assign(process.env, { NODE_ENV: 'test', SOCIAL_ACCOUNTS_DEV_AUTH: 'true', CRM_STORE: 'memory' });
const { MemoryDocStore, setDocStore } = await import('../../server/data/docStore');
setDocStore(new MemoryDocStore());
const { guard, PUBLIC } = await import('../../server/routeGuards');
const leadsApi = (await import('../../routes/leadsApi')).default;
const dashboardApi = (await import('../../routes/dashboardApi')).default;
const app = express(); app.use(express.json());
app.use('/api/leads', guard(PUBLIC.leads), leadsApi);
app.use('/api/dashboard', guard(PUBLIC.none), dashboardApi);
const as = (uid: string) => ({
  get: (p: string) => request(app).get(p).set('X-Dev-User-Id', uid),
  post: (p: string, b: any = {}) => request(app).post(p).set('X-Dev-User-Id', uid).send(b),
  patch: (p: string, b: any = {}) => request(app).patch(p).set('X-Dev-User-Id', uid).send(b),
  put: (p: string, b: any = {}) => request(app).put(p).set('X-Dev-User-Id', uid).send(b),
});

let r = await as('olivia').post('/api/leads', { name: 'Avery Lee', email: 'avery@example.com', company: 'Northwind' });
assert.equal(r.status, 201); const leadId = r.body.lead.id;
r = await as('olivia').patch(`/api/leads/${leadId}/status`, { status: leadStatusForColumn('unqualified') });
assert.equal(r.status, 200); assert.equal(r.body.status, 'unqualified');
assert.equal((await as('olivia').patch(`/api/leads/${leadId}/status`, { status: 'qualified' })).status, 200);
assert.equal((await as('bea').patch(`/api/leads/${leadId}/status`, { status: 'contacted' })).status, 404);
ok('board drag on a lead uses PATCH /api/leads/:id/status (another organization gets 404)');

r = await as('olivia').post(`/api/leads/${leadId}/convert`, { dealValue: 4200, dealStage: 'proposal', dealTitle: 'Northwind website' });
assert.equal(r.status, 200);
const dealId = r.body.conversion.deal.id;
const lead = (await as('olivia').get('/api/leads')).body.leads.find((l: any) => l.id === leadId);
assert.equal(lead.convertedDealId, dealId);
const deal = (await as('olivia').get('/api/dashboard/deals')).body.deals.find((d: any) => d.id === dealId);
assert.ok(deal); assert.equal(columnForDealStage(deal.stage), 'proposal_sent'); assert.equal(deal.value, 4200);
ok('a converted lead has convertedDealId pointing at its deal, so the board shows one card in the deal’s column');

r = await as('olivia').patch(`/api/dashboard/deals/${dealId}/stage`, { stage: dealStageForColumn('closed_lost') });
assert.equal(r.status, 200);
const lost = (await as('olivia').get('/api/dashboard/deals')).body.deals.find((d: any) => d.id === dealId);
assert.equal(lost.stage, 'lost'); assert.equal(lost.probability, 0); assert.equal(columnForDealStage(lost.stage), 'closed_lost');
assert.equal((await as('bea').patch(`/api/dashboard/deals/${dealId}/stage`, { stage: 'won' })).status, 404);
ok('dragging a deal to Lost stores stage "lost" (0%) and it stays in Lost; another organization gets 404');

console.log(`\npipeline stages: ${passed} checks passed`);
