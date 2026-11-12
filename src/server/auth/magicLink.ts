/**
 * Passwordless sign-in links.
 *
 * Request (POST /api/auth/magic-link/request { email }):
 *   - The answer is the same whether or not an account exists, is disabled, or was throttled (no account
 *     enumeration). Only real configuration problems (email or sign-in not set up at all) are reported,
 *     because they say nothing about any account.
 *   - Per address: at most MAGIC_LINK_MAX_PER_WINDOW links per 15 minutes (excess requests are silently
 *     dropped). Per IP: limited in the router.
 *   - Token: 32 random bytes (crypto.randomBytes), base64url. Only its SHA-256 is stored, as the document
 *     id under auth_magic_links/, with the account id and an expiry (MAGIC_LINK_TTL_MINUTES, default 15).
 *   - The link is APP_URL/auth/magic#token=…: the token sits in the URL fragment, which browsers never send
 *     to servers, so it doesn't end up in access logs, proxies or Referer headers.
 *   - Accounts with two-step sign-in enrolled get an email explaining that links can't be used for them
 *     (a link must not bypass their second factor); no link is issued.
 *
 * Verify (POST /api/auth/magic-link/verify { token }):
 *   - In one transaction the stored record is read and deleted, so a token works exactly once, even with
 *     concurrent attempts. Unknown, used and expired tokens all get the same 400 invalid_or_expired_link.
 *   - Redeeming needs JavaScript on the sign-in page (a POST), so mail scanners that only fetch links
 *     don't use them up.
 *   - The result is a Firebase custom token; the browser signs in with it, and from then on the
 *     organization's security policy (required two-step, session age) applies as for any sign-in.
 */
import crypto from 'crypto';
import { getDocStore, type DocStore } from '../data/docStore';
import { getMailer, type Mailer } from '../email/mailer';
import { HttpError, badRequest, serviceUnavailable } from '../http/errors';
import { logger } from '../http/logger';
import { isExplicitDevOrTest } from '../runtimeEnv';
import { getIdentityProvider, type IdentityProvider } from './identity';

export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const WINDOW_MS = 15 * 60_000;

export const ttlMs = () => Math.min(60, Math.max(5, Number(process.env.MAGIC_LINK_TTL_MINUTES) || 15)) * 60_000;
const maxPerWindow = () => Math.min(10, Math.max(1, Number(process.env.MAGIC_LINK_MAX_PER_WINDOW) || 3));

export const hashToken = (token: string) => crypto.createHash('sha256').update(token, 'utf8').digest('hex');
/** Stable, non-reversible key for per-address throttling and logs (the address itself isn't stored). */
const emailKey = (email: string) => crypto.createHash('sha256').update(`magic-link:${email}`, 'utf8').digest('hex').slice(0, 48);
export const normalizeEmail = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : '');

export interface MagicLinkDeps { store?: DocStore; mailer?: Mailer; identity?: IdentityProvider; now?: () => number; appUrl?: string }

function appUrl(deps: MagicLinkDeps): string | null {
  const configured = (deps.appUrl ?? process.env.APP_URL ?? '').trim().replace(/\/+$/, '');
  if (configured) return configured;
  // Never derived from request headers (Host can be forged). Local development only.
  return isExplicitDevOrTest() ? `http://localhost:${Number(process.env.PORT) || 3000}` : null;
}

export interface MagicLinkStatus { enabled: boolean; reason?: 'email_not_configured' | 'sign_in_not_configured' | 'app_url_not_configured'; mode?: 'smtp' | 'dev-log' }

export function magicLinkStatus(deps: MagicLinkDeps = {}): MagicLinkStatus {
  const identity = deps.identity ?? getIdentityProvider();
  const mailer = deps.mailer ?? getMailer();
  if (!identity.configured) return { enabled: false, reason: 'sign_in_not_configured' };
  if (!mailer.mode) return { enabled: false, reason: 'email_not_configured' };
  if (!appUrl(deps)) return { enabled: false, reason: 'app_url_not_configured' };
  return { enabled: true, mode: mailer.mode };
}

const NOT_CONFIGURED: Record<NonNullable<MagicLinkStatus['reason']>, string> = {
  email_not_configured: 'Email sign-in links aren\'t available: this server can\'t send email yet (an administrator adds SMTP settings).',
  sign_in_not_configured: 'Email sign-in links aren\'t available on this server yet.',
  app_url_not_configured: 'Email sign-in links aren\'t available: the server\'s public address (APP_URL) isn\'t set.',
};

/** Same message for every outcome of a valid request. */
export const REQUEST_ACCEPTED = 'If an account exists for that address, a sign-in link is on its way. It works once and expires soon.';

async function underLimit(store: DocStore, key: string, now: number): Promise<boolean> {
  return store.transaction(async (tx) => {
    const path = `auth_magic_link_throttle/${key}`;
    const cur = await tx.get(path);
    const fresh = !cur || now - Number(cur.windowStart) >= WINDOW_MS;
    const count = fresh ? 0 : Number(cur.count) || 0;
    if (count >= maxPerWindow()) return false;
    tx.set(path, { windowStart: fresh ? now : Number(cur.windowStart), count: count + 1, updatedAt: new Date(now).toISOString() });
    return true;
  });
}

