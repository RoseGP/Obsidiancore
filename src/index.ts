/**
 * Cloudflare Worker Service Entrypoint:
 * - Cloudflare Email Routing & Inbound Parsing with postal-mime
 * - Cloudflare Workers AI (@cf/meta/llama-3-8b-instruct) Email Summarization (concise 2-sentence summary)
 * - Cloudflare Workers AI 4-way Category Classification (Important, Newsletter, Billing, Spam)
 * - Cloudflare D1 Database schema storage (summary & category columns) & R2 MIME storage
 * - Phase 3: Securing the REST API (Zero-Trust & API Key Authentication)
 * - WebRTC Turn Credentials & Durable Object Voice Assistant Broker
 */

import PostalMime, { Email as PostalMimeEmail } from "postal-mime";
import { CRMVoiceAssistant } from "./agent";
import { validateApiAuth as requireApiKey, type AuthEnv } from "./workers/authMiddleware";
import { attachmentUrlSecret, validateOutboundEmail } from "./workers/outboundEmail";

export { CRMVoiceAssistant };

// ============================================================================
// CLOUDFLARE BINDINGS & TYPE DEFINITIONS
// ============================================================================

export interface D1PreparedStatement {
  bind(...values: any[]): D1PreparedStatement;
  first<T = unknown>(colName?: string): Promise<T | null>;
  all<T = unknown>(): Promise<{ success: boolean; results: T[] }>;
  run(): Promise<{ success: boolean; meta?: { rows_written?: number } }>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

export interface R2Object {
  key: string;
  size: number;
  etag: string;
}

export interface R2ObjectBody {
  body: ReadableStream;
  key: string;
  size: number;
  etag: string;
  httpMetadata?: {
    contentType?: string;
    contentDisposition?: string;
  };
}

export interface R2Bucket {
  put(
    key: string,
    value: ReadableStream | ArrayBuffer | string | Blob | Uint8Array,
    options?: { httpMetadata?: { contentType?: string; contentDisposition?: string } }
  ): Promise<R2Object>;
  get(key: string): Promise<R2ObjectBody | null>;
}

export interface WorkersAiBinding {
  run(model: string, options: { prompt?: string; messages?: Array<{ role: string; content: string }> }): Promise<any>;
}

export interface ForwardableEmailMessage {
  readonly from: string;
  readonly to: string;
  readonly headers: Headers;
  readonly raw: ReadableStream;
  readonly rawSize: number;
  setReject(reason: string): void;
  forward(rcptTo: string, headers?: Headers): Promise<void>;
}

export interface ExecutionContext {
  waitUntil(promise: Promise<any>): void;
  passThroughOnException(): void;
}

export interface Env extends AuthEnv {
  DB: D1Database;
  EMAIL_BUCKET: R2Bucket;
  ATTACHMENTS_BUCKET?: R2Bucket;
  AI?: WorkersAiBinding;
  EMAIL?: any;
  API_KEY?: string;
  JWT_SECRET?: string;
  /** Signs attachment download links (falls back to JWT_SECRET); at least 32 characters. */
  ATTACHMENT_URL_SECRET?: string;
  CRM_VOICE_ASSISTANT?: any;
  REALTIME_INFRA?: any;
  FLAGSHIP?: any;
  INTERNAL_API_SECRET?: string;
  DOMAIN_NAME?: string;
}

export type EmailCategory = "Important" | "Newsletter" | "Billing" | "Spam";

export interface EmailAiAnalysisResult {
  summary: string;
  category: EmailCategory;
  classification?: EmailCategory;
}

export interface WebmailUserRecord {
  id: string;
  email: string;
}

export interface AttachmentRecord {
  id: string;
  email_id: string;
  user_id: string;
  filename: string;
  content_type: string;
  size: number;
  r2_key: string;
  download_url: string;
  created_at: string;
}

// ============================================================================
// CORS & HTTP UTILITIES
// ============================================================================

export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key, x-lead-id, x-zero-trust-token, cf-access-jwt-assertion",
  "Access-Control-Max-Age": "86400",
};

export function jsonResponse(data: any, status: number = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...CORS_HEADERS,
      ...extraHeaders,
    },
  });
}

// ============================================================================
// PHASE 3: SECURING THE API (ZERO-TRUST & API KEY AUTHENTICATION)
// ============================================================================

/**
 * API authentication for this worker. Every /api route (except the signed attachment download and health) and
 * the /connect WebSocket need the API key: MASTER_API_KEY (or legacy API_KEY), with MASTER_API_KEY_PREVIOUS
 * during a rotation, compared in constant time; no key configured → 503 (src/workers/authMiddleware.ts).
 *
 * This replaced checks that accepted ANY non-empty Authorization value, two hard-coded tokens, any non-JWT
 * string, and unsigned JWTs with whatever claims they carried.
 */
