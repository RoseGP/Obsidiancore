/**
 * Cloudflare Worker REST API for CRM Email System
 * 
 * Provides HTTP endpoints to interface with:
 *  - Cloudflare D1 Database (env.DB) for metadata querying and indexing
 *  - Cloudflare R2 Bucket (env.BUCKET) for raw payload and attachment storage
 * 
 * Endpoints implemented via standard URL parsing:
 *  1. GET /api/emails?page=1&limit=20 — Paginated metadata list ordered by date descending
 *  2. GET /api/emails/:id — Full email details (including parsed body text/HTML) via R2 key lookup
 *  3. GET /api/emails/:id/attachments/:filename — Streams attachment binary directly from R2
 * 
 * Features:
 *  - Robust CORS headers across all routes & OPTIONS preflight
 *  - Standard URL parsing (no external router dependency)
 *  - Strict TypeScript types, structured JSON responses, and resilient error handling
 */

// ============================================================================
// TYPE DEFINITIONS FOR CLOUDFLARE D1 & R2
// ============================================================================

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(colName?: string): Promise<T | null>;
  all<T = unknown>(): Promise<{ success: boolean; results: T[] }>;
  run(): Promise<{ success: boolean; meta?: { rows_written?: number } }>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

export interface R2HttpMetadata {
  contentType?: string;
  contentLanguage?: string;
  contentDisposition?: string;
  contentEncoding?: string;
  cacheControl?: string;
  cacheExpiry?: Date;
}

export interface R2Object {
  key: string;
  version: string;
  size: number;
  etag: string;
  httpEtag: string;
  uploaded: Date;
  httpMetadata?: R2HttpMetadata;
  customMetadata?: Record<string, string>;
}

export interface R2ObjectBody extends R2Object {
  body: ReadableStream;
  bodyUsed: boolean;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
  json<T = unknown>(): Promise<T>;
  blob(): Promise<Blob>;
  writeHttpMetadata(headers: Headers): void;
}

export interface R2Bucket {
  get(key: string, options?: { onlyIf?: Headers | { etagMatches?: string } }): Promise<R2ObjectBody | null>;
  put(
    key: string,
    value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob,
    options?: { httpMetadata?: R2HttpMetadata; customMetadata?: Record<string, string> }
  ): Promise<R2Object>;
  delete(keys: string | string[]): Promise<void>;
  head(key: string): Promise<R2Object | null>;
}

export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  API_KEY?: string; // Secure API Key for Bearer / X-API-Key authentication
  CRM_BUCKET?: R2Bucket; // Compatibility alias
  EMAIL_BUCKET?: R2Bucket; // Compatibility alias
  DEFAULT_CRM_ACCOUNT_ID?: string;
}

// ============================================================================
// AUTHENTICATION MIDDLEWARE
// ============================================================================

/**
 * Constant-time string equality comparison to prevent timing attacks
 */
export function timingSafeEqualStrings(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  if (aBytes.byteLength !== bBytes.byteLength) return false;
  let mismatch = 0;
  for (let i = 0; i < aBytes.byteLength; i++) {
    mismatch |= aBytes[i] ^ bBytes[i];
  }
  return mismatch === 0;
}

/**
 * Extracts auth token from Authorization: Bearer <token> or X-API-Key: <token>
 */
export function extractAuthToken(request: Request): string | null {
  const authHeader = request.headers.get('Authorization') || request.headers.get('authorization');
  if (authHeader) {
    const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
    if (bearerMatch && bearerMatch[1]) {
      const token = bearerMatch[1].trim();
      if (token.length > 0) return token;
    }
  }

  const apiKeyHeader = request.headers.get('X-API-Key') || request.headers.get('x-api-key');
  if (apiKeyHeader) {
    const token = apiKeyHeader.trim();
    if (token.length > 0) return token;
  }

  return null;
}

/**
 * Creates a standard 401 Unauthorized JSON Response
 */
export function createUnauthorizedResponse(message = 'Unauthorized: Missing or invalid API credentials.'): Response {
  return new Response(
    JSON.stringify(
      {
        success: false,
        error: 'Unauthorized',
        message,
        status: 401,
        help: 'Provide a valid Bearer token in the Authorization header (Authorization: Bearer <API_KEY>) or an X-API-Key header (X-API-Key: <API_KEY>).'
      },
      null,
      2
    ),
    {
      status: 401,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'WWW-Authenticate': 'Bearer error="invalid_token", error_description="The access token is missing or invalid"',
        ...CORS_HEADERS
      }
    }
  );
}

