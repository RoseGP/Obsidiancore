import { executeCrmTool, CRM_TOOL_DECLARATIONS } from '../services/crmAiAssistant';
import express from 'express';
import request from 'supertest';
import leadsRouter from '../routes/leadsApi';

async function runTests() {
  console.log('🧪 Starting AI Assistant & Automated Lead Capture Test Suite...\n');

  const app = express();
  app.use(express.json());
  app.use('/api/leads', leadsRouter);

  const context = {
    userId: 'exec-director-45',
    orgId: 'org_obsidian_enterprise',
    role: 'ADMIN',
    name: 'Executive Director'
  };

  // 1. Tool Declaration Verification
  console.log('1. Checking Tool Declarations...');
  if (CRM_TOOL_DECLARATIONS.length < 9) {
    throw new Error(`Expected at least 9 CRM tool declarations, found ${CRM_TOOL_DECLARATIONS.length}`);
  }
  const toolNames = CRM_TOOL_DECLARATIONS.map(t => t.name);
  console.log(`✓ Tools registered: ${toolNames.join(', ')}`);

  // 2. Test Tool Execution: get_pipeline_summary
  console.log('\n2. Testing executeCrmTool("get_pipeline_summary")...');
  const summaryResult = await executeCrmTool('get_pipeline_summary', { includeDeals: true }, context);
  if (summaryResult.totalPipelineArr === undefined) {
    throw new Error('Pipeline summary missing totalPipelineArr');
  }
  console.log(`✓ Pipeline summary retrieved: $${summaryResult.totalPipelineArr.toLocaleString()} ARR, ${summaryResult.activeDealsCount} deals.`);

  // 3. Test Tool Execution: search_leads
  console.log('\n3. Testing executeCrmTool("search_leads")...');
  const searchResult = await executeCrmTool('search_leads', { minScore: 50 }, context);
  if (!Array.isArray(searchResult.leads)) {
    throw new Error('Search leads result leads is not an array');
  }
  console.log(`✓ Search leads retrieved ${searchResult.leads.length} qualified leads.`);

  // 4. Test Tool Execution: create_lead via AI tool
  console.log('\n4. Testing executeCrmTool("create_lead")...');
  const newLeadToolResult = await executeCrmTool('create_lead', {
    name: 'Test Prospect via AI',
    email: `ai.prospect.${Date.now()}@enterprise-test.io`,
    company: 'Enterprise Test IO',
    phone: '+1 (555) 777-8899',
    channel: 'website',
    budget: 65000,
    need: 'Testing AI automated lead creation tool',
    timeline: 'immediate'
  }, context);
  if (!newLeadToolResult.success || !newLeadToolResult.leadId) {
    throw new Error('Failed to create lead via AI tool');
  }
  console.log(`✓ Lead created via AI tool: ID ${newLeadToolResult.leadId}, Score: ${newLeadToolResult.score}/100.`);

  // 5. Test Tool Execution: create_deal via AI tool
  console.log('\n5. Testing executeCrmTool("create_deal")...');
  const newDealToolResult = await executeCrmTool('create_deal', {
    name: 'Enterprise Test IO OmniRoute Core',
    client: 'Enterprise Test IO',
    value: 65000,
    stage: 'proposal',
    expectedClose: 'Next Month'
  }, context);
  if (!newDealToolResult.success || !newDealToolResult.dealId) {
    throw new Error('Failed to create deal via AI tool');
  }
  console.log(`✓ Deal registered via AI tool: ID ${newDealToolResult.dealId}, Value: $${newDealToolResult.value.toLocaleString()}.`);

  // 6. Test Tool Execution: create_followup_task via AI tool
  console.log('\n6. Testing executeCrmTool("create_followup_task")...');
  const taskResult = await executeCrmTool('create_followup_task', {
    title: 'Review custom SLA with Enterprise Test IO',
    dueDate: 'Tomorrow 2:00 PM',
    priority: 'urgent',
    leadId: newLeadToolResult.leadId
  }, context);
  if (!taskResult.success || !taskResult.taskId) {
    throw new Error('Failed to create follow-up task via AI tool');
  }
  console.log(`✓ Task created via AI tool: "${taskResult.title}" (Due: ${taskResult.dueDate}).`);

  // 7. Test Tool Execution: create_social_draft via AI tool
  console.log('\n7. Testing executeCrmTool("create_social_draft")...');
  const socialDraftResult = await executeCrmTool('create_social_draft', {
    caption: '🚀 Exciting news: Obsidian CRM now features autonomous multi-channel AI intelligence and real-time WebRTC Call Canvas consultations!',
    platforms: ['LINKEDIN', 'INSTAGRAM']
  }, context);
  if (!socialDraftResult.success || !socialDraftResult.postId) {
    throw new Error('Failed to create social draft via AI tool');
  }
  console.log(`✓ Social post draft created via AI tool: ID ${socialDraftResult.postId}.`);

  // 8. Test Automated Website Lead Capture API: POST /api/leads/capture
  console.log('\n8. Testing Automated Website Lead Capture API (POST /api/leads/capture)...');
  const captureEmail = `web.inquiry.${Date.now()}@cloudtech-corp.com`;
  const captureRes = await request(app)
    .post('/api/leads/capture')
    .send({
      name: 'Jennifer Blake',
      email: captureEmail,
      phone: '+1 (555) 432-8811',
      company: 'CloudTech Corp',
      message: 'Looking for 200-seat WebRTC Call Canvas and WhatsApp integration with ISO compliance.',
      budget: 80000,
      timeline: '1-3 months',
      sourceUrl: 'https://obsidian.crm/enterprise-pricing',
      utmSource: 'google_search',
      utmCampaign: 'enterprise_q3'
    });

  if (captureRes.status !== 201 || !captureRes.body.success || !captureRes.body.leadId) {
    throw new Error(`Lead capture failed with status ${captureRes.status}: ${JSON.stringify(captureRes.body)}`);
  }
  console.log(`✓ Web lead captured: ID ${captureRes.body.leadId}, Score: ${captureRes.body.lead.score}/100.`);

  // 9. Test Deduplication on Website Lead Capture (Re-engagement merge)
  console.log('\n9. Testing Website Lead Capture Deduplication & Merge...');
  const duplicateCaptureRes = await request(app)
    .post('/api/leads/capture')
    .send({
      name: 'Jennifer Blake',
      email: captureEmail,
      company: 'CloudTech Corp',
      message: 'Following up to schedule consultation with VP of Infrastructure.',
      sourceUrl: 'https://obsidian.crm/contact'
    });

  if (duplicateCaptureRes.status !== 200 || !duplicateCaptureRes.body.isExisting) {
    throw new Error(`Duplicate capture did not merge as expected: ${JSON.stringify(duplicateCaptureRes.body)}`);
  }
  console.log(`✓ Re-engagement detected: Merged into existing lead ${duplicateCaptureRes.body.leadId} without creating duplicate.`);

  // 10. Test Honeypot Anti-Spam Trap
  console.log('\n10. Testing Honeypot Spam Trap...');
  const spamRes = await request(app)
    .post('/api/leads/capture')
    .send({
      name: 'Spam Bot',
      email: 'spammer@botnet.xyz',
      _hp_website_title: 'I am a bot filling hidden fields'
    });

  if (spamRes.status !== 200 || !spamRes.body.success) {
    throw new Error('Honeypot trap did not intercept bot');
  }
  console.log('✓ Honeypot spam trap intercepted submission successfully.');

  console.log('\n🎉 ALL 10 AI ASSISTANT & AUTOMATED LEAD CAPTURE TESTS PASSED PERFECTLY!\n');
}

runTests().catch(err => {
  console.error('\n❌ Test failure:', err);
  process.exit(1);
});