export class ZeroTrustGuard {
  static async verifyAssertion(request: Request, env?: Env): Promise<{ authenticated: boolean; claims?: any; error?: string }> {
    const denied = await requireApiKey(request, env ?? ({} as Env));
    if (denied) return { authenticated: false, error: denied.status === 503 ? "The API is not configured yet." : "A valid API key is required." };
    return { authenticated: true, claims: { role: "service" } };
  }
}

/** null when the request carries a valid API key, otherwise the 401/503 response (with this worker's CORS headers). */
export async function validateApiAuth(request: Request, env: Env): Promise<{ authenticated: boolean; response?: Response }> {
  if (request.method === "OPTIONS") return { authenticated: true };
  const denied = await requireApiKey(request, env);
  if (!denied) return { authenticated: true };
  return { authenticated: false, response: jsonResponse(await denied.json(), denied.status, { "WWW-Authenticate": 'Bearer realm="api"' }) };
}

// ============================================================================
// PRESIGNED URL CRYPTO ENGINE (HMAC SHA-256)
// ============================================================================

export async function generatePresignedDownloadUrl(
  attachmentId: string,
  secret: string,
  baseUrl: string,
  expiresInSeconds: number = 86400
): Promise<string> {
  const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const dataToSign = `${attachmentId}:${expiresAt}`;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signatureBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(dataToSign)
  );

  const sigBytes = new Uint8Array(signatureBuffer);
  let binary = "";
  for (let i = 0; i < sigBytes.byteLength; i++) {
    binary += String.fromCharCode(sigBytes[i]);
  }
  const signature = btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const cleanBaseUrl = baseUrl.replace(/\/$/, "");
  return `${cleanBaseUrl}/api/attachments/download?id=${attachmentId}&expires=${expiresAt}&sig=${signature}`;
}

export async function verifyPresignedDownloadSignature(
  attachmentId: string,
  expiresAt: number,
  signature: string,
  secret: string
): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  if (now > expiresAt) {
    return false;
  }

  const dataToSign = `${attachmentId}:${expiresAt}`;
  const encoder = new TextEncoder();

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );

  let base64 = signature.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) base64 += "=";

  const binaryStr = atob(base64);
  const sigBytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    sigBytes[i] = binaryStr.charCodeAt(i);
  }

  return await crypto.subtle.verify(
    "HMAC",
    key,
    sigBytes,
    encoder.encode(dataToSign)
  );
}

// ============================================================================
// WORKERS AI: @cf/meta/llama-3-8b-instruct SUMMARIZATION & 4-WAY CLASSIFIER
// ============================================================================

/**
 * Runs Cloudflare Workers AI (@cf/meta/llama-3-8b-instruct) on incoming email body:
 * 1. Generates a concise 2-sentence summary of the email body.
 * 2. Classifies email sentiment/category into: "Important", "Newsletter", "Billing", or "Spam".
 */
