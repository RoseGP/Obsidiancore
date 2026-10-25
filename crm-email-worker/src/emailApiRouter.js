/**
 * Cloudflare Worker Email API Router (Hono & Native Fetch)
 * 
 * Connected to:
 * - Cloudflare D1: env.DB (Metadata, contacts, threads, email index)
 * - Cloudflare R2: env.CRM_BUCKET (Raw .eml files & binary attachments in 'obsidiancrm')
 *
 * Endpoints:
 * 1. GET /api/emails -> Paginated list of email metadata sorted by date (newest first).
 * 2. GET /api/emails/:id -> Retrieves metadata from D1 and raw .eml payload from R2 via r2_key.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';

const app = new Hono();

// Enable CORS for CRM frontend dashboards
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'Accept', 'Range'],
  exposeHeaders: ['Content-Length', 'ETag', 'Content-Disposition']
}));

/**
 * 1. GET /api/emails
 * Returns a paginated JSON list of email metadata sorted by date.
 * 
 * Query Parameters:
 * - page: number (default: 1)
 * - limit: number (default: 20, max: 100)
 * - thread_id: string (optional thread filter)
 * - direction: 'inbound' | 'outbound' (optional)
 * - sender: string (optional search filter)
 * - search: string (fuzzy subject/sender search)
 */
app.get('/api/emails', async (c) => {
  const db = c.env.DB;
  if (!db || typeof db.prepare !== 'function') {
    return c.json({ success: false, error: 'Database binding (env.DB) is not configured' }, 500);
  }

  try {
    const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') || '20', 10)));
    const offset = (page - 1) * limit;

    const threadId = c.req.query('thread_id');
    const direction = c.req.query('direction');
    const sender = c.req.query('sender');
    const search = c.req.query('search');
    const classification = c.req.query('classification');

    // Build dynamic WHERE clauses safely with parameterized bindings
    const whereConditions = [];
    const bindings = [];

    if (threadId) {
      whereConditions.push('e.thread_id = ?');
      bindings.push(threadId);
    }

    if (direction && (direction === 'inbound' || direction === 'outbound')) {
      whereConditions.push('e.direction = ?');
      bindings.push(direction);
    }

    if (classification) {
      whereConditions.push('e.classification = ?');
      bindings.push(classification);
    }

    if (sender) {
      whereConditions.push('e.sender LIKE ?');
      bindings.push(`%${sender.trim()}%`);
    }

    if (search) {
      whereConditions.push('(e.subject LIKE ? OR e.sender LIKE ? OR e.recipient LIKE ? OR e.body_text LIKE ?)');
      const searchTerm = `%${search.trim()}%`;
      bindings.push(searchTerm, searchTerm, searchTerm, searchTerm);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    // 1. Get total count for pagination metadata
    const countSql = `SELECT COUNT(*) AS total FROM emails e ${whereClause}`;
    const countResult = await db.prepare(countSql).bind(...bindings).first();
    const total = countResult ? countResult.total : 0;
    const totalPages = Math.ceil(total / limit) || 1;

    // 2. Fetch paginated email metadata sorted by creation date descending
    const querySql = `
      SELECT 
        e.id,
        e.thread_id,
        e.direction,
        e.sender,
        e.recipient,
        e.subject,
        e.message_id,
        e.in_reply_to,
        e.raw_eml_key,
        e.ai_summary,
        e.classification,
        e.created_at,
        SUBSTR(COALESCE(e.body_text, ''), 1, 200) AS snippet,
        (SELECT COUNT(*) FROM attachments a WHERE a.email_id = e.id) AS attachment_count
      FROM emails e
      ${whereClause}
      ORDER BY e.created_at DESC
      LIMIT ? OFFSET ?
    `;

    const dataBindings = [...bindings, limit, offset];
    const { results } = await db.prepare(querySql).bind(...dataBindings).all();

    return c.json({
      success: true,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1
      },
      data: results || []
    });

  } catch (err) {
    console.error('[API Error] GET /api/emails failed:', err);
    return c.json({
      success: false,
      error: 'Failed to retrieve email list',
      details: err.message
    }, 500);
  }
});

/**
 * 2. GET /api/emails/:id
 * Fetches the metadata from D1, retrieves the raw .eml payload from R2 using r2_key,
 * and returns it to the client.
 *
 * Formats supported:
 * - Default: JSON response containing metadata, attachment list, and raw .eml string content
 * - Accept: message/rfc822 or ?format=raw -> Direct RFC822 .eml stream response for email clients
 */
