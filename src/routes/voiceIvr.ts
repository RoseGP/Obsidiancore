/**
 * Voice IVR — /api/voice   (Twilio Programmable Voice; see docs/voice-ivr/README.md)
 *
 * Twilio webhooks. Order of middleware: flood limit → forgery limit → X-Twilio-Signature
 * check (403 before any business logic) → payload validation → per-call limit → handler.
 *   POST /inbound            greeting (personalised for known callers) + menu
 *   POST /menu?attempt=n     menu choice (Digits)
 *   POST /support?attempt=n  classic-profile support sub-menu
 *   POST /queue-wait         hold loop while queued
 *   POST /dial-status?dest=  result of a forwarded call
 *   POST /status             call status callback
 *
 * App endpoints:
 *   POST /otp/verify         verify an SMS login code   (rate limited, origin-checked)
 *   GET  /ivr/config         console: configuration status (signed-in user)
 *   POST /ivr/simulate       console: run a flow step without Twilio (no SMS sent)
 *   GET  /ivr/calls          console: recent call events (masked)
 */
import { Router, type Request, type Response } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { z } from 'zod';
import { requireUser } from '../features/social-accounts/server/auth';
import { csrfGuard, sendError } from '../features/social-accounts/server/http';
import { config as appConfig } from '../features/social-accounts/server/instance';
import { loadIvrConfig, maskNumber } from '../features/voice/server/config';
import { createSimulatedCallerDirectory, E164, simulatedCallersFromEnv, type CallerDirectory, type CallerRecord } from '../features/voice/server/callers';
import { createMemoryOtpStore, createOtpService, createTwilioSmsSender, type SendResult, type SmsSender } from '../features/voice/server/otp';
import { dialStatusTwiml, errorTwiml, inboundTwiml, menuTwiml, queueWaitTwiml, supportTwiml } from '../features/voice/server/flow';
import { PROMPTS } from '../features/voice/server/prompts';
import { recentEvents, recordEvent } from '../features/voice/server/callLog';
import { cleanAttempt, cleanDigits, expectedUrl, log, sendTwiml, validatePayload, verifyTwilio } from '../features/voice/server/webhook';

/**
 * Builds the IVR router. Defaults read the environment; tests inject a caller
 * directory and SMS sender so no real messages are ever sent.
 */