export async function analyzeEmailWithWorkersAi(
  bodyText: string,
  subject: string,
  sender: string,
  env: Env
): Promise<EmailAiAnalysisResult> {
  // Heuristic rule-based fallback classification
  const lower = (bodyText + " " + subject + " " + sender).toLowerCase();
  let fallbackCategory: EmailCategory = "Important";
  if (
    lower.includes("unsubscribe") || 
    lower.includes("newsletter") || 
    lower.includes("weekly digest") || 
    lower.includes("edition #") || 
    lower.includes("roundup") || 
    lower.includes("mailer-daemon") ||
    lower.includes("no-reply@news")
  ) {
    fallbackCategory = "Newsletter";
  } else if (
    lower.includes("invoice") || 
    lower.includes("receipt") || 
    lower.includes("billing") || 
    lower.includes("payment due") || 
    lower.includes("subscription renewed") || 
    lower.includes("charge on card") ||
    lower.includes("stripe receipt") ||
    lower.includes("statement")
  ) {
    fallbackCategory = "Billing";
  } else if (
    lower.includes("viagra") || 
    lower.includes("lottery") || 
    lower.includes("crypto guarantee") || 
    lower.includes("claim your prize") || 
    lower.includes("wire transfer urgent") ||
    lower.includes("inheritance funds")
  ) {
    fallbackCategory = "Spam";
  }

  const fallbackSummary = bodyText
    ? bodyText.substring(0, 160).replace(/\s+/g, " ").trim() + (bodyText.length > 160 ? "..." : "")
    : `Inbound communication from ${sender} regarding ${subject}.`;

  const fallbackResult: EmailAiAnalysisResult = {
    summary: fallbackSummary,
    category: fallbackCategory,
    classification: fallbackCategory
  };

  if (!env.AI || typeof env.AI.run !== "function") {
    return fallbackResult;
  }

  try {
    const prompt = `You are an automated Email Intelligence Agent. Analyze the following inbound email:
Sender: ${sender}
Subject: ${subject}
Email Body:
${bodyText.substring(0, 2500)}

Task Requirements:
1. Generate an exact concise 2-sentence summary of the email body.
2. Classify the email sentiment or category into exactly ONE of the following 4 categories:
   - "Important"
   - "Newsletter"
   - "Billing"
   - "Spam"

Return ONLY valid JSON matching this exact schema with NO markdown and NO additional text:
{
  "summary": "First concise sentence of summary. Second concise sentence of summary.",
  "category": "Important"
}`;

    const aiResponse = await env.AI.run("@cf/meta/llama-3-8b-instruct", {
      prompt,
    });

    const responseText = aiResponse?.response || (typeof aiResponse === "string" ? aiResponse : "");
    if (responseText) {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        const validCategories: EmailCategory[] = ["Important", "Newsletter", "Billing", "Spam"];
        let assignedCategory: EmailCategory = fallbackCategory;

        if (parsed.category && validCategories.includes(parsed.category)) {
          assignedCategory = parsed.category;
        } else if (parsed.classification && validCategories.includes(parsed.classification)) {
          assignedCategory = parsed.classification;
        }

        const finalSummary = (parsed.summary || fallbackSummary).trim();

        return {
          summary: finalSummary,
          category: assignedCategory,
          classification: assignedCategory,
        };
      }
    }
  } catch (aiErr: any) {
    console.warn(`[Workers AI Classifier Warning] Failed to run @cf/meta/llama-3-8b-instruct: ${aiErr.message || aiErr}`);
  }

  return fallbackResult;
}

// ============================================================================
// HELPER UTILITIES
// ============================================================================

function normalizeEmail(email: string): string {
  return (email || "").toLowerCase().trim();
}

function extractOrGenerateMessageId(headers: Headers): string {
  const msgIdHeader = headers.get("message-id") || headers.get("Message-ID");
  if (msgIdHeader) {
    const cleanId = msgIdHeader.replace(/^<|>$/g, "").trim();
    if (cleanId) return cleanId;
  }
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return `msg_${crypto.randomUUID()}`;
  }
  return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

// ============================================================================
// REST API ROUTE HANDLERS
// ============================================================================

async function handleGetEmailsList(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url);
    const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "20", 10)));
    const offset = (page - 1) * limit;
    const userId = url.searchParams.get("userId");
    const category = url.searchParams.get("category");

    if (!env.DB) {
      return jsonResponse({ success: false, error: "D1 database binding missing" }, 500);
    }

    let countQuery = `SELECT COUNT(*) as total FROM messages WHERE direction = 'inbound'`;
    let selectQuery = `
      SELECT id, user_id, sender, recipient, subject, snippet, summary, category, classification_tag, created_at as received_at, is_read
      FROM messages
      WHERE direction = 'inbound'
    `;
    const params: any[] = [];

    if (userId) {
      countQuery += ` AND user_id = ?`;
      selectQuery += ` AND user_id = ?`;
      params.push(userId);
    }

    if (category) {
      countQuery += ` AND (category = ? OR classification_tag = ?)`;
      selectQuery += ` AND (category = ? OR classification_tag = ?)`;
      params.push(category, category);
    }

    selectQuery += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;

    const countResult = await env.DB.prepare(countQuery).bind(...params).first<{ total: number }>();
    const total = countResult?.total || 0;

    const { results } = await env.DB.prepare(selectQuery).bind(...params, limit, offset).all();

    return jsonResponse({
      success: true,
      emails: results || [],
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
        hasMore: page * limit < total,
      },
    });
  } catch (err: any) {
    return jsonResponse({ success: false, error: err.message }, 500);
  }
}

