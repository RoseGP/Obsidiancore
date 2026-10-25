/**
 * Cloudflare Inbound Email Worker (ES Module)
 * 
 * Intercepts incoming emails via Cloudflare Email Routing:
 * 1. Streams & parses RFC822 MIME emails using postal-mime (`PostalMime.parse(message.raw)`).
 * 2. Processes contact resolution & threading logic via `processEmailForCrm(db, emailData)`.
 * 3. Uploads file attachments to Cloudflare R2 bucket (`env.CRM_BUCKET`, bucket name: `obsidiancrm`).
 * 4. Indexes message & attachment records in Cloudflare D1 (`env.DB`).
 * 5. Optionally dispatches webhook payload to `env.CRM_WEBHOOK_URL`.
 * 6. Serves edge-cached attachments via Cache API in `fetch(request, env, context)`.
 */

import PostalMime from 'postal-mime';
import { processEmailForCrm, normalizeSubject, extractNameFromEmail } from './crmEmailProcessor.js';
import { analyzeEmailWithAI } from './aiEmailClassifier.js';
import emailApiRouter from './emailApiRouter.js';

export { processEmailForCrm, normalizeSubject, extractNameFromEmail, analyzeEmailWithAI, emailApiRouter };

export default {
  /**
   * Cloudflare Email Routing Handler
   *
   * @param {ForwardableEmailMessage} message - The Cloudflare email event
   * @param {Object} env - Worker environment bindings (CRM_BUCKET, DB, CRM_WEBHOOK_URL, etc.)
   * @param {ExecutionContext} ctx - Worker execution context
   */
  async email(message, env, ctx) {
    const startTime = Date.now();
    const logPrefix = `[CRM-Email-Worker]`;

    try {
      console.log(`${logPrefix} Inbound email received from: ${message.from} -> to: ${message.to}`);

      // -----------------------------------------------------------------------
      // 1. STREAM & PARSE RAW EMAIL USING POSTAL-MIME
      // -----------------------------------------------------------------------
      let rawEmailBuffer;
      try {
        rawEmailBuffer = await new Response(message.raw).arrayBuffer();
      } catch (streamErr) {
        throw new Error(`Failed reading raw email stream: ${streamErr.message}`);
      }

      const parser = new PostalMime();
      let parsedEmail;
      try {
        parsedEmail = await parser.parse(rawEmailBuffer);
      } catch (parseErr) {
        throw new Error(`PostalMime failed to parse email structure: ${parseErr.message}`);
      }

      const senderEmail = (message.from || parsedEmail.from?.address || '').trim().toLowerCase();
      const senderName = parsedEmail.from?.name || extractNameFromEmail(senderEmail);
      const recipientEmail = (message.to || parsedEmail.to?.[0]?.address || '').trim().toLowerCase();
      const subject = parsedEmail.subject?.trim() || '(No Subject)';
      const textBody = parsedEmail.text || '';
      const htmlBody = parsedEmail.html || '';
      const emailCreatedAt = parsedEmail.date || new Date().toISOString();

      const messageId =
        message.headers.get('message-id') ||
        parsedEmail.messageId ||
        `<gen_${Date.now()}_${crypto.randomUUID()}@cloudflare.crm>`;

      const inReplyTo = message.headers.get('in-reply-to') || parsedEmail.inReplyTo || null;
      const references = message.headers.get('references') || parsedEmail.references || null;

      const emailId = `eml_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
      let contact_id = null;
      let thread_id = null;

      // -----------------------------------------------------------------------
      // 2. CLOUDFLARE WORKERS AI: 2-SENTENCE SUMMARY & CLASSIFICATION (env.AI)
      // -----------------------------------------------------------------------
      console.log(`${logPrefix} Running Workers AI LLM analysis (@cf/meta/llama-3-8b-instruct)...`);
      const aiAnalysis = await analyzeEmailWithAI(env.AI, {
        sender: senderEmail,
        subject: subject,
        bodyText: textBody,
        bodyHtml: htmlBody
      });

      const aiSummary = aiAnalysis.summary;
      const classification = aiAnalysis.classification; // 'Important' | 'Spam'

      console.log(`${logPrefix} AI Analysis complete -> [Classification: ${classification}]`);
      console.log(`${logPrefix} AI Summary: "${aiSummary}"`);

      // -----------------------------------------------------------------------
      // 3. CONTACT RESOLUTION & THREADING ENGINE (D1 DATABASE)
      // -----------------------------------------------------------------------
      if (env.DB && typeof env.DB.prepare === 'function') {
        const crmAccountId = env.DEFAULT_CRM_ACCOUNT_ID || 'acc_primary_org';

        // Auto-create/find contact and resolve/create conversation thread
        const crmResult = await processEmailForCrm(env.DB, {
          sender: senderEmail,
          senderName: senderName,
          subject: subject,
          inReplyTo: inReplyTo,
          references: references,
          crmAccountId: crmAccountId,
          receivedAt: emailCreatedAt
        });

        contact_id = crmResult.contact_id;
        thread_id = crmResult.thread_id;

        console.log(`${logPrefix} Resolved contact_id: ${contact_id} | thread_id: ${thread_id}`);

        // If email is classified as Spam and this is a new thread, mark thread status as spam
        if (classification === 'Spam' && thread_id) {
          try {
            await env.DB.prepare(`
              UPDATE email_threads
              SET status = 'spam', updated_at = ?
              WHERE id = ?
            `).bind(emailCreatedAt, thread_id).run();
          } catch (spamErr) {
            console.warn(`${logPrefix} Could not update thread status to spam:`, spamErr.message);
          }
        }

        // Insert structured email into `emails` table with AI Summary & Classification
        await env.DB.prepare(`
          INSERT INTO emails (
            id, thread_id, direction, sender, recipient, subject,
            body_text, body_html, message_id, in_reply_to,
            ai_summary, classification, created_at
          ) VALUES (?, ?, 'inbound', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          emailId,
          thread_id,
          senderEmail,
          recipientEmail,
          subject,
          textBody,
          htmlBody,
          messageId,
          inReplyTo,
          aiSummary,
          classification,
          emailCreatedAt
        ).run();

        console.log(`${logPrefix} Stored email ${emailId} in D1 (Classification: ${classification})`);
      } else {
        console.warn(`${logPrefix} env.DB binding not detected. Database ingestion skipped.`);
      }

      // -----------------------------------------------------------------------
      // 3. ATTACHMENT PROCESSING INTO R2 BUCKET (obsidiancrm)
      // -----------------------------------------------------------------------
      const attachments = parsedEmail.attachments || [];
      const uploadedAttachments = [];

      if (attachments.length > 0) {
        console.log(`${logPrefix} Processing ${attachments.length} attachment(s)...`);

        for (let i = 0; i < attachments.length; i++) {
          const att = attachments[i];
          const attId = `att_${Date.now()}_${i + 1}_${crypto.randomUUID().slice(0, 6)}`;
          const safeFilename = (att.filename || `attachment_${i + 1}`).replace(/[^a-zA-Z0-9._-]/g, '_');
          const mimeType = att.mimeType || 'application/octet-stream';
          const sizeBytes = att.content?.byteLength || 0;
          const fileKey = `attachments/${Date.now()}-${safeFilename}`;

          // Upload to R2 Bucket (env.CRM_BUCKET / obsidiancrm)
          const bucket = env.CRM_BUCKET || env.MY_BUCKET;
          if (bucket && typeof bucket.put === 'function') {
            try {
              await bucket.put(fileKey, att.content, {
                httpMetadata: {
                  contentType: mimeType,
                  contentDisposition: `attachment; filename="${safeFilename}"`
                },
                customMetadata: {
                  emailId: emailId,
                  threadId: thread_id || 'unthreaded',
                  originalFilename: safeFilename,
                  sizeBytes: String(sizeBytes)
                }
              });
              console.log(`${logPrefix} Stored attachment in R2 [${fileKey}] (${sizeBytes} bytes)`);
            } catch (r2Err) {
              console.error(`${logPrefix} Failed storing attachment in R2 [${safeFilename}]:`, r2Err);
            }
          }

          // Save attachment record in D1 Database if DB is available
          if (env.DB && typeof env.DB.prepare === 'function' && thread_id) {
            try {
              await env.DB.prepare(`
                INSERT INTO attachments (
                  id, email_id, filename, mime_type, r2_key, size_bytes,
                  content_disposition, content_id, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
              `).bind(
                attId,
                emailId,
                safeFilename,
                mimeType,
                fileKey,
                sizeBytes,
                att.disposition || 'attachment',
                att.contentId || null,
                emailCreatedAt
              ).run();
            } catch (dbAttErr) {
              console.warn(`${logPrefix} Could not record attachment in D1:`, dbAttErr.message);
            }
          }

          uploadedAttachments.push({
            id: attId,
            filename: safeFilename,
            mimeType: mimeType,
            r2Key: fileKey,
            sizeBytes: sizeBytes
          });
        }
      }

      // -----------------------------------------------------------------------
      // 4. POST EVENT TO CRM API WEBHOOK
      // -----------------------------------------------------------------------
      if (env.CRM_WEBHOOK_URL) {
        try {
          const webhookPayload = {
            event: 'email.received',
            contact_id: contact_id,
            thread_id: thread_id,
            email_id: emailId,
            from: senderEmail,
            fromName: senderName,
            to: recipientEmail,
            subject: subject,
            text: textBody,
            html: htmlBody,
            ai_summary: aiSummary,
            classification: classification,
            messageId: messageId,
            inReplyTo: inReplyTo,
            attachmentCount: attachments.length,
            attachments: uploadedAttachments,
            receivedAt: emailCreatedAt
          };

          const webhookPromise = fetch(env.CRM_WEBHOOK_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'User-Agent': 'Cloudflare-CRM-Email-Worker/1.0',
              ...(env.CRM_WEBHOOK_SECRET ? { 'X-CRM-Webhook-Secret': env.CRM_WEBHOOK_SECRET } : {})
            },
            body: JSON.stringify(webhookPayload)
          });

          if (ctx && typeof ctx.waitUntil === 'function') {
            ctx.waitUntil(webhookPromise);
          } else {
            await webhookPromise;
          }
          console.log(`${logPrefix} Dispatched email event to CRM webhook`);
        } catch (webhookErr) {
          console.error(`${logPrefix} Webhook dispatch error:`, webhookErr.message);
        }
      }

      const elapsedMs = Date.now() - startTime;
      console.log(`${logPrefix} ✅ Email processed in ${elapsedMs}ms (Contact: ${contact_id}, Thread: ${thread_id})`);

    } catch (error) {
      console.error(`${logPrefix} ❌ Failed to process email:`, error.stack || error.message);
    }
  },

  /**
   * HTTP Fetch Handler
   * Edge-cached R2 object streaming with Cloudflare Cache API + health diagnostics.
   *
   * @param {Request} request
   * @param {Object} env
   * @param {ExecutionContext} context
   */
  async fetch(request, env, context) {
    try {
      const url = new URL(request.url);

      // Route /api/* endpoints through Hono / Native API Router
      if (url.pathname.startsWith('/api/')) {
        return await emailApiRouter.fetch(request, env, context);
      }

      // Health endpoint
      if (url.pathname === '/health') {
        return new Response(
          JSON.stringify({
            status: 'online',
            service: 'crm-email-worker',
            r2Bucket: 'obsidiancrm',
            d1Database: 'obsidiandashoarddb',
            bindings: {
              hasR2Bucket: Boolean(env.CRM_BUCKET || env.MY_BUCKET),
              hasD1Database: Boolean(env.DB),
              hasWebhook: Boolean(env.CRM_WEBHOOK_URL)
            },
            timestamp: new Date().toISOString()
          }, null, 2),
          {
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
          }
        );
      }

      // Root ping check
      if (url.pathname === '/' || url.pathname === '') {
        return new Response(
          JSON.stringify({
            message: 'CRM Email & R2 Storage Worker Online',
            bucket: 'obsidiancrm'
          }, null, 2),
          {
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
          }
        );
      }

      // CORS Preflight
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Range, Authorization'
          }
        });
      }

      // -----------------------------------------------------------------------
      // CLOUDFLARE CACHE API + R2 STREAMING
      // -----------------------------------------------------------------------
      const cacheKey = new Request(url.toString(), request);
      const cache = typeof caches !== 'undefined' && caches.default ? caches.default : null;

      // 1. Check cache
      if (cache) {
        let cachedResponse = await cache.match(cacheKey);
        if (cachedResponse) {
          console.log(`[R2 Cache] Cache hit for: ${request.url}`);
          const hitHeaders = new Headers(cachedResponse.headers);
          hitHeaders.set('X-Cache-Status', 'HIT');
          hitHeaders.set('Access-Control-Allow-Origin', '*');
          return new Response(cachedResponse.body, {
            status: cachedResponse.status,
            statusText: cachedResponse.statusText,
            headers: hitHeaders
          });
        }
      }

      // 2. Fetch from R2 Bucket (obsidiancrm)
      const bucket = env.CRM_BUCKET || env.MY_BUCKET;
      if (!bucket || typeof bucket.get !== 'function') {
        return new Response('R2 Bucket Binding (env.CRM_BUCKET: obsidiancrm) not configured', { status: 500 });
      }

      const objectKey = decodeURIComponent(url.pathname.slice(1));
      const object = await bucket.get(objectKey);

      if (object === null) {
        return new Response('Object Not Found', {
          status: 404,
          headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'text/plain; charset=utf-8' }
        });
      }

      // 3. Set metadata headers
      const headers = new Headers();
      if (typeof object.writeHttpMetadata === 'function') {
        object.writeHttpMetadata(headers);
      }
      if (object.httpEtag) {
        headers.set('etag', object.httpEtag);
      }

      headers.append('Cache-Control', 's-maxage=10');
      headers.set('X-Cache-Status', 'MISS');
      headers.set('Access-Control-Allow-Origin', '*');

      let response = new Response(object.body, { headers });

      // 4. Cache response
      if (cache && context && typeof context.waitUntil === 'function') {
        context.waitUntil(cache.put(cacheKey, response.clone()));
      }

      return response;
    } catch (e) {
      console.error(`[R2 Fetch Error]:`, e);
      return new Response('Error thrown ' + e.message, {
        status: 500,
        headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'text/plain; charset=utf-8' }
      });
    }
  }
};