export function createVoiceIvrRouter(deps: { env?: NodeJS.ProcessEnv; callers?: CallerDirectory; sms?: SmsSender | null } = {}) {
const env = deps.env ?? process.env;
const cfg = loadIvrConfig(env);
for (const p of cfg.problems) console.warn(`[voice-ivr] ${p}`);
if (cfg.skipSignature) console.warn('[voice-ivr] IVR_SKIP_SIGNATURE=true: Twilio signatures are NOT verified (local testing only).');

// Swap for your real user database (same interface). See callers.ts.
const callers: CallerDirectory = deps.callers ?? createSimulatedCallerDirectory(simulatedCallersFromEnv(env));
const otp = createOtpService(createMemoryOtpStore(), deps.sms !== undefined ? deps.sms : createTwilioSmsSender(env), {
  secret: cfg.otpSecret ?? Buffer.alloc(32), ttlMs: 10 * 60_000, maxAttempts: 5, maxSendsPerHour: cfg.otpMaxPerHour,
  allowedCountryCodes: cfg.otpCountryCodes, brand: cfg.businessName,
});

/** Resolves within `ms`, or yields `fallback` (Twilio waits at most 15 s for a webhook response). */
const within = <T,>(p: Promise<T>, ms: number, fallback: T) => Promise.race([p.catch(() => fallback), new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);
const lookup = (from: unknown): Promise<CallerRecord | null> => (typeof from === 'string' && E164.test(from) ? within(callers.findByPhone(from), 2_000, null) : Promise.resolve(null));

// ---- Rate limiting (express-rate-limit) ----
const clientIp = (req: Request) => {
  const fwd = cfg.trustProxy ? String(req.get('x-forwarded-for') || '').split(',')[0].trim() : '';
  return ipKeyGenerator(fwd || req.ip || req.socket.remoteAddress || '0.0.0.0');
};
const limiter = (name: string, opts: { windowMs: number; limit: number; key?: (req: Request) => string; skipSuccessfulRequests?: boolean; twiml?: boolean }) => rateLimit({
  windowMs: opts.windowMs, limit: opts.limit, standardHeaders: 'draft-8', legacyHeaders: false,
  skipSuccessfulRequests: opts.skipSuccessfulRequests ?? false,
  keyGenerator: (req) => `${name}:${(opts.key ?? clientIp)(req)}`,
  validate: { xForwardedForHeader: false, trustProxy: false, keyGeneratorIpFallback: false },
  handler: (req, res) => {
    log('rate limited', { limiter: name, path: req.path });
    if (opts.twiml) sendTwiml(res, errorTwiml(cfg), 429); else res.status(429).json({ code: 'rate_limited', error: 'Too many requests. Try again later.' });
  },
});
// Twilio sends from shared IP pools: keep the per-IP flood cap generous…
const floodLimit = limiter('voice-flood', { windowMs: 60_000, limit: 600, twiml: true });
// …but count only rejected requests (bad signatures etc.) strictly, which stops forgery floods fast.
const forgeryLimit = limiter('voice-forged', { windowMs: 10 * 60_000, limit: 20, skipSuccessfulRequests: true });
// After verification: cap requests per call to stop redirect loops.
const perCallLimit = limiter('voice-call', { windowMs: 60_000, limit: 40, key: (req) => String(req.body?.CallSid || 'none'), twiml: true });
const twilioHook = [floodLimit, forgeryLimit, verifyTwilio(cfg), validatePayload(cfg), perCallLimit];

/** Any failure becomes polite TwiML (Twilio otherwise plays "an application error has occurred"). */
const hook = (name: string, fn: (req: Request) => string | Promise<string>) => async (req: Request, res: Response) => {
  try { sendTwiml(res, await fn(req)); }
  catch (err: any) {
    log(`${name} failed`, { error: String(err?.message ?? err).slice(0, 200), CallSid: req.body?.CallSid });
    sendTwiml(res, errorTwiml(cfg));
  }
};

const router = Router();

router.post('/inbound', ...twilioHook, hook('inbound', async (req) => {
  const caller = cfg.profile === 'secure' ? await lookup(req.body.From) : null;
  recordEvent(req.body.CallSid, 'inbound', `Call started${caller ? ' (known caller)' : ''}`, req.body.From);
  log('inbound call', { CallSid: req.body.CallSid, From: req.body.From, known: !!caller });
  return inboundTwiml(cfg, { caller, skipGreeting: req.query.returning === '1' });
}));

router.post('/menu', ...twilioHook, hook('menu', async (req) => {
  const raw = cleanDigits(req.body.Digits);
  const digits = raw === 'invalid' ? 'x' : raw;
  const attempt = cleanAttempt(req.query.attempt);
  let otpResult: SendResult | undefined;
  if (cfg.profile === 'secure' && digits === '1') {
    // Send to the number on file for this caller only (never to caller-supplied input).
    const from = String(req.body.From || '');
    const caller = await lookup(from);
    otpResult = E164.test(from) ? await within(otp.send(from, caller?.userId ?? null), 10_000, { status: 'failed' } as SendResult) : { status: 'blocked_destination' };
    log('otp request', { CallSid: req.body.CallSid, From: from, outcome: otpResult.status }); // never log the code
  }
  recordEvent(req.body.CallSid, 'menu', raw ? `Pressed ${raw === 'invalid' ? 'an invalid key' : raw}${otpResult ? ` (SMS code: ${otpResult.status})` : ''}` : `No input (attempt ${attempt + 1})`, req.body.From);
  return menuTwiml(cfg, digits, attempt, { otp: otpResult });
}));

router.post('/support', ...twilioHook, hook('support', (req) => {
  const raw = cleanDigits(req.body.Digits);
  const attempt = cleanAttempt(req.query.attempt);
  recordEvent(req.body.CallSid, 'support', raw ? `Support: pressed ${raw === 'invalid' ? 'an invalid key' : raw}` : `Support: no input (attempt ${attempt + 1})`, req.body.From);
  return supportTwiml(cfg, raw === 'invalid' ? 'x' : raw, attempt);
}));

router.post('/queue-wait', ...twilioHook, hook('queue-wait', (req) => {
  const pos = parseInt(String(req.body.QueuePosition ?? ''), 10);
  return queueWaitTwiml(cfg, Number.isFinite(pos) ? pos : null);
}));

router.post('/dial-status', ...twilioHook, hook('dial-status', (req) => {
  const dest = ['operator', 'support'].includes(String(req.query.dest)) ? String(req.query.dest) : 'sales';
  const status = String(req.body.DialCallStatus || 'failed');
  recordEvent(req.body.CallSid, 'dial', `${dest}: ${status}`, req.body.From);
  return dialStatusTwiml(cfg, dest, status);
}));

router.post('/status', ...twilioHook, (req, res) => {
  recordEvent(req.body.CallSid, 'status', String(req.body.CallStatus || 'unknown'), req.body.From);
  res.status(204).end();
});

// ---- SMS code verification (called by the app's login screen) ----
router.post('/otp/verify', limiter('otp-verify', { windowMs: 15 * 60_000, limit: 10 }), csrfGuard(appConfig.appUrl), (req, res) => {
  const b = z.object({ phone: z.string().regex(/^\+[1-9]\d{6,14}$/), code: z.string().regex(/^\d{6}$/) }).strict().safeParse(req.body ?? {});
  if (!b.success) { res.status(400).json({ code: 'invalid_input', error: 'Enter the 6-digit code.' }); return; }
  const r = otp.verify(b.data.phone, b.data.code);
  if ('reason' in r) { // explicit narrowing (works under the project's non-strict TS settings too)
    res.status(r.reason === 'locked' ? 429 : 401).json({ code: r.reason, error: r.reason === 'locked' ? 'Too many attempts. Request a new code.' : 'That code is invalid or has expired.' });
    return;
  }
  // Integrate here: create the user's session for r.userId (e.g. sign your session JWT / Firebase custom token).
  res.json({ verified: true });
});

// ---- Console API (signed-in users) ----
const app = Router();
app.use(requireUser, csrfGuard(appConfig.appUrl), limiter('voice-console', { windowMs: 60_000, limit: 60, key: (req) => String((req as any).accountUser?.id || clientIp(req)) }));

app.get('/config', (req, res) => {
  const base = cfg.publicBaseUrl || (() => { const { url } = expectedUrl(req, cfg); return url.replace(/\/api\/voice\/ivr\/config.*$/, ''); })();
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    ready: cfg.problems.length === 0, problems: cfg.problems, profile: cfg.profile,
    signatureVerification: cfg.skipSignature ? 'disabled (local testing)' : cfg.authToken ? 'enabled' : 'not configured',
    allowedHosts: cfg.allowedHosts,
    webhooks: { voiceUrl: `${base}/api/voice/inbound`, statusCallback: `${base}/api/voice/status` },
    routing: {
      sales: maskNumber(cfg.salesNumber), supportNumber: maskNumber(cfg.supportNumber),
      support: { billingQueue: cfg.billingQueue, technicalQueue: cfg.supportQueue },
      operator: cfg.operatorNumber ? { mode: 'number', number: maskNumber(cfg.operatorNumber) } : { mode: 'conference', room: cfg.operatorConference },
      dograh: cfg.dograhBaseUrl ? { enabled: true, inboundUrl: `${cfg.dograhBaseUrl}/api/v1/telephony/inbound/run` } : { enabled: false },
    },
    sms: { configured: cfg.smsConfigured, countryCodes: cfg.otpCountryCodes, maxPerHour: cfg.otpMaxPerHour },
    personalize: cfg.personalize,
    tts: { voice: cfg.voice, language: cfg.language, recordedPrompts: Object.keys(cfg.audioPrompts) },
    maxReplays: cfg.maxReplays,
    script: Object.fromEntries(Object.entries(PROMPTS).map(([k, f]) => [k, (f as any)(cfg)])),
  });
});