app.get('/api/emails/:id', async (c) => {
  const db = c.env.DB;
  const bucket = c.env.CRM_BUCKET || c.env.MY_BUCKET || c.env.EMAIL_BUCKET;
  const emailId = c.req.param('id');

  if (!db) {
    return c.json({ success: false, error: 'Database binding (env.DB) is not configured' }, 500);
  }

  try {
    // 1. Fetch email record from D1
    const email = await db.prepare(`
      SELECT 
        e.id,
        e.thread_id,
        e.direction,
        e.sender,
        e.recipient,
        e.subject,
        e.body_text,
        e.body_html,
        e.message_id,
        e.in_reply_to,
        e.raw_eml_key,
        e.ai_summary,
        e.classification,
        e.created_at,
        t.status AS thread_status,
        t.contact_id
      FROM emails e
      LEFT JOIN email_threads t ON e.thread_id = t.id
      WHERE e.id = ?
      LIMIT 1
    `).bind(emailId).first();

    if (!email) {
      return c.json({
        success: false,
        error: `Email record with ID '${emailId}' not found`
      }, 404);
    }

    // 2. Fetch associated attachments from D1
    const { results: attachments } = await db.prepare(`
      SELECT id, filename, mime_type, r2_key, size_bytes, content_disposition, created_at
      FROM attachments
      WHERE email_id = ?
      ORDER BY created_at ASC
    `).bind(emailId).all();

    // 3. Determine R2 Storage Key for Raw .EML Payload
    const rawEmlKey = email.raw_eml_key || `raw_emails/${emailId}.eml`;

    let r2Object = null;
    let rawEmlContent = null;

    if (bucket && typeof bucket.get === 'function') {
      try {
        r2Object = await bucket.get(rawEmlKey);
        
        // Fallback search if partitioned by date
        if (!r2Object && !email.raw_eml_key) {
          const dateStr = email.created_at.slice(0, 7).replace('-', '/'); // YYYY/MM
          const candidateKey = `raw_emails/${dateStr}/${emailId}.eml`;
          r2Object = await bucket.get(candidateKey);
        }
      } catch (r2Err) {
        console.warn(`[API Warning] Failed reading R2 key ${rawEmlKey}:`, r2Err.message);
      }
    }

    // 4. Check if client wants raw .eml RFC822 stream directly (e.g. for Thunderbird, Apple Mail, or download)
    const format = c.req.query('format');
    const acceptHeader = c.req.header('accept') || '';
    const wantsRawStream = format === 'raw' || format === 'eml' || acceptHeader.includes('message/rfc822');

    if (wantsRawStream) {
      if (r2Object && r2Object.body) {
        const headers = new Headers();
        if (typeof r2Object.writeHttpMetadata === 'function') {
          r2Object.writeHttpMetadata(headers);
        }
        headers.set('Content-Type', 'message/rfc822; charset=utf-8');
        const safeSubject = (email.subject || 'message').replace(/[^a-zA-Z0-9_-]/g, '_');
        headers.set('Content-Disposition', `inline; filename="${safeSubject}_${emailId}.eml"`);
        if (r2Object.httpEtag) headers.set('ETag', r2Object.httpEtag);
        headers.set('Cache-Control', 'public, max-age=3600');

        return new Response(r2Object.body, { headers });
      }

      // If not stored in R2, generate a clean RFC822 payload on the fly from D1 metadata
      const syntheticEml = generateSyntheticEml(email);
      return new Response(syntheticEml, {
        headers: {
          'Content-Type': 'message/rfc822; charset=utf-8',
          'Content-Disposition': `inline; filename="${emailId}.eml"`
        }
      });
    }

    // 5. Read raw .eml text for JSON response payload
    if (r2Object && r2Object.body) {
      rawEmlContent = await r2Object.text();
    } else {
      rawEmlContent = generateSyntheticEml(email);
    }

    // 6. Return comprehensive JSON with metadata + raw .eml payload + attachments
    return c.json({
      success: true,
      data: {
        id: email.id,
        thread_id: email.thread_id,
        contact_id: email.contact_id,
        thread_status: email.thread_status,
        direction: email.direction,
        sender: email.sender,
        recipient: email.recipient,
        subject: email.subject,
        body_text: email.body_text,
        body_html: email.body_html,
        message_id: email.message_id,
        in_reply_to: email.in_reply_to,
        ai_summary: email.ai_summary,
        classification: email.classification,
        created_at: email.created_at,
        r2_key: rawEmlKey,
        r2_found: Boolean(r2Object),
        attachments: attachments || [],
        raw_eml_payload: rawEmlContent
      }
    });

  } catch (err) {
    console.error(`[API Error] GET /api/emails/${emailId} failed:`, err);
    return c.json({
      success: false,
      error: 'Failed to retrieve email details and R2 payload',
      details: err.message
    }, 500);
  }
});

/**
 * Generates standard RFC 822 EML format from D1 metadata when raw binary is unavailable
 */
function generateSyntheticEml(email) {
  const boundary = `----=_Part_${Date.now()}`;
  return [
    `From: <${email.sender}>`,
    `To: <${email.recipient}>`,
    `Subject: ${email.subject || '(No Subject)'}`,
    `Date: ${new Date(email.created_at || Date.now()).toUTCString()}`,
    `Message-ID: ${email.message_id || `<${email.id}@edge>`}`,
    email.in_reply_to ? `In-Reply-To: ${email.in_reply_to}` : '',
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    `Content-Type: text/plain; charset=UTF-8`,
    `Content-Transfer-Encoding: 8bit`,
    '',
    email.body_text || '',
    '',
    `--${boundary}`,
    `Content-Type: text/html; charset=UTF-8`,
    `Content-Transfer-Encoding: 8bit`,
    '',
    email.body_html || `<p>${email.body_text || ''}</p>`,
    '',
    `--${boundary}--`
  ].filter(Boolean).join('\r\n');
}

export default app;
