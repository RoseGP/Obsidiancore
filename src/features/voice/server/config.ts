/**
 * IVR configuration (server only). All values come from environment variables.
 *
 *   Credentials are read ONLY from the environment (loaded from .env by `import 'dotenv/config'` in server.ts):
 *   TWILIO_AUTH_TOKEN        Required: verifies X-Twilio-Signature and authenticates the REST client
 *   TWILIO_ACCOUNT_SID       Required for SMS; also rejects webhooks from any other account
 *   TWILIO_SMS_FROM          SMS sender number (or TWILIO_MESSAGING_SERVICE_SID)
 *   IVR_MENU_PROFILE         "secure" (default: 1 SMS code · 2 Support · 0 Operator) or "classic" (1 Sales · 2 Support · 3 Operator)
 *   IVR_SUPPORT_NUMBER       Secure profile option 2 forward target (default +18005550199, 30 s timeout)
 *   IVR_ALLOWED_HOSTS        Comma-separated hosts Twilio may call (e.g. abc123.ngrok-free.app,crm.example.com).
 *                            Signatures are verified against protocol + Host of each request; this list rejects
 *                            requests whose Host isn't yours. Strongly recommended in production.
 *   IVR_TRUST_PROXY          "true" (default) to honour X-Forwarded-Proto from ngrok/load balancers
 *   IVR_PERSONALIZE          "true" (default) greets known callers by first name only
 *   IVR_OTP_SECRET           32+ chars HMAC key for stored codes (required in production for option 1)
 *   IVR_OTP_COUNTRY_CODES    Allowed SMS destinations (default "+1"); blocks SMS-pumping fraud
 *   IVR_OTP_MAX_PER_HOUR     Codes per number per hour (default 3)
 *   PUBLIC_BASE_URL          Optional: shown in the console as the webhook base (falls back to APP_URL)
 *   IVR_SKIP_SIGNATURE=true  Local testing only (ignored when NODE_ENV=production)
 *   IVR_BUSINESS_NAME        Spoken in the greeting (default "Obsidian")
 *   IVR_SALES_NUMBER         E.164 number for option 1 (default +18005550199)
 *   IVR_SUPPORT_QUEUE        Twilio queue name for support (default "support")
 *   IVR_BILLING_QUEUE        Twilio queue name for billing (default "billing")
 *   IVR_OPERATOR_NUMBER      E.164 agent number for option 3; if unset, the caller joins a conference
 *   IVR_OPERATOR_CONFERENCE  Conference room name (default "operator-room")
 *   IVR_CALLER_ID            Caller ID used for forwarded legs (must be a number you own in Twilio)
 *   IVR_TTS_VOICE            Twilio <Say> voice (default "Polly.Joanna-Neural"); IVR_TTS_LANGUAGE (default en-US)
 *   IVR_AUDIO_BASE_URL       Optional: folder of pre-recorded prompts, e.g. https://cdn.example.com/ivr
 *   IVR_AUDIO_PROMPTS        Optional JSON map of prompt key → file name or URL (see prompts.ts)
 *   IVR_HOLD_MUSIC_URL       Optional hold music for queues
 *   IVR_MAX_REPLAYS          Times the menu is replayed after no/invalid input (default 2)
 *   DOGRAH_BASE_URL          Optional: your self-hosted Dograh, e.g. https://dograh.example.com
 *                            Enables "press 4 for our AI assistant" via Dograh's inbound webhook.
 */
import crypto from 'node:crypto';

const E164 = /^\+[1-9]\d{6,14}$/;
const require_hash = (s: string) => crypto.createHash('sha256').update(s).digest();
const randomKey = () => crypto.randomBytes(32);

export interface IvrConfig {
  profile: 'secure' | 'classic';
  supportNumber: string;
  allowedHosts: string[];
  trustProxy: boolean;
  personalize: boolean;
  otpSecret: Buffer | null;
  otpCountryCodes: string[];
  otpMaxPerHour: number;
  smsConfigured: boolean;
  publicBaseUrl: string;
  authToken: string;
  accountSid: string;
  skipSignature: boolean;
  isProduction: boolean;
  businessName: string;
  salesNumber: string;
  supportQueue: string;
  billingQueue: string;
  operatorNumber: string;
  operatorConference: string;
  callerId: string;
  voice: string;
  language: string;
  audioBaseUrl: string;
  audioPrompts: Record<string, string>;
  holdMusicUrl: string;
  maxReplays: number;
  dograhBaseUrl: string;
  problems: string[];
}

const trimSlash = (s: string) => s.replace(/\/+$/, '');
const safeName = (s: string, d: string) => (/^[A-Za-z0-9_-]{1,64}$/.test(s) ? s : d);

