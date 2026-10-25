/**
 * Cloudflare Worker Native Fetch Router (Zero Dependencies)
 * 
 * Connected to:
 * - Cloudflare D1: env.DB
 * - Cloudflare R2: env.CRM_BUCKET ('obsidiancrm')
 *
 * Endpoints:
 * 1. GET /api/emails -> Paginated JSON list of email metadata sorted by date.
 * 2. GET /api/emails/:id -> Fetches metadata from D1 and raw .eml payload from R2 via r2_key.
 */

export async function handleEmailApiRequest(request, env, ctx) {
  const url = new URL(request.url);
  const pathname = url.pathname;

  // Set standard JSON/CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Range, Authorization, Accept'
  };

  // Handle CORS Preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // ---------------------------------------------------------------------------
  // 1. GET /api/emails (Paginated list of email metadata sorted by date)
  // ---------------------------------------------------------------------------
  if (pathname === '/api/emails' && request.method === 'GET') {
    if (!env.DB || typeof env.DB.prepare !== 'function') {
      return jsonResponse({ success: false, error: 'env.DB binding not configured' }, 500, corsHeaders);
    }

    try {
      const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
      const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '20', 10)));
      const offset = (page - 1) * limit;

      const threadId = url.searchParams.get('thread_id');
      const direction = url.searchParams.get('direction');
      const classification = url.searchParams.get('classification');
      const search = url.searchParams.get('search');

      const whereClauses = [];
      const bindings = [];

      if (threadId) {
        whereClauses.push('thread_id = ?');
        bindings.push(threadId);
      }
      if (direction) {
        whereClauses.push('direction = ?');
        bindings.push(direction);
      }
      if (classification) {
        whereClauses.push('classification = ?');
        bindings.push(classification);
      }
      if (search) {
        whereClauses.push('(subject LIKE ? OR sender LIKE ? OR recipient LIKE ? OR body_text LIKE ?)');
        bindings.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
      }

      const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

      // Count query for pagination
      const countRes = await env.DB.prepare(`SELECT COUNT(*) AS total FROM emails ${whereSql}`).bind(...bindings).first();
      const total = countRes ? countRes.total : 0;
      const totalPages = Math.ceil(total / limit) || 1;

      // Select records sorted by created_at DESC
      const dataSql = `
        SELECT 
          id, thread_id, direction, sender, recipient, subject,
          message_id, in_reply_to, raw_eml_key, ai_summary, classification, created_at,
          SUBSTR(COALESCE(body_text, ''), 1, 200) AS snippet,
          (SELECT COUNT(*) FROM attachments WHERE email_id = emails.id) AS attachment_count
        FROM emails
        ${whereSql}
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
      `;

      const { results } = await env.DB.prepare(dataSql).bind(...bindings, limit, offset).all();

      return jsonResponse({
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
      }, 200, corsHeaders);

    } catch (err) {
      console.error('[API Native] GET /api/emails failed:', err);
      return jsonResponse({ success: false, error: err.message }, 500, corsHeaders);
    }
  }

  // ---------------------------------------------------------------------------
  // 2. GET /api/emails/:id (Metadata + Raw .EML Payload from R2)
  // ---------------------------------------------------------------------------
  const singleEmailMatch = pathname.match(/^\/api\/emails\/([a-zA-Z0-9_\-]+)$/);
  if (singleEmailMatch && request.method === 'GET') {
    const emailId = singleEmailMatch[1];
    const db = env.DB;
    const bucket = env.CRM_BUCKET || env.MY_BUCKET || env.EMAIL_BUCKET;

    if (!db) {
      return jsonResponse({ success: false, error: 'env.DB binding not configured' }, 500, corsHeaders);
    }

    try {
      // 2.1 Fetch metadata from D1
      const email = await db.prepare(`
        SELECT 
          e.id, e.thread_id, e.direction, e.sender, e.recipient, e.subject,
          e.body_text, e.body_html, e.message_id, e.in_reply_to, e.raw_eml_key,
          e.ai_summary, e.classification, e.created_at,
          t.status AS thread_status, t.contact_id
        FROM emails e
        LEFT JOIN email_threads t ON e.thread_id = t.id
        WHERE e.id = ?
        LIMIT 1
      `).bind(emailId).first();

      if (!email) {
        return jsonResponse({ success: false, error: `Email '${emailId}' not found` }, 404, corsHeaders);
      }

      // 2.2 Fetch attachments from D1
      const { results: attachments } = await db.prepare(`
        SELECT id, filename, mime_type, r2_key, size_bytes, content_disposition, created_at
        FROM attachments WHERE email_id = ? ORDER BY created_at ASC
      `).bind(emailId).all();

      // 2.3 Retrieve raw .eml payload from R2 using r2_key
      const rawEmlKey = email.raw_eml_key || `raw_emails/${emailId}.eml`;
      let r2Object = null;
      let rawEmlPayload = null;

      if (bucket && typeof bucket.get === 'function') {
        try {
          r2Object = await bucket.get(rawEmlKey);
          if (!r2Object && !email.raw_eml_key) {
            const dateStr = email.created_at.slice(0, 7).replace('-', '/');
            r2Object = await bucket.get(`raw_emails/${dateStr}/${emailId}.eml`);
          }
        } catch (r2Err) {
          console.warn(`[API Native] R2 fetch error for ${rawEmlKey}:`, r2Err.message);
        }
      }

      // Stream raw .eml file if requested directly (?format=raw or Accept: message/rfc822)
      const wantsRaw = url.searchParams.get('format') === 'raw' || (request.headers.get('accept') || '').includes('message/rfc822');
      if (wantsRaw && r2Object && r2Object.body) {
        const streamHeaders = new Headers(corsHeaders);
        streamHeaders.set('Content-Type', 'message/rfc822; charset=utf-8');
        streamHeaders.set('Content-Disposition', `inline; filename="${email.subject || emailId}.eml"`);
        return new Response(r2Object.body, { headers: streamHeaders });
      }

      if (r2Object && r2Object.body) {
        rawEmlPayload = await r2Object.text();
      }

      return jsonResponse({
        success: true,
        data: {
          ...email,
          r2_key: rawEmlKey,
          r2_found: Boolean(r2Object),
          attachments: attachments || [],
          raw_eml_payload: rawEmlPayload
        }
      }, 200, corsHeaders);

    } catch (err) {
      console.error(`[API Native] GET /api/emails/${emailId} failed:`, err);
      return jsonResponse({ success: false, error: err.message }, 500, corsHeaders);
    }
  }

  return null; // Route not matched by this router
}

function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...extraHeaders
    }
  });
}

export default { handleEmailApiRequest };