/**
 * Middleware: Validates incoming request against env.API_KEY
 * Returns null if authorized, or a 401 JSON Response if unauthorized.
 * Bypasses CORS preflight OPTIONS requests automatically.
 */
export function validateApiAuth(request: Request, env: { API_KEY?: string }): Response | null {
  // Always allow CORS preflight requests
  if (request.method.toUpperCase() === 'OPTIONS') {
    return null;
  }

  const expectedKey = env.API_KEY?.trim();

  // If server has no configured API key, reject with 401
  if (!expectedKey) {
    console.error('[Auth Middleware] env.API_KEY is missing or unconfigured on the server.');
    return createUnauthorizedResponse('Unauthorized: Server API Key is not configured.');
  }

  const providedToken = extractAuthToken(request);

  if (!providedToken) {
    return createUnauthorizedResponse('Unauthorized: No authentication credentials provided.');
  }

  const isValid = timingSafeEqualStrings(providedToken, expectedKey);

  if (!isValid) {
    return createUnauthorizedResponse('Unauthorized: Invalid API Key or token provided.');
  }

  return null;
}

// ============================================================================
// DATA MODELS & INTERFACES
// ============================================================================

export interface EmailMetadataRow {
  id: string;
  thread_id?: string;
  direction?: 'inbound' | 'outbound';
  sender: string;
  recipient: string;
  subject: string;
  created_at: string;
  message_id?: string | null;
  in_reply_to?: string | null;
  raw_eml_key?: string | null;
  r2_key?: string | null;
  ai_summary?: string | null;
  classification?: string | null;
  body_text?: string | null;
  body_html?: string | null;
}

export interface AttachmentRow {
  id: string;
  email_id: string;
  filename: string;
  mime_type: string;
  r2_key: string;
  size_bytes: number;
  content_disposition?: string | null;
  created_at?: string;
}

export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

export interface SingleItemResponse<T> {
  success: boolean;
  data: T;
}

export interface ErrorResponse {
  success: false;
  error: string;
  details?: string;
  status: number;
}

// ============================================================================
// CORS & HTTP HELPER UTILITIES
// ============================================================================

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, HEAD',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Range, X-Requested-With, Accept',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Content-Disposition, ETag',
  'Access-Control-Max-Age': '86400',
};

/**
 * Creates a standard JSON Response with status and pre-configured CORS headers
 */
function jsonResponse(data: unknown, status: number = 200, customHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...CORS_HEADERS,
      ...customHeaders
    }
  });
}

/**
 * Creates a structured JSON Error Response
 */
function errorResponse(message: string, status: number = 400, details?: string): Response {
  const payload: ErrorResponse = {
    success: false,
    error: message,
    status
  };
  if (details) {
    payload.details = details;
  }
  return jsonResponse(payload, status);
}

/**
 * Returns MIME type based on file extension fallback
 */
function getMimeTypeFromFilename(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  const mimeMap: Record<string, string> = {
    pdf: 'application/pdf',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    webp: 'image/webp',
    txt: 'text/plain; charset=utf-8',
    html: 'text/html; charset=utf-8',
    css: 'text/css; charset=utf-8',
    js: 'application/javascript',
    json: 'application/json',
    zip: 'application/zip',
    csv: 'text/csv; charset=utf-8',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    eml: 'message/rfc822'
  };
  return (ext && mimeMap[ext]) || 'application/octet-stream';
}

/**
 * Safely resolves the active R2 bucket binding
 */
function resolveBucket(env: Env): R2Bucket | null {
  return env.BUCKET || env.CRM_BUCKET || env.EMAIL_BUCKET || null;
}

// ============================================================================
// ROUTE HANDLERS
// ============================================================================

/**
 * Route 1: GET /api/emails?page=1&limit=20
 * 
 * Returns a paginated list of email metadata (ID, sender, recipient, subject, received_at)
 * ordered by date descending.
 */
