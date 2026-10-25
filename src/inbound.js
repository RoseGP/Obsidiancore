/**
 * Cloudflare Email Routing Inbound Worker
 * File: src/inbound.js
 * Deployment: wrangler deploy src/inbound.js --name crm-email-inbound
 */

import PostalMime from 'postal-mime';

export default {
  async email(message, env, ctx) {
    try {
      const recipient = message.to.toLowerCase().trim();
      const sender = message.from.trim();
      const subject = message.headers.get('subject') || '(No Subject)';
      const messageId = message.headers.get('message-id') || `msg_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      const inReplyTo = message.headers.get('in-reply-to') || null;

      // 1. Verify User Exists in D1
      const user = await env.DB.prepare(
        'SELECT id, email FROM users WHERE LOWER(email) = ?'
      ).bind(recipient).first();

      if (!user) {
        // Reject unrecognized recipients
        message.setReject(`Recipient ${recipient} is not registered in this CRM system.`);
        return;
      }

      // 2. Parse MIME stream using PostalMime
      const rawStream = message.raw;
      const rawArrayBuffer = await new Response(rawStream).arrayBuffer();
      const parsed = await PostalMime.parse(rawArrayBuffer);

      // 3. Store raw .eml in R2 bucket
      const r2Key = `emails/${user.id}/${Date.now()}_${messageId.replace(/[^a-zA-Z0-9]/g, '_')}.eml`;
      if (env.EMAIL_BUCKET) {
        await env.EMAIL_BUCKET.put(r2Key, rawArrayBuffer, {
          httpMetadata: { contentType: 'message/rfc822' }
        });
      }

      // 4. Resolve or create contact & thread
      let contact = await env.DB.prepare(
        'SELECT id FROM contacts WHERE LOWER(email) = ?'
      ).bind(sender.toLowerCase()).first();

      if (!contact) {
        const contactId = `cnt_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        await env.DB.prepare(
          'INSERT INTO contacts (id, email, name, crm_account_id) VALUES (?, ?, ?, ?)'
        ).bind(contactId, sender, parsed.from?.name || sender.split('@')[0], user.id).run();
        contact = { id: contactId };
      }

      let threadId = `thd_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      if (inReplyTo) {
        const existingEmail = await env.DB.prepare(
          'SELECT thread_id FROM emails WHERE message_id = ?'
        ).bind(inReplyTo).first();
        if (existingEmail?.thread_id) {
          threadId = existingEmail.thread_id;
        }
      }

      // 5. Insert email into D1
      const emailDbId = `eml_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      await env.DB.prepare(`
        INSERT INTO emails (id, thread_id, direction, sender, recipient, subject, body_text, body_html, message_id, in_reply_to, raw_eml_key)
        VALUES (?, ?, 'inbound', ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        emailDbId,
        threadId,
        sender,
        recipient,
        subject,
        parsed.text || '',
        parsed.html || '',
        messageId,
        inReplyTo,
        r2Key
      ).run();

      // 6. Map to user inbox
      await env.DB.prepare(`
        INSERT INTO user_emails (id, user_id, email_id, folder, is_read)
        VALUES (?, ?, ?, 'inbox', 0)
      `).bind(`ue_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`, user.id, emailDbId).run();

      // 7. Store attachments in R2 and D1 if present
      if (parsed.attachments && parsed.attachments.length > 0 && env.ATTACHMENTS_BUCKET) {
        for (const att of parsed.attachments) {
          const attId = `att_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
          const attKey = `attachments/${user.id}/${emailDbId}/${attId}_${att.filename || 'attachment'}`;
          await env.ATTACHMENTS_BUCKET.put(attKey, att.content, {
            httpMetadata: { contentType: att.mimeType || 'application/octet-stream' }
          });
          await env.DB.prepare(`
            INSERT INTO attachments (id, email_id, filename, content_type, size_bytes, r2_key)
            VALUES (?, ?, ?, ?, ?, ?)
          `).bind(attId, emailDbId, att.filename || 'attachment', att.mimeType || 'application/octet-stream', att.content?.byteLength || 0, attKey).run();
        }
      }

    } catch (err) {
      console.error('[Inbound Worker Error]', err);
    }
  },

  async fetch(request, env, ctx) {
    return new Response(JSON.stringify({ status: 'CRM Inbound Email Worker Online', timestamp: new Date().toISOString() }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
