import PostalMime from "postal-mime";

/**
 * Cloudflare Email Routing Type Definitions
 */
export interface ForwardableEmailMessage {
  readonly from: string;
  readonly to: string;
  readonly headers: Headers;
  readonly raw: ReadableStream;
  readonly rawSize: number;
  setReject(reason: string): void;
  forward(rcptTo: string, headers?: Headers): Promise<void>;
  reply?(message: any): Promise<void>;
}

export interface ExecutionContext {
  waitUntil(promise: Promise<any>): void;
  passThroughOnException(): void;
}

export interface Env {
  // Optional bindings for storage / logging / processing
  DB?: any;
  STORAGE_BUCKET?: any;
  FORWARD_TO?: string;
  WEBHOOK_URL?: string;
}

export default {
  /**
   * Cloudflare Inbound Email Event Handler
   * Triggers automatically when an email is routed to this Worker.
   */
  async email(
    message: ForwardableEmailMessage,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    const startTime = performance.now();

    try {
      console.log(`[Email Worker] Received incoming email event:`);
      console.log(`  - From: ${message.from}`);
      console.log(`  - To: ${message.to}`);
      console.log(`  - Size: ${message.rawSize} bytes`);

      // 1. Read the raw stream using message.raw into an ArrayBuffer
      const rawEmailBuffer = await new Response(message.raw).arrayBuffer();

      // 2. Parse the email with PostalMime
      const parser = new PostalMime();
      const parsedEmail = await parser.parse(rawEmailBuffer);

      // 3. Extract and structure core components
      const subject = parsedEmail.subject || "(No Subject)";
      const from = parsedEmail.from; // { name?: string, address?: string } or string
      const to = parsedEmail.to || [];
      const cc = parsedEmail.cc || [];
      const date = parsedEmail.date || new Date().toISOString();
      const messageId = parsedEmail.messageId || message.headers.get("message-id") || `msg_${Date.now()}`;
      const textBody = parsedEmail.text || "";
      const htmlBody = parsedEmail.html || "";
      const attachments = parsedEmail.attachments || [];

      // 4. Log structured components
      console.log(`\n========== PARSED EMAIL SUMMARY ==========`);
      console.log(`Message ID:  ${messageId}`);
      console.log(`Subject:     ${subject}`);
      console.log(`From:        ${typeof from === "object" && from ? `${from.name ? from.name + " " : ""}<${from.address}>` : from}`);
      console.log(`To:          ${JSON.stringify(to)}`);
      if (cc && cc.length > 0) {
        console.log(`CC:          ${JSON.stringify(cc)}`);
      }
      console.log(`Date:        ${date}`);
      console.log(`Text Length: ${textBody.length} characters`);
      console.log(`HTML Length: ${htmlBody.length} characters`);
      console.log(`Attachments: ${attachments.length} attached file(s)`);

      // 5. Inspect and log attachments
      if (attachments.length > 0) {
        console.log(`\n--- ATTACHMENT DETAILS ---`);
        attachments.forEach((att, index) => {
          let byteSize = 0;
          if (typeof att.content === "string") {
            byteSize = att.content.length;
          } else if (att.content instanceof ArrayBuffer) {
            byteSize = att.content.byteLength;
          } else if (att.content instanceof Uint8Array) {
            byteSize = att.content.byteLength;
          }

          console.log(`  [${index + 1}] Filename:     ${att.filename || `unnamed_${index + 1}`}`);
          console.log(`      MIME Type:    ${att.mimeType || "application/octet-stream"}`);
          console.log(`      Size:         ${byteSize} bytes`);
          console.log(`      Disposition:  ${att.disposition || "attachment"}`);
          if (att.contentId) {
            console.log(`      Content-ID:   ${att.contentId}`);
          }
        });
      }

      // Log a preview snippet of the body
      const textPreview = textBody
        ? textBody.substring(0, 200).replace(/\s+/g, " ").trim()
        : "(No plain text content)";
      console.log(`\nBody Preview: "${textPreview}${textBody.length > 200 ? "..." : ""}"`);
      console.log(`==========================================\n`);

      // 6. Asynchronous downstream handling (e.g. database, R2 storage, or webhook)
      if (env.WEBHOOK_URL) {
        ctx.waitUntil(
          fetch(env.WEBHOOK_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              messageId,
              from,
              to,
              subject,
              text: textBody,
              html: htmlBody,
              attachmentCount: attachments.length,
              date,
            }),
          }).catch((err) => console.error("[Webhook Error]:", err))
        );
      }

      const elapsed = (performance.now() - startTime).toFixed(2);
      console.log(`[Email Worker] Finished processing in ${elapsed}ms.`);

    } catch (error: any) {
      console.error(`[Email Worker Error] Failed to process incoming email:`, error);
      // Optionally reject the email if parsing encounters a fatal error
      // message.setReject(`Email processing failed: ${error.message || "Unknown error"}`);
    }
  },
};
