import PostalMime from 'postal-mime';
import worker, { processEmailForCrm, normalizeSubject, extractNameFromEmail } from './src/index.js';

async function testWorkerExecution() {
  console.log('--- Testing Cloudflare Email Worker with CRM Ingestion & Threading ---');

  // In-memory mock database state
  const mockDbState = {
    contacts: new Map(),
    email_threads: new Map(),
    emails: new Map(),
    attachments: new Map()
  };

  const mockD1Database = {
    prepare: (query) => {
      const q = query.trim();
      return {
        bind: (...args) => ({
          first: async () => {
            if (q.includes('FROM contacts') && q.includes('email = ?')) {
              const [crmAccountId, email] = args;
              for (const c of mockDbState.contacts.values()) {
                if (c.crm_account_id === crmAccountId && c.email.toLowerCase() === email.toLowerCase()) {
                  return c;
                }
              }
              return null;
            }
            if (q.includes('FROM emails') && q.includes('message_id = ?')) {
              const [msgId] = args;
              for (const e of mockDbState.emails.values()) {
                if (e.message_id === msgId) return e;
              }
              return null;
            }
            if (q.includes('COUNT(*) AS total FROM emails')) {
              return { total: mockDbState.emails.size };
            }
            if (q.includes('FROM emails') && q.includes('WHERE e.id = ?')) {
              const [emailId] = args;
              const found = mockDbState.emails.get(emailId);
              if (!found) return null;
              const thread = mockDbState.email_threads.get(found.thread_id);
              return {
                ...found,
                thread_status: thread?.status || 'open',
                contact_id: thread?.contact_id || null
              };
            }
            return null;
          },
          all: async () => {
            if (q.includes('FROM email_threads') && q.includes('contact_id = ?')) {
              const [contactId] = args;
              const results = [];
              for (const t of mockDbState.email_threads.values()) {
                if (t.contact_id === contactId) results.push(t);
              }
              return { results };
            }
            if (q.includes('FROM attachments') && q.includes('email_id = ?')) {
              const [emailId] = args;
              const results = [];
              for (const a of mockDbState.attachments.values()) {
                if (a.email_id === emailId) results.push(a);
              }
              return { results };
            }
            if (q.includes('FROM emails')) {
              const allEmails = Array.from(mockDbState.emails.values())
                .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
              const limit = args[args.length - 2] || 20;
              const offset = args[args.length - 1] || 0;
              const sliced = allEmails.slice(offset, offset + limit).map(e => ({
                id: e.id,
                thread_id: e.thread_id,
                direction: e.direction,
                sender: e.sender,
                recipient: e.recipient,
                subject: e.subject,
                message_id: e.message_id,
                in_reply_to: e.in_reply_to,
                raw_eml_key: e.raw_eml_key,
                ai_summary: e.ai_summary,
                classification: e.classification,
                created_at: e.created_at,
                snippet: (e.body_text || '').slice(0, 200),
                attachment_count: Array.from(mockDbState.attachments.values()).filter(a => a.email_id === e.id).length
              }));
              return { results: sliced };
            }
            return { results: [] };
          },
          run: async () => {
            if (q.startsWith('INSERT INTO contacts')) {
              const [id, email, name, crm_account_id, created_at, updated_at] = args;
              mockDbState.contacts.set(id, { id, email, name, crm_account_id, created_at, updated_at });
            } else if (q.startsWith('INSERT INTO email_threads')) {
              const [id, contact_id, subject, last_message_at, status, created_at, updated_at] = args;
              mockDbState.email_threads.set(id, { id, contact_id, subject, last_message_at, status, created_at, updated_at });
            } else if (q.startsWith('UPDATE email_threads')) {
              if (q.includes("status = 'spam'")) {
                const [updated_at, id] = args;
                if (mockDbState.email_threads.has(id)) {
                  const t = mockDbState.email_threads.get(id);
                  t.status = 'spam';
                  t.updated_at = updated_at;
                }
              } else {
                const [last_message_at, updated_at, id] = args;
                if (mockDbState.email_threads.has(id)) {
                  const t = mockDbState.email_threads.get(id);
                  t.last_message_at = last_message_at;
                  t.updated_at = updated_at;
                }
              }
            } else if (q.startsWith('INSERT INTO emails')) {
              const [id, thread_id, sender, recipient, subject, body_text, body_html, message_id, in_reply_to, ai_summary, classification, created_at] = args;
              mockDbState.emails.set(id, { id, thread_id, sender, recipient, subject, body_text, body_html, message_id, in_reply_to, ai_summary, classification, created_at });
            } else if (q.startsWith('INSERT INTO attachments')) {
              const [id, email_id, filename, mime_type, r2_key, size_bytes] = args;
              mockDbState.attachments.set(id, { id, email_id, filename, mime_type, r2_key, size_bytes });
            }
            return { success: true };
          }
        })
      };
    }
  };

  const mockR2Storage = new Map();
  const mockR2Bucket = {
    put: async (key, content, options) => {
      mockR2Storage.set(key, { content, options });
      return { key };
    },
    get: async (key) => {
      const found = mockR2Storage.get(key);
      if (!found) return null;
      return {
        body: found.content,
        httpEtag: '"mock-etag-12345"',
        writeHttpMetadata: (headers) => {
          headers.set('content-type', found.options?.httpMetadata?.contentType || 'application/octet-stream');
        }
      };
    }
  };

  const mockWorkersAI = {
    run: async (model, options) => {
      console.log(`[Mock Workers AI] Executing model ${model}`);
      const userPrompt = options?.messages?.find(m => m.role === 'user')?.content || '';
      if (userPrompt.toLowerCase().includes('viagra') || userPrompt.toLowerCase().includes('lottery') || userPrompt.toLowerCase().includes('winner')) {
        return {
          response: JSON.stringify({
            summary: "The sender claims you won a lottery award. Immediate action is requested to claim the funds.",
            classification: "Spam"
          })
        };
      }
      return {
        response: JSON.stringify({
          summary: "The sender is requesting custom pricing and enterprise quotation details. A technical specification document was attached for review.",
          classification: "Important"
        })
      };
    }
  };

  const mockEnv = {
    AI: mockWorkersAI,
    CRM_BUCKET: mockR2Bucket,
    DB: mockD1Database,
    DEFAULT_CRM_ACCOUNT_ID: 'acc_primary_org'
  };

  const mockCtx = {
    waitUntil: (promise) => promise
  };

  // -------------------------------------------------------------------------
  // Test 1: First inbound email from a new contact (Creates Contact + New Thread)
  // -------------------------------------------------------------------------
  const rawEmail1 = `From: "Sarah Lin" <sarah.lin@apexglobal.io>
To: "Support Team" <support@crm.obsidian.edge>
Subject: Enterprise Proposal Pricing
Date: Sat, 15 Aug 2026 12:00:00 +0000
Message-ID: <msg-001@apexglobal.io>
MIME-Version: 1.0
Content-Type: multipart/mixed; boundary="boundary-1"

--boundary-1
Content-Type: text/plain; charset=UTF-8

Hello, can you send over the custom quote?

Best,
Sarah

--boundary-1
Content-Type: application/pdf; name="spec.pdf"
Content-Disposition: attachment; filename="spec.pdf"
Content-Transfer-Encoding: base64

JVBERi0xLjQKJcTl8uXrp/Og0MTGCjQgMCBvYmo=
--boundary-1--`;

  const msg1 = {
    from: 'sarah.lin@apexglobal.io',
    to: 'support@crm.obsidian.edge',
    headers: {
      get: (k) => (k.toLowerCase() === 'message-id' ? '<msg-001@apexglobal.io>' : null)
    },
    raw: new Blob([rawEmail1]).stream()
  };

  await worker.email(msg1, mockEnv, mockCtx);

  console.log('Contacts Count after Email 1:', mockDbState.contacts.size);
  console.log('Threads Count after Email 1:', mockDbState.email_threads.size);
  console.log('Emails Count after Email 1:', mockDbState.emails.size);
  console.log('R2 Attachments in obsidiancrm Bucket:', mockR2Storage.size);

  if (mockDbState.contacts.size !== 1 || mockDbState.email_threads.size !== 1) {
    throw new Error('Test 1 Failed: Contact or Thread was not created!');
  }

  // -------------------------------------------------------------------------
  // Test 2: Follow-up email (In-Reply-To or Re: Subject) (Appends to Same Thread)
  // -------------------------------------------------------------------------
  const rawEmail2 = `From: "Sarah Lin" <sarah.lin@apexglobal.io>
To: "Support Team" <support@crm.obsidian.edge>
Subject: Re: Enterprise Proposal Pricing
Date: Sat, 15 Aug 2026 12:30:00 +0000
Message-ID: <msg-002@apexglobal.io>
In-Reply-To: <msg-001@apexglobal.io>
MIME-Version: 1.0
Content-Type: text/plain; charset=UTF-8

Thank you for looking into this!

Sarah`;

  const msg2 = {
    from: 'sarah.lin@apexglobal.io',
    to: 'support@crm.obsidian.edge',
    headers: {
      get: (k) => {
        if (k.toLowerCase() === 'message-id') return '<msg-002@apexglobal.io>';
        if (k.toLowerCase() === 'in-reply-to') return '<msg-001@apexglobal.io>';
        return null;
      }
    },
    raw: new Blob([rawEmail2]).stream()
  };

  await worker.email(msg2, mockEnv, mockCtx);

  console.log('Contacts Count after Email 2:', mockDbState.contacts.size);
  console.log('Threads Count after Email 2:', mockDbState.email_threads.size);
  console.log('Emails Count after Email 2:', mockDbState.emails.size);

  if (mockDbState.contacts.size !== 1) {
    throw new Error('Test 2 Failed: Duplicate contact was created!');
  }
  if (mockDbState.email_threads.size !== 1) {
    throw new Error('Test 2 Failed: Threading failed to append to existing thread!');
  }
  if (mockDbState.emails.size !== 2) {
    throw new Error('Test 2 Failed: Expected 2 emails in thread!');
  }

  // -------------------------------------------------------------------------
  // Test 3: R2 Edge Cache Fetch Handler
  // -------------------------------------------------------------------------
  const storedKeys = Array.from(mockR2Storage.keys());
  const r2Res = await worker.fetch(new Request(`https://crm-worker.internal/${storedKeys[0]}`), mockEnv, mockCtx);
  console.log(`Fetch R2 /${storedKeys[0]} -> Status: ${r2Res.status}`);

  if (r2Res.status !== 200) {
    throw new Error('Test 3 Failed: R2 fetch handler failed');
  }

  // -------------------------------------------------------------------------
  // Test 4: GET /api/emails (Paginated metadata list)
  // -------------------------------------------------------------------------
  console.log('--- Testing GET /api/emails ---');
  const apiListRes = await worker.fetch(new Request('https://crm-worker.internal/api/emails?page=1&limit=10'), mockEnv, mockCtx);
  const apiListData = await apiListRes.json();
  console.log('GET /api/emails Response Status:', apiListRes.status, 'Total emails:', apiListData.pagination?.total);

  if (apiListRes.status !== 200 || !apiListData.success || apiListData.data.length !== 2) {
    throw new Error(`Test 4 Failed: Expected 2 emails in /api/emails list, got ${apiListData.data?.length}`);
  }

  // -------------------------------------------------------------------------
  // Test 5: GET /api/emails/:id (Metadata + Raw .EML Payload from R2)
  // -------------------------------------------------------------------------
  console.log('--- Testing GET /api/emails/:id ---');
  const targetEmailId = apiListData.data[0].id;
  const apiDetailRes = await worker.fetch(new Request(`https://crm-worker.internal/api/emails/${targetEmailId}`), mockEnv, mockCtx);
  const apiDetailData = await apiDetailRes.json();
  console.log(`GET /api/emails/${targetEmailId} -> Status:`, apiDetailRes.status, 'Subject:', apiDetailData.data?.subject);
  console.log('AI Summary from D1:', apiDetailData.data?.ai_summary);
  console.log('Classification Tag from D1:', apiDetailData.data?.classification);

  if (apiDetailRes.status !== 200 || !apiDetailData.success || !apiDetailData.data?.raw_eml_payload) {
    throw new Error('Test 5 Failed: Failed fetching email detail with raw EML payload');
  }

  if (apiDetailData.data?.classification !== 'Important' || !apiDetailData.data?.ai_summary) {
    throw new Error('Test 5 Failed: AI summary or classification was not stored in D1!');
  }

  // -------------------------------------------------------------------------
  // Test 6: Inbound Spam Email Ingestion & Classification Tagging
  // -------------------------------------------------------------------------
  console.log('--- Testing Inbound Spam Email with Workers AI ---');
  const rawSpamEmail = `From: "Lottery Sweepstakes" <promo@unknown-winner-claim.biz>
To: "Support Team" <support@crm.obsidian.edge>
Subject: CONGRATULATIONS! You are our $1,000,000 lottery winner!
Date: Sat, 15 Aug 2026 13:00:00 +0000
Message-ID: <spam-msg-999@unknown-winner-claim.biz>
MIME-Version: 1.0
Content-Type: text/plain; charset=UTF-8

You have been selected as our top lottery winner. Reply with bank details to claim!`;

  const spamMsg = {
    from: 'promo@unknown-winner-claim.biz',
    to: 'support@crm.obsidian.edge',
    headers: {
      get: (k) => (k.toLowerCase() === 'message-id' ? '<spam-msg-999@unknown-winner-claim.biz>' : null)
    },
    raw: new Blob([rawSpamEmail]).stream()
  };

  await worker.email(spamMsg, mockEnv, mockCtx);

  const spamEmailRecord = Array.from(mockDbState.emails.values()).find(e => e.sender === 'promo@unknown-winner-claim.biz');
  if (!spamEmailRecord) {
    throw new Error('Test 6 Failed: Spam email was not inserted into D1!');
  }

  console.log('Spam Email Stored in D1:');
  console.log(' - ID:', spamEmailRecord.id);
  console.log(' - Classification:', spamEmailRecord.classification);
  console.log(' - AI Summary:', spamEmailRecord.ai_summary);

  if (spamEmailRecord.classification !== 'Spam') {
    throw new Error(`Test 6 Failed: Expected classification 'Spam', got '${spamEmailRecord.classification}'`);
  }

  const spamThread = mockDbState.email_threads.get(spamEmailRecord.thread_id);
  if (spamThread?.status !== 'spam') {
    throw new Error(`Test 6 Failed: Expected thread status 'spam', got '${spamThread?.status}'`);
  }

  console.log('🎉 ALL INTEGRATION TESTS (INGESTION, THREADING, R2 CACHE, WORKERS AI CLASSIFICATION & SUMMARY, & REST API) PASSED SUCCESSFULLY! 🎉');
}

testWorkerExecution().catch((err) => {
  console.error('Test Execution Error:', err);
  process.exit(1);
});