async function handleGetEmailById(request: Request, env: Env, emailId: string): Promise<Response> {
  try {
    if (!env.DB) {
      return jsonResponse({ success: false, error: "D1 database binding missing" }, 500);
    }

    const messageRecord = await env.DB.prepare(
      `SELECT id, user_id, sender, recipient, subject, snippet, summary, category, classification_tag, r2_object_key, is_read, created_at FROM messages WHERE id = ? LIMIT 1`
    ).bind(emailId).first<any>();

    if (!messageRecord) {
      return jsonResponse({ success: false, error: `Email with ID "${emailId}" not found in D1` }, 404);
    }

    const r2Key = messageRecord.r2_object_key;
    let bodyText = "";
    let bodyHtml = "";
    let parsedAttachments: any[] = [];

    if (r2Key && env.EMAIL_BUCKET) {
      const r2Object = await env.EMAIL_BUCKET.get(r2Key);
      if (r2Object) {
        const rawArrayBuffer = await new Response(r2Object.body).arrayBuffer();
        try {
          const parser = new PostalMime();
          const parsed = await parser.parse(rawArrayBuffer);
          bodyText = parsed.text || "";
          bodyHtml = parsed.html || "";
          if (parsed.attachments) {
            parsedAttachments = parsed.attachments.map((att, idx) => ({
              filename: att.filename || `attachment_${idx + 1}`,
              mimeType: att.mimeType,
              size: typeof att.content === "string" ? att.content.length : (att.content as ArrayBuffer).byteLength || 0,
            }));
          }
        } catch (e: any) {
          bodyText = messageRecord.snippet || "";
        }
      }
    }

    const { results: d1Attachments } = await env.DB.prepare(
      `SELECT id, filename, content_type, size, download_url FROM attachments WHERE email_id = ?`
    ).bind(emailId).all();

    return jsonResponse({
      success: true,
      email: {
        ...messageRecord,
        bodyText: bodyText || messageRecord.snippet || "",
        bodyHtml: bodyHtml || `<p>${bodyText || messageRecord.snippet || ""}</p>`,
        attachments: (d1Attachments && d1Attachments.length > 0) ? d1Attachments : parsedAttachments,
      },
    });
  } catch (err: any) {
    return jsonResponse({ success: false, error: err.message }, 500);
  }
}

async function handleStreamAttachment(
  request: Request,
  env: Env,
  emailId: string,
  filename: string
): Promise<Response> {
  try {
    if (!env.DB) {
      return jsonResponse({ success: false, error: "D1 database binding missing" }, 500);
    }

    const decodedFilename = decodeURIComponent(filename);

    const attRecord = await env.DB.prepare(
      `SELECT id, filename, content_type, size, r2_key FROM attachments WHERE email_id = ? AND filename = ? LIMIT 1`
    ).bind(emailId, decodedFilename).first<AttachmentRecord>();

    let r2Key = attRecord?.r2_key;
    let contentType = attRecord?.content_type || "application/octet-stream";
    let size = attRecord?.size;

    const bucket = env.ATTACHMENTS_BUCKET || env.EMAIL_BUCKET;
    if (!bucket) {
      return jsonResponse({ success: false, error: "R2 bucket binding missing" }, 500);
    }

    if (!r2Key) {
      const messageRecord = await env.DB.prepare(
        `SELECT r2_object_key FROM messages WHERE id = ? LIMIT 1`
      ).bind(emailId).first<{ r2_object_key: string }>();

      if (!messageRecord || !messageRecord.r2_object_key) {
        return jsonResponse({ success: false, error: `Email ID "${emailId}" not found` }, 404);
      }

      const emailObj = await env.EMAIL_BUCKET.get(messageRecord.r2_object_key);
      if (!emailObj) {
        return jsonResponse({ success: false, error: "Raw email payload missing from R2" }, 404);
      }

      const rawBuffer = await new Response(emailObj.body).arrayBuffer();
      const parser = new PostalMime();
      const parsed = await parser.parse(rawBuffer);

      const matchedAtt = parsed.attachments?.find(a => a.filename === decodedFilename);
      if (!matchedAtt) {
        return jsonResponse({ success: false, error: `Attachment "${decodedFilename}" not found in email "${emailId}"` }, 404);
      }

      return new Response(matchedAtt.content as any, {
        status: 200,
        headers: {
          "Content-Type": matchedAtt.mimeType || "application/octet-stream",
          "Content-Disposition": `attachment; filename="${encodeURIComponent(decodedFilename)}"`,
          ...CORS_HEADERS,
        },
      });
    }

    const r2Object = await bucket.get(r2Key);
    if (!r2Object) {
      return jsonResponse({ success: false, error: `Attachment object "${r2Key}" not found in R2` }, 404);
    }

    return new Response(r2Object.body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${encodeURIComponent(decodedFilename)}"`,
        "Content-Length": size ? size.toString() : "",
        ...CORS_HEADERS,
      },
    });
  } catch (err: any) {
    return jsonResponse({ success: false, error: err.message }, 500);
  }
}