function linkEmail(link: string, minutes: number) {
  const text = [
    'Use this link to sign in to Obsidian CRM:', '', link, '',
    `It works once and expires in ${minutes} minutes.`,
    'If you didn\'t ask to sign in, you can ignore this email: nobody can sign in without the link.',
  ].join('\n');
  const html = `<p>Use this link to sign in to Obsidian CRM:</p><p><a href="${link}">Sign in to Obsidian CRM</a></p><p>It works once and expires in ${minutes} minutes.</p><p style="color:#6b6a66">If you didn't ask to sign in, you can ignore this email: nobody can sign in without the link.</p>`;
  return { subject: 'Your Obsidian CRM sign-in link', text, html };
}

const secondFactorEmail = () => ({
  subject: 'Sign in to Obsidian CRM with your password',
  text: 'Someone asked for an email sign-in link for this account. Because your account uses two-step sign-in, email links can\'t be used for it: sign in with your password and your authentication code instead.\n\nIf this wasn\'t you, no action is needed.',
});

/**
 * Handles a sign-in link request. Resolves with the same result for every valid email; `delivery` settles when
 * the email has been handed to the mail server (the router doesn't wait for it, so timing doesn't reveal
 * whether an account exists).
 */
export async function requestMagicLink(emailInput: unknown, deps: MagicLinkDeps = {}): Promise<{ message: string; delivery: Promise<void> }> {
  const email = normalizeEmail(emailInput);
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) throw badRequest('Enter a valid email address.', 'invalid_email');
  const status = magicLinkStatus(deps);
  if (!status.enabled) throw serviceUnavailable(NOT_CONFIGURED[status.reason!], 'magic_link_not_configured');

  const store = deps.store ?? (await getDocStore());
  const identity = deps.identity ?? getIdentityProvider();
  const mailer = deps.mailer ?? getMailer();
  const now = (deps.now ?? Date.now)();
  const key = emailKey(email);
  const accepted = (delivery: Promise<void> = Promise.resolve()) => ({ message: REQUEST_ACCEPTED, delivery });

  if (!(await underLimit(store, key, now))) {
    logger.warn('auth.magic_link.throttled', { subject: key });
    return accepted();
  }

  let account;
  try { account = await identity.findByEmail(email); }
  catch (e) { logger.error('auth.magic_link.lookup_failed', { subject: key, error: (e as Error)?.message }); return accepted(); }
  if (!account || account.disabled) { logger.info('auth.magic_link.no_eligible_account', { subject: key }); return accepted(); }

  if (account.hasSecondFactor) {
    const msg = secondFactorEmail();
    return accepted(mailer.send({ to: email, ...msg }).then((r) => { if (!r.ok) logger.error('auth.magic_link.mail_failed', { subject: key, reason: r.reason }); }));
  }

  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = now + ttlMs();
  await store.set(`auth_magic_links/${hashToken(token)}`, { uid: account.uid, emailKey: key, createdAt: new Date(now).toISOString(), expiresAt });
  const link = `${appUrl(deps)}/auth/magic#token=${token}`;
  const msg = linkEmail(link, Math.round(ttlMs() / 60_000));
  logger.info('auth.magic_link.issued', { subject: key, expiresAt: new Date(expiresAt).toISOString() });
  const delivery = mailer.send({ to: email, ...msg }).then((r) => {
    if (!r.ok) logger.error('auth.magic_link.mail_failed', { subject: key, reason: r.reason });
  });
  return accepted(delivery);
}

const INVALID = () => new HttpError(400, 'invalid_or_expired_link', 'This sign-in link is invalid, has expired or was already used. Ask for a new one.');

/** Redeems a link once. Returns a credential for signInWithCustomToken. */
export async function verifyMagicLink(tokenInput: unknown, deps: MagicLinkDeps = {}): Promise<{ customToken: string }> {
  const token = typeof tokenInput === 'string' ? tokenInput.trim() : '';
  if (!TOKEN_RE.test(token)) throw INVALID();
  const identity = deps.identity ?? getIdentityProvider();
  if (!identity.configured) throw serviceUnavailable(NOT_CONFIGURED.sign_in_not_configured, 'magic_link_not_configured');
  const store = deps.store ?? (await getDocStore());
  const now = (deps.now ?? Date.now)();
  const path = `auth_magic_links/${hashToken(token)}`;

  // Read and delete together: a second (or concurrent) use finds nothing.
  const rec = await store.transaction(async (tx) => {
    const r = await tx.get(path);
    if (r) tx.delete(path);
    return r;
  });
  if (!rec) { logger.warn('auth.magic_link.rejected', { reason: 'unknown_or_used' }); throw INVALID(); }
  if (!(Number(rec.expiresAt) > now)) { logger.warn('auth.magic_link.rejected', { reason: 'expired', subject: rec.emailKey }); throw INVALID(); }

  const account = await identity.getById(String(rec.uid)).catch((e) => { logger.error('auth.magic_link.lookup_failed', { error: (e as Error)?.message }); return null; });
  if (!account || account.disabled) { logger.warn('auth.magic_link.rejected', { reason: 'account_unavailable', subject: rec.emailKey }); throw INVALID(); }
  if (account.hasSecondFactor) throw new HttpError(403, 'second_factor_required', 'This account uses two-step sign-in. Sign in with your password and authentication code.');

  try {
    const customToken = await identity.createSignInToken(account.uid);
    logger.info('auth.magic_link.redeemed', { subject: rec.emailKey });
    return { customToken };
  } catch (e) {
    logger.error('auth.magic_link.token_failed', { error: (e as Error)?.message });
    throw serviceUnavailable('Signing in with a link isn\'t available right now. Sign in with your password, or try again later.', 'sign_in_unavailable');
  }
}