async function handleListEmails(url: URL, env: Env): Promise<Response> {
  const pageParam = parseInt(url.searchParams.get('page') || '1', 10);
  const limitParam = parseInt(url.searchParams.get('limit') || '20', 10);
  const classificationParam = url.searchParams.get('classification');
  const searchParam = url.searchParams.get('search');

  const page = isNaN(pageParam) || pageParam < 1 ? 1 : pageParam;
  const limit = isNaN(limitParam) || limitParam < 1 ? 20 : Math.min(limitParam, 100);
  const offset = (page - 1) * limit;

  // Build dynamic WHERE clause based on filters
  const conditions: string[] = [];
  const bindings: unknown[] = [];

  if (classificationParam) {
    conditions.push('classification = ? COLLATE NOCASE');
    bindings.push(classificationParam);
  }

  if (searchParam && searchParam.trim().length > 0) {
    const term = `%${searchParam.trim()}%`;
    conditions.push('(subject LIKE ? OR sender LIKE ? OR recipient LIKE ? OR body_text LIKE ?)');
    bindings.push(term, term, term, term);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // 1. Get total record count for pagination calculation
  const countQuery = `SELECT COUNT(*) AS total FROM emails ${whereClause}`;
  const countResult = bindings.length > 0 
    ? await env.DB.prepare(countQuery).bind(...bindings).first<{ total: number }>()
    : await env.DB.prepare(countQuery).bind().first<{ total: number }>();
  
  const total = countResult?.total || 0;
  const totalPages = Math.ceil(total / limit) || 1;

  // 2. Fetch paginated records ordered by date descending
  const listQuery = `
    SELECT 
      id,
      sender,
      recipient,
      subject,
      created_at AS received_at,
      thread_id,
      direction,
      message_id,
      in_reply_to,
      r2_key,
      raw_eml_key,
      ai_summary,
      classification
    FROM emails
    ${whereClause}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `;

  const listBindings = [...bindings, limit, offset];
  const { results: rows } = await env.DB.prepare(listQuery).bind(...listBindings).all<EmailMetadataRow & { received_at: string }>();

  // Format records with clean fallback values
  const formattedData = (rows || []).map((row) => ({
    id: row.id,
    sender: row.sender,
    recipient: row.recipient,
    subject: row.subject || '(No Subject)',
    received_at: row.received_at || row.created_at,
    thread_id: row.thread_id || null,
    direction: row.direction || 'inbound',
    classification: row.classification || 'Important',
    ai_summary: row.ai_summary || null,
    message_id: row.message_id || null,
    in_reply_to: row.in_reply_to || null,
    r2_key: row.r2_key || row.raw_eml_key || null
  }));

  const responsePayload: PaginatedResponse<typeof formattedData[number]> = {
    success: true,
    data: formattedData,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1
    }
  };

  return jsonResponse(responsePayload, 200, {
    'Cache-Control': 'public, max-age=15, s-maxage=30'
  });
}

/**
 * Route 2: GET /api/emails/:id
 * 
 * Fetches the full email details (including parsed body text/HTML) stored in R2
 * by looking up the r2_key from D1.
 */
