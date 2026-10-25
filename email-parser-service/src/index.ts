import PostalMime from "postal-mime";
import type { Env, ParsedEmailResponse, ParsedAttachmentInfo, ExecutionContext, ForwardableEmailMessage } from "./types";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...CORS_HEADERS,
    },
  });
}

/**
 * Parses raw ArrayBuffer / Uint8Array / string RFC 822 email content using postal-mime.
 */
export async function parseRawEmail(rawInput: ArrayBuffer | Uint8Array | string): Promise<ParsedEmailResponse> {
  const parser = new PostalMime();
  const parsed = await parser.parse(rawInput);

  const headersMap: Record<string, string> = {};
  if (Array.isArray(parsed.headers)) {
    for (const h of parsed.headers) {
      if (h.key && h.value) {
        headersMap[h.key.toLowerCase()] = String(h.value);
      }
    }
  }

  const attachments: ParsedAttachmentInfo[] = (parsed.attachments || []).map((att, idx) => {
    let size = 0;
    if (typeof att.content === "string") {
      size = att.content.length;
    } else if (att.content instanceof ArrayBuffer) {
      size = att.content.byteLength;
    } else if (att.content instanceof Uint8Array) {
      size = att.content.byteLength;
    }

    return {
      filename: att.filename || `attachment_${idx + 1}`,
      mimeType: att.mimeType || "application/octet-stream",
      size,
      disposition: att.disposition || undefined,
      contentId: att.contentId || undefined,
    };
  });

  const fromAddress = parsed.from ? (typeof parsed.from === "string" ? parsed.from : `${parsed.from.name ? parsed.from.name + " " : ""}<${parsed.from.address}>`) : "unknown@unknown.com";
  
  const toAddresses: string[] = Array.isArray(parsed.to)
    ? parsed.to.map(item => (typeof item === "string" ? item : item.address || item.name || ""))
    : parsed.to
    ? [String(parsed.to)]
    : [];

  const ccAddresses: string[] = Array.isArray(parsed.cc)
    ? parsed.cc.map(item => (typeof item === "string" ? item : item.address || item.name || ""))
    : [];

  const bccAddresses: string[] = Array.isArray(parsed.bcc)
    ? parsed.bcc.map(item => (typeof item === "string" ? item : item.address || item.name || ""))
    : [];

  return {
    messageId: parsed.messageId || headersMap["message-id"] || undefined,
    from: fromAddress,
    to: toAddresses,
    cc: ccAddresses.length > 0 ? ccAddresses : undefined,
    bcc: bccAddresses.length > 0 ? bccAddresses : undefined,
    subject: parsed.subject || "(No Subject)",
    date: parsed.date || headersMap["date"] || undefined,
    text: parsed.text || undefined,
    html: parsed.html || undefined,
    attachments,
    headers: headersMap,
    rawSize: typeof rawInput === "string" ? rawInput.length : rawInput.byteLength,
  };
}

export default {
  /**
   * HTTP Fetch Handler:
   * - GET / : Service health and metadata
   * - POST /parse : Parse raw email body (.eml, text, binary, or JSON { raw: "..." })
   */
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS,
      });
    }

    const url = new URL(request.url);

    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      return jsonResponse({
        status: "healthy",
        service: "email-parser-service",
        runtime: "Cloudflare Workers",
        parser: "postal-mime",
        compatibility: "nodejs_compat",
        endpoints: {
          "POST /parse": "Send raw RFC 822 email (.eml stream, text/plain, or JSON { raw })",
          "GET /health": "Service status"
        }
      });
    }

    if (request.method === "POST" && (url.pathname === "/parse" || url.pathname === "/")) {
      try {
        const contentType = request.headers.get("content-type") || "";
        let rawContent: ArrayBuffer | Uint8Array | string;

        if (contentType.includes("application/json")) {
          const json: any = await request.json();
          if (!json || (!json.raw && !json.eml && !json.content)) {
            return jsonResponse({
              success: false,
              error: "Missing email content in JSON body. Expected 'raw', 'eml', or 'content' property."
            }, 400);
          }
          rawContent = json.raw || json.eml || json.content;
        } else if (contentType.includes("multipart/form-data")) {
          const formData = await request.formData();
          const file = formData.get("email") || formData.get("file") || formData.get("eml");
          if (file && typeof file === "object" && "arrayBuffer" in file) {
            rawContent = await (file as Blob).arrayBuffer();
          } else if (typeof file === "string") {
            rawContent = file;
          } else {
            return jsonResponse({
              success: false,
              error: "No email file or field found in multipart formData (expected 'email' or 'file')."
            }, 400);
          }
        } else {
          // Binary stream or text/plain or message/rfc822
          rawContent = await request.arrayBuffer();
        }

        if (!rawContent || (typeof rawContent !== "string" && rawContent.byteLength === 0)) {
          return jsonResponse({
            success: false,
            error: "Empty request payload provided to /parse."
          }, 400);
        }

        const parsedEmail = await parseRawEmail(rawContent);

        return jsonResponse({
          success: true,
          email: parsedEmail,
        });
      } catch (err: any) {
        return jsonResponse({
          success: false,
          error: err.message || "Failed to parse email message.",
        }, 500);
      }
    }

    return jsonResponse({
      success: false,
      error: `Not Found: ${request.method} ${url.pathname}`,
    }, 404);
  },

  /**
   * Cloudflare Email Routing Event Handler:
   * Triggered when an email arrives on a configured Cloudflare domain route.
   */
  async email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext): Promise<void> {
    try {
      console.log(`[email-parser-service] Received inbound email to: ${message.to}, from: ${message.from}`);
      const rawStream = await new Response(message.raw).arrayBuffer();
      const parsed = await parseRawEmail(rawStream);
      
      console.log(`[email-parser-service] Parsed message: "${parsed.subject}" with ${parsed.attachments.length} attachment(s).`);
      
      // If a downstream DB or queue is bound, dispatch here:
      if (env.DB) {
        // e.g. persist to database or queue
      }
    } catch (err: any) {
      console.error(`[email-parser-service] Error handling inbound email event:`, err.message || err);
      message.setReject(`Email parser processing error: ${err.message || "Unknown error"}`);
    }
  }
};
