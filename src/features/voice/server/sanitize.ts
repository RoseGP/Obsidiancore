/**
 * Sanitizes dynamic, user-influenced text before it is spoken with <Say>.
 *
 * Layers:
 *  1. Remove characters that are illegal in XML 1.0 (control chars, lone surrogates)
 *     — they make TwiML unparseable, which Twilio answers with an application error.
 *  2. Remove anything tag-like and any characters with markup meaning (< > & " ' ` \ { } [ ]),
 *     so a value such as `</Say><Dial>+1900…</Dial>` can never become TwiML or SSML,
 *     even if a future code path builds XML by string concatenation.
 *  3. Collapse whitespace and cap length (TTS cost and abuse).
 * The Twilio SDK additionally XML-escapes text nodes when it serializes TwiML.
 * Don't pre-escape (e.g. "&amp;"): Twilio would then read the entity aloud.
 */
// eslint-disable-next-line no-control-regex
const XML_ILLEGAL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export function sanitizeForSpeech(input: unknown, maxLength = 40): string {
  if (typeof input !== 'string') return '';
  return input
    .normalize('NFKC')
    .replace(XML_ILLEGAL, '')
    .replace(/<[^>]*>?/g, ' ')
    .replace(/[<>&"'`\\{}[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
    .trim();
}

/** A first name safe to greet someone with: letters, spaces, hyphens, apostrophe-like marks removed above. */
export function speakableFirstName(fullName: unknown): string {
  const first = sanitizeForSpeech(fullName, 60).split(' ')[0] || '';
  return /^[\p{L}\p{M}.-]{1,30}$/u.test(first) ? first : '';
}
