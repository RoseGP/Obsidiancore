/**
 * Cloudflare Outbound Email Worker (Phase 3)
 * File: src/outbound.js
 * Deployment: wrangler deploy src/outbound.js --name crm-email-outbound
 */

import { EmailMessage } from 'cloudflare:email';

export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method Not Allowed. Use POST to dispatch outbound emails.' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    try {
      const body = await request.json();
      const { to, subject, html, text, from = 'achmadhakim@gmail.com', userId = 'usr_101', threadId, cc, bcc, attachments } = body;

      if (!to || !subject) {
        return new Response(JSON.stringify({ error: 'Missing required parameters: "to" and "subject" are required.' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const recipient = typeof to === 'string' ? to.trim() : to[0];
      const cleanSubject = subject.trim();
      const finalHtml = html || (text ? `<p>${text.replace(/\n/g, '<br/>')}</p>` : '');
      const finalPlainText = text || (html ? html.replace(/<[^>]*>/g, '') : '');
      const emailId = `eml_out_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      const activeThreadId = threadId || `thd_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      const messageId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 8)}@devdesk.webmail.edge`;

      // 1. Send through Cloudflare EMAIL binding if available
      if (env.EMAIL) {
        const rawEmail = `From: ${from}\r\nTo: ${recipient}\r\nSubject: ${cleanSubject}\r\nMessage-ID: <${messageId}>\r\nMIME-Version: 1.0\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n${finalHtml}`;
        const msg = new EmailMessage(from, recipient, rawEmail);
        await env.EMAIL.send(msg);
      }

      // 2. Persist in Cloudflare D1 Database if DB binding is attached
      if (env.DB) {
        // Upsert thread
        await env.DB.prepare(`
          INSERT INTO email_threads (id, contact_id, subject, last_message_at, status)
          VALUES (?, ?, ?, datetime('now'), 'open')
          ON CONFLICT(id) DO UPDATE SET last_message_at = datetime('now')
        `).bind(activeThreadId, userId, cleanSubject).run();

        // Record message in emails table
        await env.DB.prepare(`
          INSERT INTO emails (id, thread_id, direction, sender, recipient, subject, body_text, body_html, message_id)
          VALUES (?, ?, 'outbound', ?, ?, ?, ?, ?, ?)
        `).bind(emailId, activeThreadId, from, recipient, cleanSubject, finalPlainText, finalHtml, messageId).run();

        // Record in user_emails sent folder
        await env.DB.prepare(`
          INSERT INTO user_emails (id, user_id, email_id, folder, is_read)
          VALUES (?, ?, ?, 'sent', 1)
        `).bind(`ue_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`, userId, emailId).run();
      }

      return new Response(JSON.stringify({
        success: true,
        message: `Email successfully dispatched to ${recipient}`,
        emailId,
        threadId: activeThreadId,
        messageId,
        timestamp: new Date().toISOString()
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });

    } catch (err) {
      return new Response(JSON.stringify({
        success: false,
        error: err.message || 'Failed to dispatch outbound email via Cloudflare worker.'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
};