async function handleAttachmentDownloadRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const attachmentId = url.searchParams.get("id");
  const expiresStr = url.searchParams.get("expires");
  const signature = url.searchParams.get("sig");

  if (!attachmentId || !expiresStr || !signature) {
    return jsonResponse({ success: false, error: "Missing required query parameters: id, expires, sig" }, 400);
  }

  const expiresAt = parseInt(expiresStr, 10);
  // No built-in fallback: without a configured secret, links can't be verified (they were forgeable before).
  const secretKey = attachmentUrlSecret(env);
  if (!secretKey) {
    return jsonResponse({ success: false, error: "Attachment downloads are not configured." }, 503);
  }
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(attachmentId) || !/^\d{1,12}$/.test(expiresStr) || !/^[A-Za-z0-9_\-+/=]{20,128}$/.test(signature)) {
    return jsonResponse({ success: false, error: "Invalid or expired attachment download presigned URL" }, 403);
  }

  const isValidSig = await verifyPresignedDownloadSignature(attachmentId, expiresAt, signature, secretKey);
  if (!isValidSig) {
    return jsonResponse({ success: false, error: "Invalid or expired attachment download presigned URL" }, 403);
  }

  if (!env.DB) {
    return jsonResponse({ success: false, error: "D1 database binding missing" }, 500);
  }

  const attRecord = await env.DB.prepare(
    `SELECT id, email_id, user_id, filename, content_type, size, r2_key FROM attachments WHERE id = ? LIMIT 1`
  ).bind(attachmentId).first<AttachmentRecord>();

  if (!attRecord) {
    return jsonResponse({ success: false, error: `Attachment ID "${attachmentId}" not found in D1` }, 404);
  }

  const bucket = env.ATTACHMENTS_BUCKET || env.EMAIL_BUCKET;
  if (!bucket) {
    return jsonResponse({ success: false, error: "R2 bucket binding missing" }, 500);
  }

  const r2Object = await bucket.get(attRecord.r2_key);
  if (!r2Object) {
    return jsonResponse({ success: false, error: `Binary object "${attRecord.r2_key}" not found in R2 bucket` }, 404);
  }

  return new Response(r2Object.body, {
    status: 200,
    headers: {
      "Content-Type": attRecord.content_type || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(attRecord.filename)}"`,
      "Content-Length": attRecord.size ? attRecord.size.toString() : "",
      "Cache-Control": "private, max-age=86400",
      ...CORS_HEADERS,
    },
  });
}

// ============================================================================
// MAIN CLOUDFLARE WORKER EXPORT
// ============================================================================

