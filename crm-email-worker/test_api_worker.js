/**
 * Integration Test for emailApiWorker.ts
 */

import worker from './src/emailApiWorker.ts';

async function runApiWorkerTests() {
  console.log('--- Starting emailApiWorker.ts Integration Tests ---');

  const mockDbState = {
    emails: new Map(),
    attachments: new Map(),
    threads: new Map()
  };

  const mockR2Storage = new Map();

  // Populate mock data
  mockDbState.threads.set('thd_001', {
    id: 'thd_001',
    status: 'open',
    contact_id: 'cnt_001'
  });

  mockDbState.emails.set('eml_101', {
    id: 'eml_101',
    thread_id: 'thd_001',
    direction: 'inbound',
    sender: 'alex@enterprise.corp',
    recipient: 'support@crm.obsidian.edge',
    subject: 'Enterprise SLA Agreement',
    body_text: 'Please find attached the signed SLA agreement.',
    body_html: '<p>Please find attached the signed SLA agreement.</p>',
    message_id: '<msg-101@enterprise.corp>',
    in_reply_to: null,
    r2_key: 'raw_emails/2026/08/eml_101.eml',
    ai_summary: 'Sender submitted signed SLA agreement document.',
    classification: 'Important',
    created_at: '2026-08-15T12:00:00.000Z'
  });

  mockDbState.emails.set('eml_102', {
    id: 'eml_102',
    thread_id: 'thd_001',
    direction: 'inbound',
    sender: 'spammer@quick-cash.biz',
    recipient: 'support@crm.obsidian.edge',
    subject: 'Claim $5,000 Now',
    body_text: 'Click here for free reward.',
    body_html: '<p>Click here for free reward.</p>',
    message_id: '<spam-102@quick-cash.biz>',
    in_reply_to: null,
    r2_key: 'raw_emails/2026/08/eml_102.eml',
    ai_summary: 'Spam promotional offer.',
    classification: 'Spam',
    created_at: '2026-08-15T13:00:00.000Z'
  });

  mockDbState.attachments.set('att_001', {
    id: 'att_001',
    email_id: 'eml_101',
    filename: 'sla_agreement.pdf',
    mime_type: 'application/pdf',
    r2_key: 'attachments/eml_101/sla_agreement.pdf',
    size_bytes: 4096,
    content_disposition: 'attachment',
    created_at: '2026-08-15T12:00:00.000Z'
  });

  // Store attachment in R2
  const mockPdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF
  mockR2Storage.set('attachments/eml_101/sla_agreement.pdf', {
    content: mockPdfBytes,
    contentType: 'application/pdf',
    size: 4096
  });

  // Store raw EML in R2
  mockR2Storage.set('raw_emails/2026/08/eml_101.eml', {
    content: 'From: alex@enterprise.corp\nTo: support@crm.obsidian.edge\nSubject: Enterprise SLA Agreement\n\nPlease find attached the signed SLA agreement.',
    contentType: 'message/rfc822',
    size: 250
  });

  const mockDb = {
    prepare: (query) => {
      const q = query.trim();
      let boundArgs = [];
      const createExecution = () => ({
        bind: (...args) => {
          boundArgs = args;
          return createExecution();
        },
        first: async () => {
          if (q.includes('COUNT(*) AS total FROM emails')) {
            return { total: mockDbState.emails.size };
          }
          if (q.includes('FROM emails e') && q.includes('WHERE e.id = ?')) {
            const [emailId] = boundArgs;
            const found = mockDbState.emails.get(emailId);
            if (!found) return null;
            const thread = mockDbState.threads.get(found.thread_id);
            return {
              ...found,
              thread_status: thread?.status || 'open',
              contact_id: thread?.contact_id || null
            };
          }
          if (q.includes('FROM attachments') && q.includes('WHERE email_id = ?')) {
            const [emailId, filename] = boundArgs;
            for (const att of mockDbState.attachments.values()) {
              if (att.email_id === emailId && (att.filename === filename || att.id === filename || att.r2_key.includes(filename))) {
                return att;
              }
            }
            return null;
          }
          return null;
        },
        all: async () => {
          if (q.includes('FROM attachments') && q.includes('WHERE email_id = ?')) {
            const [emailId] = boundArgs;
            const results = Array.from(mockDbState.attachments.values()).filter(a => a.email_id === emailId);
            return { results };
          }
          if (q.includes('FROM emails')) {
            const allEmails = Array.from(mockDbState.emails.values())
              .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
            const limit = boundArgs[boundArgs.length - 2] || 20;
            const offset = boundArgs[boundArgs.length - 1] || 0;
            const sliced = allEmails.slice(offset, offset + limit).map(e => ({
              ...e,
              received_at: e.created_at
            }));
            return { results: sliced };
          }
          return { results: [] };
        }
      });
      return createExecution();
    }
  };

  const mockBucket = {
    get: async (key) => {
      const found = mockR2Storage.get(key);
      if (!found) return null;
      return {
        body: new Blob([found.content]).stream(),
        size: found.size,
        httpEtag: '"mock-etag-abc"',
        httpMetadata: { contentType: found.contentType },
        text: async () => typeof found.content === 'string' ? found.content : new TextDecoder().decode(found.content),
        json: async () => JSON.parse(found.content),
        writeHttpMetadata: (headers) => {
          headers.set('content-type', found.contentType);
        }
      };
    }
  };

  const TEST_API_KEY = 'secret-crm-api-token-2026';

  const env = {
    DB: mockDb,
    BUCKET: mockBucket,
    API_KEY: TEST_API_KEY
  };

  const ctx = {
    waitUntil: (p) => p
  };

  // Test 1: OPTIONS Preflight (should pass without auth credentials)
  console.log('Testing OPTIONS Preflight without Auth...');
  const optionsRes = await worker.fetch(new Request('https://api.crm.internal/api/emails', { method: 'OPTIONS' }), env, ctx);
  if (optionsRes.status !== 204 || optionsRes.headers.get('access-control-allow-origin') !== '*') {
    throw new Error('OPTIONS failed');
  }
  console.log('✅ OPTIONS Preflight passed without credentials');

  // Test 2: Unauthenticated GET /api/emails (must return 401)
  console.log('Testing Unauthenticated GET /api/emails (expect 401)...');
  const unauthRes = await worker.fetch(new Request('https://api.crm.internal/api/emails'), env, ctx);
  const unauthData = await unauthRes.json();
  if (unauthRes.status !== 401 || unauthData.success !== false || unauthData.error !== 'Unauthorized') {
    throw new Error(`Expected 401 Unauthorized, got ${unauthRes.status}`);
  }
  if (!unauthRes.headers.get('www-authenticate')) {
    throw new Error('Missing WWW-Authenticate header in 401 response');
  }
  console.log('✅ 401 Unauthorized on missing token verified');

  // Test 3: Invalid Bearer Token (must return 401)
  console.log('Testing Invalid Bearer Token (expect 401)...');
  const invalidBearerRes = await worker.fetch(new Request('https://api.crm.internal/api/emails', {
    headers: { 'Authorization': 'Bearer bad-token-xyz' }
  }), env, ctx);
  if (invalidBearerRes.status !== 401) {
    throw new Error(`Expected 401 for bad token, got ${invalidBearerRes.status}`);
  }
  console.log('✅ 401 Unauthorized on bad Bearer token verified');

  // Test 4: Invalid X-API-Key Header (must return 401)
  console.log('Testing Invalid X-API-Key Header (expect 401)...');
  const invalidKeyRes = await worker.fetch(new Request('https://api.crm.internal/api/emails', {
    headers: { 'X-API-Key': 'wrong-key-123' }
  }), env, ctx);
  if (invalidKeyRes.status !== 401) {
    throw new Error(`Expected 401 for bad X-API-Key, got ${invalidKeyRes.status}`);
  }
  console.log('✅ 401 Unauthorized on bad X-API-Key verified');

  // Test 5: Authorized GET /api/emails?page=1&limit=20 via Bearer Token
  console.log('Testing GET /api/emails with valid Bearer token...');
  const listRes = await worker.fetch(new Request('https://api.crm.internal/api/emails?page=1&limit=20', {
    headers: { 'Authorization': `Bearer ${TEST_API_KEY}` }
  }), env, ctx);
  const listData = await listRes.json();
  console.log('Status:', listRes.status, 'Total returned:', listData.data?.length);
  if (listRes.status !== 200 || !listData.success || listData.data.length !== 2) {
    throw new Error(`GET /api/emails failed: expected 2 records, got ${listData.data?.length}`);
  }
  if (listData.pagination?.page !== 1 || listData.pagination?.limit !== 20) {
    throw new Error('GET /api/emails pagination failed');
  }
  console.log('✅ GET /api/emails passed with Bearer token');

  // Test 6: Authorized GET /api/emails via X-API-Key Header
  console.log('Testing GET /api/emails with valid X-API-Key...');
  const listKeyRes = await worker.fetch(new Request('https://api.crm.internal/api/emails?page=1&limit=20', {
    headers: { 'X-API-Key': TEST_API_KEY }
  }), env, ctx);
  const listKeyData = await listKeyRes.json();
  if (listKeyRes.status !== 200 || !listKeyData.success || listKeyData.data.length !== 2) {
    throw new Error(`GET /api/emails via X-API-Key failed`);
  }
  console.log('✅ GET /api/emails passed with X-API-Key');

  // Test 7: Authorized GET /api/emails/:id via Bearer Token
  console.log('Testing GET /api/emails/eml_101 with Bearer token...');
  const detailRes = await worker.fetch(new Request('https://api.crm.internal/api/emails/eml_101', {
    headers: { 'Authorization': `Bearer ${TEST_API_KEY}` }
  }), env, ctx);
  const detailData = await detailRes.json();
  console.log('Status:', detailRes.status, 'Subject:', detailData.data?.subject);
  if (detailRes.status !== 200 || !detailData.success || detailData.data?.id !== 'eml_101') {
    throw new Error('GET /api/emails/:id failed');
  }
  if (!detailData.data?.attachments || detailData.data.attachments.length !== 1) {
    throw new Error('GET /api/emails/:id failed to return attachments list');
  }
  if (!detailData.data?.body_text) {
    throw new Error('GET /api/emails/:id missing body_text');
  }
  console.log('✅ GET /api/emails/:id passed');

  // Test 8: Authorized GET /api/emails/:id/attachments/:filename via X-API-Key
  console.log('Testing GET /api/emails/eml_101/attachments/sla_agreement.pdf with X-API-Key...');
  const streamRes = await worker.fetch(new Request('https://api.crm.internal/api/emails/eml_101/attachments/sla_agreement.pdf', {
    headers: { 'X-API-Key': TEST_API_KEY }
  }), env, ctx);
  console.log('Status:', streamRes.status, 'Content-Type:', streamRes.headers.get('content-type'));
  if (streamRes.status !== 200 || streamRes.headers.get('content-type') !== 'application/pdf') {
    throw new Error('GET /api/emails/:id/attachments/:filename stream failed');
  }
  if (!streamRes.headers.get('content-disposition')?.includes('sla_agreement.pdf')) {
    throw new Error('GET /api/emails/:id/attachments/:filename missing Content-Disposition');
  }
  console.log('✅ GET /api/emails/:id/attachments/:filename passed');

  console.log('🎉 ALL REST API WORKER TESTS PASSED SUCCESSFULLY! 🎉');
}

runApiWorkerTests().catch((err) => {
  console.error('Test execution error:', err);
  process.exit(1);
});
