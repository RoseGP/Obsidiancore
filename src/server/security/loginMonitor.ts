/**
 * Sign-in attempt monitoring (per server instance, in memory).
 *
 * A request that PRESENTS a credential which fails verification (bad, expired, revoked or forged token)
 * counts as a failed attempt for its IP address. After AUTH_FAILURE_LIMIT failures within
 * AUTH_FAILURE_WINDOW_MINUTES, further failed credentials from that IP get 429 for AUTH_LOCKOUT_MINUTES.
 * Valid credentials from a blocked IP still work, so a single client on a shared address can't lock out
 * everyone else behind it. Requests without any credential are not counted (anonymous traffic is normal).
 * Behind a reverse proxy set TRUST_PROXY (e.g. 1) so req.ip is the client's address, not the proxy's.
 *
 * Password guessing itself happens against Firebase Authentication, which has its own lockout
 * ("auth/too-many-requests"); this protects the API against token stuffing and replay.
 * IP addresses are kept only as a salted hash and only for the window, never logged in clear.
 */
import crypto from 'node:crypto';

const num = (v: string | undefined, d: number) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };
const cfg = () => ({
  limit: num(process.env.AUTH_FAILURE_LIMIT, 20),
  windowMs: num(process.env.AUTH_FAILURE_WINDOW_MINUTES, 15) * 60_000,
  lockMs: num(process.env.AUTH_LOCKOUT_MINUTES, 15) * 60_000,
});

const SALT = crypto.randomBytes(16).toString('hex');
const keyOf = (ip: string) => crypto.createHash('sha256').update(SALT + ip).digest('hex').slice(0, 24);

interface Entry { failures: number[]; blockedUntil: number }
const entries = new Map<string, Entry>();
let totals = { failures: 0, blocks: 0 };

function prune(e: Entry, now: number, windowMs: number) { e.failures = e.failures.filter((t) => now - t < windowMs); }

/** ms until the IP may try again, or 0 when it isn't blocked. */
export function blockedFor(ip: string, now = Date.now()): number {
  const e = entries.get(keyOf(ip));
  return e && e.blockedUntil > now ? e.blockedUntil - now : 0;
}

export function recordAuthFailure(ip: string, now = Date.now()) {
  const { limit, windowMs, lockMs } = cfg();
  const k = keyOf(ip);
  const e = entries.get(k) ?? { failures: [], blockedUntil: 0 };
  prune(e, now, windowMs);
  e.failures.push(now);
  totals.failures++;
  if (e.failures.length >= limit && e.blockedUntil <= now) {
    e.blockedUntil = now + lockMs;
    e.failures = [];
    totals.blocks++;
    console.warn(`[security] sign-in attempts blocked for one client after ${limit} failed credentials (lockout ${Math.round(lockMs / 60_000)} min)`);
  }
  entries.set(k, e);
}

/** A successful verification clears earlier failures for that IP (a user who fixed their session). */
export function recordAuthSuccess(ip: string) {
  const e = entries.get(keyOf(ip));
  if (e && e.blockedUntil <= Date.now()) entries.delete(keyOf(ip));
}

/** Aggregate numbers only (no IPs), for the admin security overview. */
export function loginMonitorStats(now = Date.now()) {
  let blockedNow = 0;
  for (const e of entries.values()) if (e.blockedUntil > now) blockedNow++;
  return { failedAttempts: totals.failures, lockouts: totals.blocks, blockedNow, limit: cfg().limit, windowMinutes: cfg().windowMs / 60_000, lockoutMinutes: cfg().lockMs / 60_000 };
}

export function resetLoginMonitorForTests() { entries.clear(); totals = { failures: 0, blocks: 0 }; }

setInterval(() => {
  const now = Date.now(); const { windowMs } = cfg();
  for (const [k, e] of entries) { prune(e, now, windowMs); if (!e.failures.length && e.blockedUntil <= now) entries.delete(k); }
}, 60_000).unref?.();
