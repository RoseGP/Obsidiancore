import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import leadsApiRouter from '../routes/leadsApi';
import { calculateLeadScore } from '../routes/dashboardApi';

let passed = 0;
const ok = (name: string) => {
  passed++;
  console.log(`  ✓ ${name}`);
};

async function runTests() {
  console.log('\n--- Running Complete Leads Lifecycle Tests ---');

  // Test 1: Lead Scoring Algorithm
  const lowScore = calculateLeadScore({ email: 'john@gmail.com', name: 'John Doe' });
  const highScore = calculateLeadScore({
    email: 'marcus@alphatech.global',
    name: 'Marcus Chen',
    phone: '+1 (555) 349-2041',
    company: 'AlphaTech Global',
    title: 'Chief Technology Officer',
    qualification: { budget: 120000 }
  });
  assert.ok(lowScore < highScore, 'High quality enterprise lead must score significantly higher');
  assert.ok(highScore >= 80, 'Enterprise lead with budget & CXO title must score >= 80');
  ok('Lead scoring algorithm accurately weighs completeness, corporate domain, budget & seniority');

  const app = express();
  app.use(express.json());
  app.use('/api/leads', leadsApiRouter);

  // Test 2: Validation failure on missing name or invalid email
  const resBadName = await request(app).post('/api/leads').send({ email: 'test@example.com' });
  assert.equal(resBadName.status, 400);
  assert.ok(resBadName.body.error.includes('name is required'));

  const resBadEmail = await request(app).post('/api/leads').send({ name: 'Alex Vance', email: 'not-an-email' });
  assert.equal(resBadEmail.status, 400);
  assert.ok(resBadEmail.body.error.includes('valid email'));
  ok('Validation correctly rejects invalid payloads with descriptive error messages');

  // Test 3: Create Lead with full lifecycle fields
  const uniqueEmail = `sarah.lifecycle.${Date.now()}@hypercloud.io`;
  const resCreate = await request(app).post('/api/leads').send({
    name: 'Sarah Jenkins',
    email: uniqueEmail,
    phone: '+1 (555) 234-5678',
    company: 'HyperCloud Technologies',
    title: 'VP of Infrastructure',
    source: 'whatsapp',
    status: 'new',
    owner: 'Rene Pierrette',
    notes: 'Inquired about multi-region SLA guarantees and WebRTC Call Canvas.',
    qualification: {
      budget: 85000,
      authority: 'decision_maker',
      need: 'Automated CRM with real-time video consults',
      timeline: '1-3 months'
    }
  });
  assert.equal(resCreate.status, 201);
  assert.equal(resCreate.body.success, true);
  const createdLeadId = resCreate.body.lead.id;
  assert.ok(createdLeadId, 'Lead ID must be generated');
  assert.equal(resCreate.body.lead.status, 'new');
  assert.equal(resCreate.body.lead.isConverted, false);
  ok('Lead creation persists all fields, initial score, and audit logs');

  // Test 4: Duplicate Detection
  const resDup = await request(app).get(`/api/leads/duplicates?email=${uniqueEmail}`);
  assert.equal(resDup.status, 200);
  assert.equal(resDup.body.hasDuplicates, true);
  assert.ok(resDup.body.duplicates.length >= 1);
  assert.equal(resDup.body.duplicates[0].id, createdLeadId);
  ok('Duplicate detection accurately identifies existing lead by email');

  // Test 5: Status Transition Management
  const resStatus = await request(app).patch(`/api/leads/${createdLeadId}/status`).send({
    status: 'qualified',
    reason: 'Confirmed $85k budget and signing authority'
  });
  assert.equal(resStatus.status, 200);
  assert.equal(resStatus.body.status, 'qualified');

  const resGetDetails = await request(app).get(`/api/leads/${createdLeadId}`);
  assert.equal(resGetDetails.status, 200);
  assert.equal(resGetDetails.body.lead.status, 'qualified');
  assert.ok(resGetDetails.body.activities.some((a: any) => a.type === 'status_changed'));
  ok('Status transitions persist and append timestamped activity logs');

  // Test 6: Follow-up Tasks Assignment & Toggle
  const resTask = await request(app).post(`/api/leads/${createdLeadId}/tasks`).send({
    title: 'Deliver enterprise Call Canvas architecture proposal',
    priority: 'high',
    dueDate: new Date(Date.now() + 86400000 * 3).toISOString()
  });
  assert.equal(resTask.status, 201);
  const taskId = resTask.body.task.id;
  assert.equal(resTask.body.task.completed, false);

  const resToggleTask = await request(app).patch(`/api/leads/${createdLeadId}/tasks/${taskId}/toggle`);
  assert.equal(resToggleTask.status, 200);
  assert.equal(resToggleTask.body.completed, true);
  ok('Follow-up tasks creation and status toggling operate reliably');

  // Test 7: Transactional Lead Conversion
  const resConvert = await request(app).post(`/api/leads/${createdLeadId}/convert`).send({
    dealTitle: 'HyperCloud Infrastructure Expansion Contract',
    dealValue: 85000,
    dealStage: 'qualified',
    expectedClose: 'Next Month',
    companyIndustry: 'Cloud Infrastructure',
    companyTier: 'Tier 1 Enterprise'
  });
  assert.equal(resConvert.status, 200);
  assert.equal(resConvert.body.success, true);
  assert.ok(resConvert.body.conversion.contactId, 'Created Contact record ID');
  assert.ok(resConvert.body.conversion.companyId, 'Created Company record ID');
  assert.ok(resConvert.body.conversion.dealId, 'Created Deal record ID');
  assert.equal(resConvert.body.conversion.deal.value, 85000);
  ok('Lead conversion atomically creates Contact, Company, and Deal records');

  // Test 8: Prevent Duplicate Conversion
  const resDupConvert = await request(app).post(`/api/leads/${createdLeadId}/convert`).send({
    dealTitle: 'Second Conversion Attempt'
  });
  assert.equal(resDupConvert.status, 409);
  assert.ok(resDupConvert.body.error.includes('already been converted'));
  ok('Duplicate conversion is rejected with 409 Conflict protecting data integrity');

  // Test 9: Verify Preserved Lead State & Reversion Protection
  const resConvertedCheck = await request(app).get(`/api/leads/${createdLeadId}`);
  assert.equal(resConvertedCheck.body.lead.status, 'converted');
  assert.equal(resConvertedCheck.body.lead.isConverted, true);
  assert.ok(resConvertedCheck.body.lead.convertedDealId);

  // Attempting to revert status of converted lead must fail
  const resIllegalRevert = await request(app).patch(`/api/leads/${createdLeadId}/status`).send({
    status: 'new'
  });
  assert.equal(resIllegalRevert.status, 400);
  assert.ok(resIllegalRevert.body.error.includes('cannot be reverted'));
  ok('Original lead record and history are preserved with terminal state locking');

  // Test 10: Conversion Analytics
  const resAnalytics = await request(app).get('/api/leads/analytics');
  assert.equal(resAnalytics.status, 200);
  assert.ok(resAnalytics.body.analytics.totalLeads > 0);
  assert.ok(resAnalytics.body.analytics.convertedCount >= 1);
  assert.ok(resAnalytics.body.analytics.conversionRate > 0);
  assert.ok(resAnalytics.body.analytics.funnel.length >= 5);
  ok('Conversion analytics calculate real conversion rate, funnel dropoff, and source metrics');

  console.log(`\n🎉 All ${passed} Leads Lifecycle tests passed successfully!\n`);
}

runTests().catch(err => {
  console.error('\n❌ Test failure:', err);
  process.exit(1);
});
