/**
 * Twilio webhook hardening: signature verification, payload validation,
 * TwiML responses that never leak errors to callers, and masked logging.
 */
import type { NextFunction, Request, Response } from 'express';
import twilio from 'twilio';
import { maskNumber, type IvrConfig } from './config';
import { errorTwiml } from './flow';

export const sendTwiml = (res: Response, xml: string, status = 200) => {
  res.status(status).type('text/xml').setHeader('Cache-Control', 'no-store');
  res.send(xml);
};

export const log = (msg: string, meta: Record<string, unknown> = {}) => {
  const safe: Record<string, unknown> = { ...meta };
  for (const k of ['From', 'To', 'Caller', 'Called', 'from', 'to']) if (typeof safe[k] === 'string') safe[k] = maskNumber(safe[k] as string);
  console.log(`[voice-ivr] ${msg}`, JSON.stringify(safe));
};

/**
 * The URL Twilio signed, rebuilt from this request: protocol + Host + original path and query.
 * Behind ngrok or a load balancer the TLS terminates upstream, so X-Forwarded-Proto
 * (first value) is honoured when IVR_TRUST_PROXY is on. Spoofing it gains nothing:
 * the signature still requires the auth token.
 */
export function expectedUrl(req: Request, cfg: IvrConfig): { url: string; host: string } {
  const fwd = cfg.trustProxy ? String(req.get('x-forwarded-proto') || '').split(',')[0].trim().toLowerCase() : '';
  const proto = fwd === 'https' || fwd === 'http' ? fwd : req.protocol;
  const host = String(req.get('host') || '').trim();
  return { url: `${proto}://${host}${req.originalUrl}`, host };
}

/** Verifies X-Twilio-Signature with twilio.validateRequest before any business logic runs. */
export function verifyTwilio(cfg: IvrConfig) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (cfg.skipSignature) return next(); // local testing only; never in production
    if (!cfg.authToken) {
      log('rejected: TWILIO_AUTH_TOKEN not configured');
      return sendTwiml(res, errorTwiml(cfg), 503);
    }
    const { url, host } = expectedUrl(req, cfg);
    const hostname = host.toLowerCase().replace(/:\d+$/, '');
    if (!hostname || (cfg.allowedHosts.length && !cfg.allowedHosts.includes(hostname))) {
      log('rejected: Host not allowed', { host: hostname.slice(0, 100) });
      res.status(403).type('text/plain').send('Forbidden');
      return;
    }
    const signature = req.get('X-Twilio-Signature') || '';
    const params = req.body && typeof req.body === 'object' ? req.body : {};
    // validateRequest also tries the URL with and without the default port, as Twilio may sign either.
    if (!signature || !twilio.validateRequest(cfg.authToken, signature, url, params)) {
      log('rejected: invalid Twilio signature', { path: req.path });
      res.status(403).type('text/plain').send('Forbidden');
      return;
    }
    next();
  };
}

const CALL_SID = /^CA[0-9a-f]{32}$/;
const ACCOUNT_SID = /^AC[0-9a-f]{32}$/;

/** Rejects malformed webhook bodies before any call logic runs. */
export function validatePayload(cfg: IvrConfig) {
  return (req: Request, res: Response, next: NextFunction) => {
    const b = req.body || {};
    if (typeof b.CallSid !== 'string' || !CALL_SID.test(b.CallSid)) {
      log('rejected: missing or malformed CallSid', { path: req.path });
      return sendTwiml(res, errorTwiml(cfg), 400);
    }
    if (typeof b.AccountSid !== 'string' || !ACCOUNT_SID.test(b.AccountSid) || (cfg.accountSid && b.AccountSid !== cfg.accountSid)) {
      log('rejected: unexpected AccountSid', { path: req.path });
      return sendTwiml(res, errorTwiml(cfg), 403);
    }
    next();
  };
}

/** Digits are user input: only 0-9 * # are meaningful; anything else counts as an invalid choice. */
export const cleanDigits = (v: unknown) => (typeof v === 'string' && /^[0-9*#]{1,10}$/.test(v) ? v : typeof v === 'string' && v === '' ? '' : v === undefined ? '' : 'invalid');
export const cleanAttempt = (v: unknown) => Math.min(Math.max(parseInt(String(v ?? '0'), 10) || 0, 0), 10);