export default {
  /**
   * Cloudflare HTTP Fetch Event Handler (Phase 3: Securing the API & Telemetry Router)
   */
  async fetch(request: Request, env: Env, ctx: any): Promise<Response> {
    // 1. CORS Guard Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS,
      });
    }

    try {
      const url = new URL(request.url);
      const pathname = url.pathname;

      // 2. Validate API Security Middleware on protected /api routes (except presigned downloads)
      if (pathname.startsWith("/api/") && pathname !== "/api/attachments/download" && pathname !== "/api/health") {
        const auth = await validateApiAuth(request, env);
        if (!auth.authenticated) {
          return auth.response ?? jsonResponse({ success: false, error: "Unauthorized" }, 401);
        }
      }

      // 3. Route: GET /api/attachments/download (Presigned URL validation)
      if (pathname === "/api/attachments/download" && request.method === "GET") {
        return handleAttachmentDownloadRequest(request, env);
      }

      // 4. Route: GET /api/emails?page=1&limit=20
      if (pathname === "/api/emails" && request.method === "GET") {
        return handleGetEmailsList(request, env);
      }

      // 5. Route: GET /api/emails/:id/attachments/:filename
      const attMatch = pathname.match(/^\/api\/emails\/([^/]+)\/attachments\/(.+)$/);
      if (attMatch && request.method === "GET") {
        const [, emailId, filename] = attMatch;
        return handleStreamAttachment(request, env, emailId, filename);
      }

      // 6. Route: GET /api/emails/:id
      const emailMatch = pathname.match(/^\/api\/emails\/([^/]+)$/);
      if (emailMatch && request.method === "GET") {
        const [, emailId] = emailMatch;
        return handleGetEmailById(request, env, emailId);
      }

      // 7. Route: POST /api/send (Secure Outbound Email Dispatch)
      if (pathname === "/api/send" && request.method === "POST") {
        try {
          let body: unknown;
          try { body = await request.json(); } catch { return jsonResponse({ success: false, error: "Send a JSON body." }, 400); }
          // Strict allowlist validation: sender on our own domain, plain recipient addresses, one-line subject,
          // size limits. Values are never pasted into MIME headers unchecked (header injection).
          const checked = validateOutboundEmail(body, env.DOMAIN_NAME);
          if (!checked.ok) return jsonResponse({ success: false, error: checked.error }, 400);
          const { userId, from, to: recipientList, subject, text, html, threadId } = checked.value;
          const activeThreadId = threadId || (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `thread_${Date.now()}`);
          const emailId = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `email_${Date.now()}`;
          const messageId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

          if (env.DB) {
            await env.DB.prepare(
              `INSERT OR IGNORE INTO threads (id, subject) VALUES (?, ?)`
            ).bind(activeThreadId, subject || "(No Subject)").run();

            await env.DB.prepare(`
              INSERT INTO messages (id, user_id, direction, sender, recipient, subject, snippet, summary, category, classification_tag, r2_object_key, is_read, created_at)
              VALUES (?, ?, 'outbound', ?, ?, ?, ?, ?, 'Important', 'Important', '', 1, CURRENT_TIMESTAMP)
            `).bind(
              emailId,
              userId,
              from,
              recipientList.join(", "),
              subject || "(No Subject)",
              text || (html ? html.replace(/<[^>]*>/g, "") : ""),
              text || (html ? html.replace(/<[^>]*>/g, "") : "")
            ).run();
          }

          // Dispatch using Cloudflare Send Email binding if available
          let sendBindingResult: string = "skipped";
          if (env.EMAIL && typeof env.EMAIL.send === "function") {
            try {
              const boundary = `cf_mime_${Date.now()}`;
              let rawMime = `From: ${from}\r\n` +
                `To: ${recipientList.join(", ")}\r\n` +
                `Subject: ${subject || "(No Subject)"}\r\n` +
                `MIME-Version: 1.0\r\n`;

              if (text && html) {
                rawMime += `Content-Type: multipart/alternative; boundary="${boundary}"\r\n\r\n` +
                  `--${boundary}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${text}\r\n\r\n` +
                  `--${boundary}\r\nContent-Type: text/html; charset=utf-8\r\n\r\n${html}\r\n\r\n` +
                  `--${boundary}--`;
              } else if (html) {
                rawMime += `Content-Type: text/html; charset=utf-8\r\n\r\n${html}`;
              } else {
                rawMime += `Content-Type: text/plain; charset=utf-8\r\n\r\n${text || ""}`;
              }

              for (const recipientItem of recipientList) {
                try {
                  const { EmailMessage } = await import("cloudflare:email" as any);
                  const msg = new EmailMessage(from, recipientItem, rawMime);
                  await env.EMAIL.send(msg);
                } catch {
                  // Fallback if cloudflare:email is not imported dynamically
                  await env.EMAIL.send({
                    from,
                    to: recipientItem,
                    raw: new TextEncoder().encode(rawMime)
                  });
                }
              }
              sendBindingResult = "delivered";
            } catch (emailErr: any) {
              console.warn(`[Cloudflare EMAIL Binding Error]: ${emailErr.message || emailErr}`);
              sendBindingResult = `error: ${emailErr.message || emailErr}`;
            }
          }

          return jsonResponse({
            success: true,
            message: "Email dispatched successfully via Cloudflare Worker Outbound API",
            emailId,
            threadId: activeThreadId,
            messageId,
            sendBinding: sendBindingResult
          });
        } catch (err: any) {
          return jsonResponse({ success: false, error: err.message }, 500);
        }
      }

      // 8. TURN & WebRTC Voice Broker routes
      if (pathname === "/api/turn-credentials" && request.method === "GET") {
        const authStatus = await ZeroTrustGuard.verifyAssertion(request, env);
        if (!authStatus.authenticated) {
          return jsonResponse({ error: "Unauthorized", message: authStatus.error || "Invalid credentials." }, 401);
        }

        if (!env.REALTIME_INFRA) {
          // No placeholder credentials: say it isn't configured.
          return jsonResponse({ success: false, code: "turn_not_configured", error: "TURN relay isn't configured (REALTIME_INFRA binding)." }, 503);
        }

        try {
          const turnResult = await env.REALTIME_INFRA.generateTurnCredentials({ ttl: 3600 });
          return jsonResponse({ iceServers: turnResult.iceServers });
        } catch (infraError: any) {
          return jsonResponse({ error: "Bad Gateway", message: infraError.message }, 502);
        }
      }

      // 9. WebRTC WebSocket Connect route
      if (pathname === "/connect") {
        const denied = await validateApiAuth(request, env);
        if (!denied.authenticated) return denied.response ?? jsonResponse({ error: "Unauthorized" }, 401);
        const upgradeHeader = request.headers.get("Upgrade");
        if (!upgradeHeader || upgradeHeader.toLowerCase() !== "websocket") {
          return jsonResponse({ error: "Bad Gateway Upgrade Request", info: "Requires active WebSocket stream." }, 426);
        }

        const leadId = url.searchParams.get("leadId")?.trim();
        if (!leadId || !/^[A-Za-z0-9_.-]{1,128}$/.test(leadId)) {
          return jsonResponse({ error: "Bad Request", info: "Missing 'leadId' query parameter." }, 400);
        }

        if (!env.CRM_VOICE_ASSISTANT) {
          return jsonResponse({ error: "Internal Server Error", info: "CRM_VOICE_ASSISTANT DO binding unassigned." }, 500);
        }

        const doId = env.CRM_VOICE_ASSISTANT.idFromName(leadId);
        const stub = env.CRM_VOICE_ASSISTANT.get(doId);
        const doResponse = await stub.fetch(request);

        const securedResponse = new Response(doResponse.body, doResponse);
        Object.entries(CORS_HEADERS).forEach(([name, val]) => {
          securedResponse.headers.set(name, val);
        });
        return securedResponse;
      }

      // Default Health check status
      return jsonResponse({
        status: "operational",
        service: "Cloudflare Email & Workers AI Edge Worker",
        model: "@cf/meta/llama-3-8b-instruct",
        categories: ["Important", "Newsletter", "Billing", "Spam"],
        endpoints: [
          "GET /api/emails?page=1&limit=20",
          "GET /api/emails/:id",
          "GET /api/emails/:id/attachments/:filename",
          "POST /api/send",
          "GET /api/attachments/download",
          "GET /api/turn-credentials",
          "GET /connect?leadId=<uuid>"
        ],
      });
    } catch (error: any) {
      console.error("[Worker Edge Exception]:", error.message);
      return jsonResponse({ error: "Internal Edge Server Error", message: error.message }, 500);
    }
  },

  /**
   * Cloudflare Email Routing Inbound Handler
   * Steps:
   * 1. Check recipient in D1 users table
   * 2. Save raw stream to R2 EMAIL_BUCKET
   * 3. Parse MIME with postal-mime
   * 4. Run Workers AI (@cf/meta/llama-3-8b-instruct) for 2-sentence summary & 4-category classification
   * 5. Update D1 schema (summary, category columns) and save record alongside standard metadata
   * 6. Save extracted attachments to ATTACHMENTS_BUCKET and register in D1
   */
  async email(
    message: ForwardableEmailMessage,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    const startTime = performance.now();

    const recipient = normalizeEmail(message.to);
    const sender = (message.from || "").trim();
    const subject = message.headers.get("subject") || message.headers.get("Subject") || "(No Subject)";
    const messageId = extractOrGenerateMessageId(message.headers);

    console.log(`[Cloudflare Email Worker] Inbound stream: to="${recipient}" from="${sender}" id="${messageId}"`);

    if (!env || !env.DB) {
      console.error("[Cloudflare Email Worker Error] Missing 'env.DB' D1 binding.");
      message.setReject("Internal server error: D1 database binding missing");
      return;
    }

    if (!env.EMAIL_BUCKET) {
      console.error("[Cloudflare Email Worker Error] Missing 'env.EMAIL_BUCKET' R2 binding.");
      message.setReject("Internal server error: R2 bucket binding missing");
      return;
    }

    try {
      // 1. Ensure D1 Database Schema includes summary, category, and classification_tag columns
      await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY,
          user_id TEXT,
          direction TEXT,
          sender TEXT,
          recipient TEXT,
          subject TEXT,
          snippet TEXT,
          summary TEXT,
          category TEXT,
          classification_tag TEXT,
          r2_object_key TEXT,
          is_read INTEGER DEFAULT 0,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `).run();

      await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS threads (
          id TEXT PRIMARY KEY,
          subject TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `).run();

      await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS attachments (
          id TEXT PRIMARY KEY,
          email_id TEXT NOT NULL,
          user_id TEXT,
          filename TEXT NOT NULL,
          content_type TEXT,
          size INTEGER,
          r2_key TEXT NOT NULL,
          download_url TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `).run();

      // 2. Lookup recipient in D1 users table
      const user = await env.DB.prepare(
        `SELECT id, email FROM users WHERE LOWER(email) = ? LIMIT 1`
      ).bind(recipient).first<WebmailUserRecord>();

      if (!user || !user.id) {
        console.warn(`[Cloudflare Email Worker Warning] Recipient "${recipient}" not found in D1 users. Rejecting.`);
        message.setReject(`Recipient address "${recipient}" does not exist on this domain.`);
        return;
      }

      const userId = user.id;

      // 3. Read raw stream and store raw .eml into R2 EMAIL_BUCKET
      const rawArrayBuffer = await new Response(message.raw).arrayBuffer();
      const r2ObjectKey = `emails/${userId}/${messageId}.eml`;

      await env.EMAIL_BUCKET.put(r2ObjectKey, rawArrayBuffer, {
        httpMetadata: {
          contentType: "message/rfc822",
        },
      });

      // 4. Parse MIME with postal-mime
      let parsedEmail: PostalMimeEmail | null = null;
      try {
        const parser = new PostalMime();
        parsedEmail = await parser.parse(rawArrayBuffer);
      } catch (parseErr: any) {
        console.warn(`[Cloudflare Email Worker] postal-mime parsing error: ${parseErr.message || parseErr}`);
      }

      const bodyText = parsedEmail?.text || "";
      const snippet = bodyText
        ? bodyText.substring(0, 160).replace(/\s+/g, " ").trim()
        : `Inbound email from ${sender}. Subject: "${subject}"`;

      // 5. Run Cloudflare Workers AI (@cf/meta/llama-3-8b-instruct) for 2-sentence summary and 4-category classification
      console.log(`[Cloudflare Email Worker] Running Workers AI (@cf/meta/llama-3-8b-instruct) on email "${messageId}"...`);
      const aiAnalysis = await analyzeEmailWithWorkersAi(bodyText || snippet, subject, sender, env);
      console.log(`[Cloudflare Email Worker] Workers AI summary: "${aiAnalysis.summary}" | Category: "${aiAnalysis.category}"`);

      // 6. Save AI-generated results alongside standard metadata into D1 messages table
      await env.DB.prepare(`
        INSERT INTO messages (
          id, 
          user_id, 
          direction, 
          sender, 
          recipient, 
          subject, 
          snippet, 
          summary, 
          category,
          classification_tag, 
          r2_object_key, 
          is_read, 
          created_at
        ) VALUES (?, ?, 'inbound', ?, ?, ?, ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP)
      `).bind(
        messageId,
        userId,
        sender,
        recipient,
        subject,
        snippet,
        aiAnalysis.summary,
        aiAnalysis.category,
        aiAnalysis.category,
        r2ObjectKey
      ).run();

      // 7. Process extracted attachments and store into ATTACHMENTS_BUCKET
      const targetAttachmentsBucket = env.ATTACHMENTS_BUCKET || env.EMAIL_BUCKET;
      // Links are only signed with a configured secret (no built-in fallback); without one, download_url stays empty.
      const secretKey = attachmentUrlSecret(env);
      const baseUrl = env.DOMAIN_NAME ? `https://${env.DOMAIN_NAME}` : "https://devdesk.webmail.edge";

      if (parsedEmail && parsedEmail.attachments && parsedEmail.attachments.length > 0) {
        for (let i = 0; i < parsedEmail.attachments.length; i++) {
          const att = parsedEmail.attachments[i];
          const attId = `att_${typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Date.now() + "_" + i}`;
          const filename = att.filename || `attachment_${i + 1}.dat`;
          const contentType = att.mimeType || "application/octet-stream";
          
          let attBytes: Uint8Array;
          if (typeof att.content === "string") {
            attBytes = new TextEncoder().encode(att.content);
          } else if (att.content instanceof ArrayBuffer) {
            attBytes = new Uint8Array(att.content);
          } else if (att.content instanceof Uint8Array) {
            attBytes = att.content;
          } else {
            attBytes = new Uint8Array(att.content as any);
          }
          const size = attBytes.byteLength;

          const attR2Key = `attachments/${userId}/${messageId}/${attId}_${filename}`;

          await targetAttachmentsBucket.put(attR2Key, att.content, {
            httpMetadata: {
              contentType,
              contentDisposition: `attachment; filename="${encodeURIComponent(filename)}"`,
            },
          });

          const presignedDownloadUrl = secretKey ? await generatePresignedDownloadUrl(
            attId,
            secretKey,
            baseUrl,
            86400
          ) : "";

          await env.DB.prepare(`
            INSERT INTO attachments (
              id, email_id, user_id, filename, content_type, size, r2_key, download_url, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          `).bind(
            attId,
            messageId,
            userId,
            filename,
            contentType,
            size,
            attR2Key,
            presignedDownloadUrl
          ).run();
        }
      }

      const durationMs = (performance.now() - startTime).toFixed(2);
      console.log(`[Cloudflare Email Worker Success] Ingested email ${messageId} in ${durationMs}ms with category "${aiAnalysis.category}".`);
    } catch (error: any) {
      console.error(`[Cloudflare Email Worker Exception] Error ingesting email:`, error.message || error);
      message.setReject(`Internal worker error during email ingestion: ${error.message || "Unknown failure"}`);
    }
  }
};