async function handleGetEmailById(emailId: string, env: Env): Promise<Response> {
  const bucket = resolveBucket(env);

  // 1. Fetch metadata row from D1
  const emailRow = await env.DB.prepare(`
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
      e.r2_key,
      e.ai_summary,
      e.classification,
      e.created_at,
      e.created_at AS received_at,
      t.status AS thread_status,
      t.contact_id
    FROM emails e
    LEFT JOIN email_threads t ON e.thread_id = t.id
    WHERE e.id = ?
    LIMIT 1
  `).bind(emailId).first<EmailMetadataRow & { thread_status?: string; contact_id?: string; received_at?: string }>();

  if (!emailRow) {
    return errorResponse(`Email with ID '${emailId}' was not found in the database.`, 404);
  }

  // 2. Fetch associated attachment records from D1
  const { results: attachmentRows } = await env.DB.prepare(`
    SELECT 
      id,
      email_id,
      filename,
      mime_type,
      r2_key,
      size_bytes,
      content_disposition,
      created_at
    FROM attachments
    WHERE email_id = ?
    ORDER BY created_at ASC
  `).bind(emailId).all<AttachmentRow>();

  // 3. Resolve R2 key and fetch payload from R2 bucket
  const primaryR2Key = emailRow.r2_key || emailRow.raw_eml_key;
  let bodyText = emailRow.body_text || '';
  let bodyHtml = emailRow.body_html || '';
  let r2Found = false;
  let rawEmlPayload: string | null = null;

  if (bucket) {
    // List candidate storage keys in priority order
    const candidateKeys = [
      primaryR2Key,
      `emails/${emailId}.json`,
      `raw_emails/${emailId}.eml`,
      `emails/${emailId}.eml`,
      `raw_emails/${(emailRow.created_at || '').slice(0, 7).replace('-', '/')}/${emailId}.eml`
    ].filter((k): k is string => Boolean(k && k.trim().length > 0));

    for (const key of candidateKeys) {
      try {
        const r2Object = await bucket.get(key);
        if (r2Object) {
          r2Found = true;
          const contentType = r2Object.httpMetadata?.contentType || '';

          if (key.endsWith('.json') || contentType.includes('application/json')) {
            // Parsed JSON storage structure
            const jsonData = await r2Object.json<{ body_text?: string; body_html?: string; text?: string; html?: string }>();
            bodyText = jsonData.body_text || jsonData.text || bodyText;
            bodyHtml = jsonData.body_html || jsonData.html || bodyHtml;
          } else {
            // Raw .eml text stream
            rawEmlPayload = await r2Object.text();
            
            // If body text/html is not in D1, extract from raw EML text if available
            if (!bodyText && rawEmlPayload) {
              const bodyBoundaryMatch = rawEmlPayload.split(/\r?\n\r?\n/);
              if (bodyBoundaryMatch.length > 1) {
                bodyText = bodyBoundaryMatch.slice(1).join('\n\n').slice(0, 5000);
              }
            }
          }
          break;
        }
      } catch (r2Err) {
        console.warn(`[API Warning] Error fetching key '${key}' from R2:`, (r2Err as Error).message);
      }
    }
  }

  // 4. Return unified JSON structure
  const responseData = {
    id: emailRow.id,
    thread_id: emailRow.thread_id || null,
    contact_id: emailRow.contact_id || null,
    thread_status: emailRow.thread_status || 'open',
    direction: emailRow.direction || 'inbound',
    sender: emailRow.sender,
    recipient: emailRow.recipient,
    subject: emailRow.subject || '(No Subject)',
    received_at: emailRow.received_at || emailRow.created_at,
    body_text: bodyText,
    body_html: bodyHtml,
    message_id: emailRow.message_id || null,
    in_reply_to: emailRow.in_reply_to || null,
    ai_summary: emailRow.ai_summary || null,
    classification: emailRow.classification || 'Important',
    r2_key: primaryR2Key || null,
    r2_stored: r2Found,
    attachments: (attachmentRows || []).map((att) => ({
      id: att.id,
      filename: att.filename,
      mime_type: att.mime_type || getMimeTypeFromFilename(att.filename),
      size_bytes: att.size_bytes,
      r2_key: att.r2_key,
      download_url: `/api/emails/${emailId}/attachments/${encodeURIComponent(att.filename)}`
    })),
    raw_eml_payload: rawEmlPayload
  };

  return jsonResponse({
    success: true,
    data: responseData
  }, 200, {
    'Cache-Control': 'public, max-age=60, s-maxage=120'
  });
}

/**
 * Route 3: GET /api/emails/:id/attachments/:filename
 * 
 * Streams a specific file attachment directly out of the R2 storage object.
 */