export function loadIvrConfig(env: NodeJS.ProcessEnv = process.env): IvrConfig {
  const problems: string[] = [];
  const isProduction = env.NODE_ENV === 'production';
  const num = (key: string, fallback = '') => {
    const v = (env[key] || '').replace(/[\s()-]/g, '') || fallback;
    if (v && !E164.test(v)) { problems.push(`${key} must be an E.164 number like +18005550199.`); return ''; }
    return v;
  };
  let audioPrompts: Record<string, string> = {};
  if (env.IVR_AUDIO_PROMPTS) {
    try { audioPrompts = JSON.parse(env.IVR_AUDIO_PROMPTS); } catch { problems.push('IVR_AUDIO_PROMPTS is not valid JSON.'); }
  }
  const publicBaseUrl = trimSlash(env.PUBLIC_BASE_URL || env.APP_URL || '');
  const allowedHosts = (env.IVR_ALLOWED_HOSTS || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
  if (isProduction && allowedHosts.length === 0) problems.push('Set IVR_ALLOWED_HOSTS to the host name(s) Twilio calls.');
  const profile = env.IVR_MENU_PROFILE === 'classic' ? 'classic' : 'secure';
  const rawOtp = env.IVR_OTP_SECRET || '';
  let otpSecret: Buffer | null = null;
  if (rawOtp.length >= 32) otpSecret = require_hash(rawOtp);
  else if (!isProduction) otpSecret = randomKey(); // dev only: codes stop verifying after a restart
  else if (profile === 'secure') problems.push('Set IVR_OTP_SECRET (32+ characters) to enable SMS login codes.');
  const smsConfigured = !!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && (env.TWILIO_SMS_FROM || env.TWILIO_MESSAGING_SERVICE_SID));
  if (profile === 'secure' && !smsConfigured) problems.push('SMS codes need TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_SMS_FROM (or TWILIO_MESSAGING_SERVICE_SID).');
  const otpCountryCodes = (env.IVR_OTP_COUNTRY_CODES || '+1').split(',').map((c) => c.trim()).filter((c) => /^\+\d{1,4}$/.test(c));
  const authToken = env.TWILIO_AUTH_TOKEN || '';
  const skipSignature = !isProduction && env.IVR_SKIP_SIGNATURE === 'true';
  if (!authToken && !skipSignature) problems.push('Set TWILIO_AUTH_TOKEN so webhook signatures can be verified.');
  const dograhBaseUrl = trimSlash(env.DOGRAH_BASE_URL || '');
  if (dograhBaseUrl && !/^https?:\/\//.test(dograhBaseUrl)) problems.push('DOGRAH_BASE_URL must start with http:// or https://');
  const maxReplays = Math.min(Math.max(parseInt(env.IVR_MAX_REPLAYS || '2', 10) || 2, 0), 5);

  return {
    profile, supportNumber: num('IVR_SUPPORT_NUMBER', '+18005550199'), allowedHosts,
    trustProxy: env.IVR_TRUST_PROXY !== 'false', personalize: env.IVR_PERSONALIZE !== 'false',
    otpSecret, otpCountryCodes: otpCountryCodes.length ? otpCountryCodes : ['+1'],
    otpMaxPerHour: Math.min(Math.max(parseInt(env.IVR_OTP_MAX_PER_HOUR || '3', 10) || 3, 1), 10), smsConfigured,
    publicBaseUrl, authToken, accountSid: env.TWILIO_ACCOUNT_SID || '', skipSignature, isProduction,
    businessName: (env.IVR_BUSINESS_NAME || 'Obsidian').slice(0, 60),
    salesNumber: num('IVR_SALES_NUMBER', '+18005550199'),
    supportQueue: safeName(env.IVR_SUPPORT_QUEUE || '', 'support'),
    billingQueue: safeName(env.IVR_BILLING_QUEUE || '', 'billing'),
    operatorNumber: num('IVR_OPERATOR_NUMBER'),
    operatorConference: safeName(env.IVR_OPERATOR_CONFERENCE || '', 'operator-room'),
    callerId: num('IVR_CALLER_ID'),
    voice: env.IVR_TTS_VOICE || 'Polly.Joanna-Neural',
    language: env.IVR_TTS_LANGUAGE || 'en-US',
    audioBaseUrl: trimSlash(env.IVR_AUDIO_BASE_URL || ''),
    audioPrompts,
    holdMusicUrl: env.IVR_HOLD_MUSIC_URL || '',
    maxReplays,
    dograhBaseUrl: dograhBaseUrl && /^https?:\/\//.test(dograhBaseUrl) ? dograhBaseUrl : '',
    problems,
  };
}

/** Masks phone numbers for logs and UI: +1******0199 */
export const maskNumber = (n?: string) => (n && n.length > 6 ? `${n.slice(0, 2)}${'*'.repeat(Math.max(n.length - 6, 2))}${n.slice(-4)}` : n ? '****' : '');
