/**
 * Website form submissions: validation, sanitization, spam signals and duplicate fingerprints.
 *
 * Accepted fields (anything else is ignored, never stored):
 *   name* (2–120), email* (valid, ≤254), phone (digits and + ( ) - . space), company, message (≤4000),
 *   pageUrl (http/https), formName (label, e.g. "Contact page"), utm_source/utm_medium/utm_campaign,
 *   consent (true = agree to be contacted about this request), marketingOptIn (true/false),
 *   _hp (honeypot: must be empty), _ts (time the form was shown, ms since epoch).
 * Strings are trimmed, control characters and zero-width characters removed, whitespace collapsed (except
 * newlines in the message). Output is plain text; it is HTML-encoded wherever it is rendered.
 */
import crypto from 'node:crypto';
import { z } from 'zod';

const CONTROL = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F\\u200B-\\u200F\\u2028\\u2029\\u2060-\\u2064\\uFEFF]', 'g');
export const clean = (v: unknown, max: number, opts: { multiline?: boolean } = {}) => {
  if (typeof v !== 'string') return '';
  let s = v.normalize('NFKC').replace(CONTROL, '');
  s = opts.multiline ? s.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n') : s.replace(/\s+/g, ' ');
  return s.trim().slice(0, max);
};

const bool = z.preprocess((v) => (v === 'true' || v === 'on' || v === '1' || v === 1 ? true : v === 'false' || v === '0' || v === 0 || v === '' ? false : v), z.boolean());
const optionalText = (max: number, multiline = false) => z.preprocess((v) => clean(v, max, { multiline }), z.string()).optional();

export const SubmissionSchema = z.object({
  name: z.preprocess((v) => clean(v, 120), z.string().min(2, 'Please enter your name.')),
  email: z.preprocess((v) => clean(v, 254).toLowerCase(), z.string().max(254).regex(/^[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[^\s@<>()[\],;:"]{2,}$/, 'Please enter a valid email address.')),
  phone: z.preprocess((v) => clean(v, 40), z.string().regex(/^[+()\d\s.-]{0,40}$/, 'Please enter a valid phone number.')).optional(),
  company: optionalText(160),
  message: optionalText(4000, true),
  pageUrl: z.preprocess((v) => clean(v, 500), z.string().refine((s) => !s || /^https?:\/\/[^\s]+$/i.test(s), 'pageUrl must be a web address.')).optional(),
  formName: optionalText(60),
  utm_source: optionalText(100), utm_medium: optionalText(100), utm_campaign: optionalText(100),
  consent: bool.optional(),
  marketingOptIn: bool.optional(),
  _hp: z.unknown().optional(),
  _ts: z.unknown().optional(),
});
export type Submission = z.infer<typeof SubmissionSchema>;

/** Field errors safe to show to the visitor (no echo of their input). */
export function fieldErrors(err: z.ZodError) {
  const seen = new Set<string>();
  return err.issues.map((i) => ({ field: String(i.path[0] ?? 'form'), message: i.message })).filter((e) => (seen.has(e.field) ? false : (seen.add(e.field), true)));
}

export interface SpamVerdict { spam: boolean; reason?: 'honeypot' | 'too_fast' | 'too_many_links' | 'markup' }

/** Cheap, explainable spam signals. Spam gets a normal-looking success and is not sent anywhere. */
export function spamVerdict(raw: Record<string, unknown>, s: Submission, now = Date.now()): SpamVerdict {
  const hp = raw._hp ?? raw._hp_website_title ?? raw._bot_trap;
  if (typeof hp === 'string' ? hp.trim() !== '' : hp != null && hp !== false) return { spam: true, reason: 'honeypot' };
  const ts = Number(raw._ts);
  if (Number.isFinite(ts) && ts > 0 && now - ts >= 0 && now - ts < 2500) return { spam: true, reason: 'too_fast' };
  const text = `${s.message || ''} ${s.company || ''} ${s.name}`;
  if ((text.match(/https?:\/\/|www\./gi) || []).length > 3) return { spam: true, reason: 'too_many_links' };
  if (/<\s*(a|script|iframe|img)\b|\[url=/i.test(text)) return { spam: true, reason: 'markup' };
  return { spam: false };
}

/** Same person + same message to the same organization = the same submission (double clicks, resubmits). */
export function fingerprint(orgId: string, s: Submission) {
  const msg = (s.message || '').toLowerCase().replace(/\s+/g, ' ').trim();
  return crypto.createHash('sha256').update([orgId, s.email, s.name.toLowerCase(), msg, s.formName || ''].join('\u0000')).digest('hex').slice(0, 40);
}
