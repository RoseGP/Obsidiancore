/**
 * Outbound invoice email (server only). Credentials come from environment
 * variables and never reach the browser. When SMTP isn't configured we
 * report "not_configured"; we never fall back to a simulated success.
 *
 *   BILLING_SMTP_HOST (or SMTP_HOST), *_PORT, *_USER, *_PASS, *_SECURE, *_FROM
 */
import nodemailer, { type Transporter } from 'nodemailer';

const env = (k: string) => process.env[`BILLING_SMTP_${k}`] ?? process.env[`SMTP_${k}`] ?? '';

export function isEmailConfigured(): boolean {
  return Boolean(env('HOST') && env('FROM'));
}

let transporter: Transporter | null = null;
function getTransport(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env('HOST'),
      port: Number(env('PORT') || 587),
      secure: env('SECURE') === 'true',
      auth: env('USER') ? { user: env('USER'), pass: env('PASS') } : undefined,
    });
  }
  return transporter;
}

export interface OutboundInvoiceEmail {
  to: string;
  cc: string;
  replyTo: string;
  subject: string;
  text: string;
  pdf: Buffer;
  filename: string;
}

export type SendOutcome =
  | { result: 'delivered'; detail: string; provider: string }
  | { result: 'failed'; detail: string; provider: string }
  | { result: 'not_configured'; detail: string; provider: string };

export async function sendInvoiceEmail(msg: OutboundInvoiceEmail): Promise<SendOutcome> {
  if (!isEmailConfigured()) {
    return { result: 'not_configured', detail: 'Email delivery isn’t configured on the server. Add SMTP settings to send invoices.', provider: 'none' };
  }
  try {
    const info = await getTransport().sendMail({
      from: env('FROM'),
      to: msg.to,
      cc: msg.cc || undefined,
      replyTo: msg.replyTo || undefined,
      subject: msg.subject,
      text: msg.text,
      attachments: [{ filename: msg.filename, content: msg.pdf, contentType: 'application/pdf' }],
    });
    const accepted = (info.accepted ?? []).map(String);
    const rejected = (info.rejected ?? []).map(String);
    if (rejected.length && !accepted.length) {
      return { result: 'failed', detail: `Rejected by the mail server: ${rejected.join(', ')}`, provider: 'SMTP' };
    }
    // "Delivered" here means accepted by our SMTP relay; inbox delivery can still bounce later.
    return { result: 'delivered', detail: `Accepted by mail server${info.messageId ? ` (${info.messageId})` : ''}`, provider: 'SMTP' };
  } catch (err: any) {
    return { result: 'failed', detail: `Mail server error: ${String(err?.message ?? err).slice(0, 200)}`, provider: 'SMTP' };
  }
}