const simBody = z.object({
  step: z.enum(['inbound', 'menu', 'support', 'queue-wait', 'dial-status']),
  digits: z.string().max(10).optional(), attempt: z.number().int().min(0).max(10).optional(),
  dest: z.enum(['sales', 'support', 'operator']).optional(),
  dialStatus: z.enum(['completed', 'busy', 'no-answer', 'failed', 'canceled']).optional(),
  queuePosition: z.number().int().min(0).max(999).optional(),
  callerName: z.string().max(80).optional(),
}).strict();

app.post('/simulate', (req, res) => {
  try {
    const b = simBody.parse(req.body ?? {});
    const raw = cleanDigits(b.digits ?? ''); const d = raw === 'invalid' ? 'x' : raw;
    const caller = b.callerName ? { userId: 'sim', fullName: b.callerName, phoneE164: '+10000000000' } : null;
    const smsStep = cfg.profile === 'secure' && b.step === 'menu' && d === '1';
    const twiml = b.step === 'inbound' ? inboundTwiml(cfg, { caller })
      : b.step === 'menu' ? menuTwiml(cfg, d, b.attempt ?? 0, smsStep ? { otp: { status: 'sent' } } : {})
      : b.step === 'support' ? supportTwiml(cfg, d, b.attempt ?? 0)
      : b.step === 'queue-wait' ? queueWaitTwiml(cfg, b.queuePosition ?? null)
      : dialStatusTwiml(cfg, b.dest ?? 'sales', b.dialStatus ?? 'no-answer');
    res.json({ twiml, note: smsStep ? 'Simulator: no SMS was sent. On a real call the code goes to the caller’s number on file.' : undefined });
  } catch (err) { sendError(res, err, 'ivr simulate'); }
});

app.get('/calls', (_req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json({ events: recentEvents() }); });

router.use('/ivr', app);
return router;
}

export default createVoiceIvrRouter();