async function handleStreamAttachment(
  emailId: string, 
  rawFilename: string, 
  request: Request,
  env: Env
): Promise<Response> {
  const bucket = resolveBucket(env);
  if (!bucket) {
    return errorResponse('R2 Storage Bucket (env.BUCKET) is not configured on this Worker.', 500);
  }

  const filename = decodeURIComponent(rawFilename);

  // 1. Look up attachment in D1 to verify permissions and retrieve exact r2_key
  const attachment = await env.DB.prepare(`
    SELECT 
      id,
      email_id,
      filename,
      mime_type,
      r2_key,
      size_bytes,
      content_disposition
    FROM attachments
    WHERE email_id = ? AND (filename = ? OR id = ? OR r2_key LIKE ?)
    LIMIT 1
  `).bind(emailId, filename, filename, `%${filename}`).first<AttachmentRow>();

  // 2. Resolve R2 key candidates
  const candidateKeys = [
    attachment?.r2_key,
    `attachments/${emailId}/${filename}`,
    `attachments/${filename}`,
    filename
  ].filter((k): k is string => Boolean(k && k.trim().length > 0));

  let r2Object: R2ObjectBody | null = null;
  let resolvedKey: string | null = null;

  for (const key of candidateKeys) {
    try {
      r2Object = await bucket.get(key);
      if (r2Object) {
        resolvedKey = key;
        break;
      }
    } catch (err) {
      console.warn(`[R2 Stream Warning] Failed checking R2 key '${key}':`, (err as Error).message);
    }
  }

  if (!r2Object || !r2Object.body) {
    return errorResponse(
      `Attachment '${filename}' for email '${emailId}' was not found in R2 storage.`,
      404
    );
  }

  // 3. Construct streaming response headers
  const headers = new Headers();

  // Apply stored R2 HTTP metadata if available
  if (typeof r2Object.writeHttpMetadata === 'function') {
    r2Object.writeHttpMetadata(headers);
  }

  // Set Content-Type
  const mimeType = attachment?.mime_type || r2Object.httpMetadata?.contentType || getMimeTypeFromFilename(filename);
  headers.set('Content-Type', mimeType);

  // Set Content-Disposition (inline with UTF-8 safe filename)
  const safeFilename = filename.replace(/["\r\n]/g, '_');
  const encodedFilename = encodeURIComponent(filename);
  headers.set(
    'Content-Disposition',
    `inline; filename="${safeFilename}"; filename*=UTF-8''${encodedFilename}`
  );

  // Content Length & ETag
  if (r2Object.size) {
    headers.set('Content-Length', r2Object.size.toString());
  }
  if (r2Object.httpEtag) {
    headers.set('ETag', r2Object.httpEtag);
  }

  // Cache headers for immutable binary attachments
  headers.set('Cache-Control', 'public, max-age=86400, s-maxage=604800, immutable');
  
  // Apply CORS headers
  for (const [k, v] of Object.entries(CORS_HEADERS)) {
    headers.set(k, v);
  }

  // Support conditional GET / 304 Not Modified
  const ifNoneMatch = request.headers.get('if-none-match');
  if (ifNoneMatch && r2Object.httpEtag && ifNoneMatch === r2Object.httpEtag) {
    return new Response(null, { status: 304, headers });
  }

  return new Response(r2Object.body, {
    status: 200,
    headers
  });
}

// ============================================================================
// MAIN WORKER FETCH DISPATCHER
// ============================================================================

export default {
  /**
   * Main HTTP Fetch Handler
   */
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // 1. Handle CORS Preflight OPTIONS requests
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS
      });
    }

    try {
      // 2. Route Protection: Apply Auth Middleware to all /api/ endpoints
      const url = new URL(request.url);
      const pathname = url.pathname;

      if (pathname.startsWith('/api/')) {
        const authResponse = validateApiAuth(request, env);
        if (authResponse) {
          return authResponse;
        }
      }

      // 3. Validate database binding
      if (!env.DB) {
        return errorResponse('D1 Database binding (env.DB) is missing or unconfigured.', 500);
      }

      const method = request.method.toUpperCase();

      // Ensure method is GET or HEAD
      if (method !== 'GET' && method !== 'HEAD') {
        return errorResponse(`Method ${method} is not allowed on this endpoint.`, 405);
      }

      // -----------------------------------------------------------------------
      // Route 1: GET /api/emails?page=1&limit=20
      // -----------------------------------------------------------------------
      if (pathname === '/api/emails' || pathname === '/api/emails/') {
        return await handleListEmails(url, env);
      }

      // -----------------------------------------------------------------------
      // Route 3: GET /api/emails/:id/attachments/:filename
      // (Check attachment sub-route before single email detail)
      // -----------------------------------------------------------------------
      const attachmentMatch = pathname.match(/^\/api\/emails\/([^/]+)\/attachments\/(.+)$/);
      if (attachmentMatch) {
        const emailId = attachmentMatch[1];
        const filename = attachmentMatch[2];
        return await handleStreamAttachment(emailId, filename, request, env);
      }

      // -----------------------------------------------------------------------
      // Route 2: GET /api/emails/:id
      // -----------------------------------------------------------------------
      const emailDetailMatch = pathname.match(/^\/api\/emails\/([^/]+)$/);
      if (emailDetailMatch) {
        const emailId = emailDetailMatch[1];
        return await handleGetEmailById(emailId, env);
      }

      // -----------------------------------------------------------------------
      // Health Check / Root endpoint
      // -----------------------------------------------------------------------
      if (pathname === '/' || pathname === '/api/health') {
        return jsonResponse({
          status: 'healthy',
          service: 'CRM Email REST API Worker (TypeScript)',
          endpoints: [
            'GET /api/emails?page=1&limit=20',
            'GET /api/emails/:id',
            'GET /api/emails/:id/attachments/:filename'
          ],
          timestamp: new Date().toISOString()
        });
      }

      // -----------------------------------------------------------------------
      // 404 Route Not Found
      // -----------------------------------------------------------------------
      return errorResponse(`Endpoint not found: ${pathname}`, 404);

    } catch (fatalError) {
      console.error('[API Fatal Error]:', fatalError);
      return errorResponse(
        'An internal server error occurred while processing the request.',
        500,
        (fatalError as Error).message || String(fatalError)
      );
    }
  }
};
