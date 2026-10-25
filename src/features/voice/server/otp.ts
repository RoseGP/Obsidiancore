/**
 * One-time login codes delivered by SMS.
 *
 * - 6 digits from crypto.randomInt (uniform, CSPRNG).
 * - Stored only as HMAC-SHA256(secret, phone|code); compared in constant time.
 * - Expire after 10 minutes, single use, locked after 5 wrong attempts.
 * - Send limits per phone number (default 3/hour) to stop SMS bombing, and a
 *   country-code allowlist (default +1) to stop SMS-pumping toll fraud.
 * - Codes never appear in logs or API responses.
 *
 * The store is in memory (per instance). For several instances, implement
 * OtpStore over Redis with the same semantics (SET with TTL, atomic increments).
 */
import crypto from 'node:crypto';
import twilio from 'twilio';

export interface OtpEntry { hash: string; expiresAt: number; attempts: number; userId: string }
export interface OtpStore {
  put(phone: string, entry: OtpEntry): void;
  get(phone: string): OtpEntry | undefined;
  delete(phone: string): void;
  /** Records a send and returns how many sends happened inside the window. */
  countSend(phone: string, windowMs: number): number;
}

export function createMemoryOtpStore(): OtpStore {
  const codes = new Map<string, OtpEntry>();
  const sends = new Map<string, number[]>();
  return {
    put: (p, e) => { codes.set(p, e); },
    get: (p) => { const e = codes.get(p); if (e && e.expiresAt < Date.now()) { codes.delete(p); return undefined; } return e; },
    delete: (p) => { codes.delete(p); },
    countSend: (p, windowMs) => {
      const now = Date.now();
      const list = (sends.get(p) ?? []).filter((t) => t > now - windowMs);
      list.push(now); sends.set(p, list);
      return list.length;
    },
  };
}

export interface SmsSender { send(to: string, body: string): Promise<{ sid: string }> }

/** Twilio REST client sender. Credentials come only from the environment. */
export function createTwilioSmsSender(env: NodeJS.ProcessEnv): SmsSender | null {
  const sid = env.TWILIO_ACCOUNT_SID; const token = env.TWILIO_AUTH_TOKEN;
  const from = env.TWILIO_SMS_FROM; const service = env.TWILIO_MESSAGING_SERVICE_SID;
  if (!sid || !token || (!from && !service)) return null;
  const client = twilio(sid, token, { timeout: 8_000, autoRetry: true, maxRetries: 2 });
  return {
    async send(to, body) {
      const msg = await client.messages.create({ to, body, ...(service ? { messagingServiceSid: service } : { from }) });
      return { sid: msg.sid };
    },
  };
}

export type SendResult =
  | { status: 'sent' }
  | { status: 'not_registered' }
  | { status: 'rate_limited' }
  | { status: 'blocked_destination' }
  | { status: 'unavailable' }
  | { status: 'failed' };

export interface OtpOptions { secret: Buffer; ttlMs: number; maxAttempts: number; maxSendsPerHour: number; allowedCountryCodes: string[]; brand: string }

export function createOtpService(store: OtpStore, sms: SmsSender | null, opt: OtpOptions) {
  const hash = (phone: string, code: string) => crypto.createHmac('sha256', opt.secret).update(`${phone}|${code}`).digest('hex');
  const allowed = (phone: string) => opt.allowedCountryCodes.some((cc) => phone.startsWith(cc));

  return {
    /** Sends a code to the registered number. `userId` must come from your own lookup. */
    async send(phone: string, userId: string | null): Promise<SendResult> {
      if (!sms) return { status: 'unavailable' };
      if (!allowed(phone)) return { status: 'blocked_destination' };
      if (!userId) return { status: 'not_registered' };
      if (store.countSend(phone, 3_600_000) > opt.maxSendsPerHour) return { status: 'rate_limited' };
      const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
      store.put(phone, { hash: hash(phone, code), expiresAt: Date.now() + opt.ttlMs, attempts: 0, userId });
      try {
        await sms.send(phone, `Your ${opt.brand} login code is ${code}. It expires in ${Math.round(opt.ttlMs / 60_000)} minutes. Never share it with anyone.`);
        return { status: 'sent' };
      } catch {
        store.delete(phone);
        return { status: 'failed' };
      }
    },

    /** Constant-time check; single use; locks after maxAttempts. */
    verify(phone: string, code: string): { ok: true; userId: string } | { ok: false; reason: 'invalid' | 'expired' | 'locked' } {
      const e = store.get(phone);
      if (!e) return { ok: false, reason: 'expired' };
      if (e.attempts >= opt.maxAttempts) { store.delete(phone); return { ok: false, reason: 'locked' }; }
      const a = Buffer.from(hash(phone, code), 'hex'); const b = Buffer.from(e.hash, 'hex');
      if (/^\d{6}$/.test(code) && a.length === b.length && crypto.timingSafeEqual(a, b)) { store.delete(phone); return { ok: true, userId: e.userId }; }
      e.attempts += 1;
      if (e.attempts >= opt.maxAttempts) { store.delete(phone); return { ok: false, reason: 'locked' }; }
      return { ok: false, reason: 'invalid' };
    },
  };
}

export type OtpService = ReturnType<typeof createOtpService>;
