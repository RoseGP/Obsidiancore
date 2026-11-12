/**
 * Validation for the email worker's POST /api/send (src/index.ts). Pure, no dependencies (Workers + Node).
 *
 * The handler used to build the raw MIME message by pasting `from`, `to` and `subject` from the request body,
 * with a hard-coded personal address as the default sender. CR/LF in any of them added arbitrary headers
 * (Bcc:, Reply-To:, a second body), and any `from` address could be used. Now:
 *   - `from` is required and must be an address on the worker's own DOMAIN_NAME;
 *   - recipients: 1-50 plain addresses (no display names, no CR/LF, no commas/angle brackets);
 *   - subject: one line, at most 300 characters; text/html at most 512 KB each; at least one of them;
 *   - userId / threadId: short ids (letters, digits, _ . -); no default user.
 * Anything else → { error } with a message that names the field (never the value).
 */

export const LIMITS = { recipients: 50, subject: 300, body: 512 * 1024, id: 128 } as const;

const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
const ID_RE = /^[A-Za-z0-9_.-]{1,128}$/;
const HAS_CONTROL = /[\u0000-\u001f\u007f]/;

export interface OutboundEmail { userId: string; from: string; to: string[]; subject: string; text?: string; html?: string; threadId?: string }
/** `value` when ok; otherwise `error` (plain shape: the app compiles without strictNullChecks, so no union narrowing). */
export interface OutboundResult { ok: boolean; value?: OutboundEmail; error?: string }

export function isPlainEmail(v: unknown): v is string {
  return typeof v === 'string' && v.length <= 254 && EMAIL_RE.test(v);
}

export function validateOutboundEmail(body: unknown, senderDomain: string | undefined): OutboundResult {
  const fail = (error: string): OutboundResult => ({ ok: false, error });
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail('Send a JSON object.');
  const b = body as Record<string, unknown>;
  const domain = String(senderDomain || '').trim().toLowerCase();
  if (!domain) return fail('Sending is not configured (DOMAIN_NAME).');

  if (typeof b.userId !== 'string' || !ID_RE.test(b.userId)) return fail("'userId' is required (letters, digits, _ . -).");
  if (b.threadId !== undefined && (typeof b.threadId !== 'string' || !ID_RE.test(b.threadId))) return fail("'threadId' is invalid.");

  const from = typeof b.from === 'string' ? b.from.trim().toLowerCase() : '';
  if (!isPlainEmail(from)) return fail("'from' must be a plain email address.");
  if (from.slice(from.lastIndexOf('@') + 1) !== domain) return fail(`'from' must be an address on ${domain}.`);

  const rawTo = b.to ?? b.recipient;
  const list = (Array.isArray(rawTo) ? rawTo : [rawTo]).filter((x) => x !== undefined && x !== null && x !== '');
  if (!list.length) return fail("Recipient ('to') is required.");
  if (list.length > LIMITS.recipients) return fail(`At most ${LIMITS.recipients} recipients.`);
  const to: string[] = [];
  for (const r of list) {
    const addr = typeof r === 'string' ? r.trim() : '';
    if (!isPlainEmail(addr)) return fail("Each recipient in 'to' must be a plain email address.");
    if (!to.includes(addr.toLowerCase())) to.push(addr.toLowerCase());
  }

  const subject = b.subject === undefined ? '' : typeof b.subject === 'string' ? b.subject.trim() : null;
  if (subject === null || HAS_CONTROL.test(subject)) return fail("'subject' must be one line of text.");
  if (subject.length > LIMITS.subject) return fail(`'subject' is limited to ${LIMITS.subject} characters.`);

  const text = b.text === undefined ? undefined : typeof b.text === 'string' ? b.text : null;
  const html = b.html === undefined ? undefined : typeof b.html === 'string' ? b.html : null;
  if (text === null || html === null) return fail("'text' and 'html' must be strings.");
  if (!text && !html) return fail("Send 'text' or 'html'.");
  const bytes = (s?: string) => (s ? new TextEncoder().encode(s).length : 0);
  if (bytes(text) > LIMITS.body || bytes(html) > LIMITS.body) return fail('The message body is too large (512 KB max).');

  return { ok: true, value: { userId: b.userId, from, to, subject, text: text || undefined, html: html || undefined, threadId: (b.threadId as string) || undefined } };
}

/** The attachment-link signing secret: ATTACHMENT_URL_SECRET, else JWT_SECRET; null if missing or short (fail closed). */
export function attachmentUrlSecret(env: { ATTACHMENT_URL_SECRET?: string; JWT_SECRET?: string }): string | null {
  const s = (env.ATTACHMENT_URL_SECRET || env.JWT_SECRET || '').trim();
  return s.length >= 32 ? s : null;
}
