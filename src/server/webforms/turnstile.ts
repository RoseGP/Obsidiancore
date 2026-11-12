/**
 * Cloudflare Turnstile (optional CAPTCHA for website forms).
 *
 * The widget on the website adds a one-time token to the form as `cf-turnstile-response`. A token proves nothing
 * until the server checks it with Cloudflare's Siteverify API (documented at
 * developers.cloudflare.com/turnstile/get-started/server-side-validation/):
 *   POST https://challenges.cloudflare.com/turnstile/v0/siteverify   (form-encoded: secret, response, remoteip)
 *   → { success, "error-codes": [...], hostname, action, challenge_ts }
 * Tokens are single-use and expire after 300 seconds. We fail closed: if Cloudflare can't be reached, the
 * submission isn't accepted (the visitor is asked to try again).
 */
export const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
export const TOKEN_FIELD = 'cf-turnstile-response';

export type TurnstileResult =
  | { ok: true; hostname: string | null; reason?: undefined; codes?: undefined }
  | { ok: false; reason: 'missing_token' | 'rejected' | 'unavailable'; codes: string[] };

type Verifier = (secret: string, token: string, ip?: string) => Promise<{ success: boolean; hostname?: string; 'error-codes'?: string[] }>;

const cloudflareVerifier: Verifier = async (secret, token, ip) => {
  const body = new URLSearchParams({ secret, response: token });
  if (ip) body.set('remoteip', ip);
  const res = await fetch(SITEVERIFY_URL, { method: 'POST', body, signal: AbortSignal.timeout(5_000) });
  if (!res.ok) throw new Error(`siteverify ${res.status}`);
  return res.json() as Promise<{ success: boolean; hostname?: string; 'error-codes'?: string[] }>;
};

let verifier: Verifier = cloudflareVerifier;
/** Tests only: replace the network call. */
export function setTurnstileVerifierForTests(v: Verifier | null) { verifier = v ?? cloudflareVerifier; }

export async function verifyTurnstile(secret: string, token: unknown, ip?: string): Promise<TurnstileResult> {
  if (typeof token !== 'string' || !token || token.length > 2048) return { ok: false, reason: 'missing_token', codes: [] };
  try {
    const r = await verifier(secret, token, ip);
    if (r.success) return { ok: true, hostname: r.hostname || null };
    const codes = (r['error-codes'] || []).map(String).slice(0, 5);
    // A secret Cloudflare doesn't recognise is our configuration problem, not the visitor's.
    if (codes.some((c) => c.startsWith('invalid-input-secret') || c === 'missing-input-secret' || c === 'internal-error')) return { ok: false, reason: 'unavailable', codes };
    return { ok: false, reason: 'rejected', codes };
  } catch {
    return { ok: false, reason: 'unavailable', codes: [] };
  }
}
