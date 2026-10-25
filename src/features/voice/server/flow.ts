/**
 * IVR call flow as pure TwiML builders (no I/O). Every branch is unit-testable,
 * and the console's simulator runs exactly the code Twilio hits.
 *
 * Callback URLs are RELATIVE paths: Twilio resolves them against the URL of the
 * request it is answering, so the Host header is never written into TwiML.
 *
 * Profiles (IVR_MENU_PROFILE):
 *  secure (default)  greeting (personalised if the caller is known) →
 *                    1 SMS login code then hang up · 2 forward to Support (30 s) · 0 Operator · [4 Dograh AI]
 *  classic           1 Sales · 2 Support sub-menu (queues) · 3 Operator · [4 Dograh AI]
 *  Both: no/invalid input → menu repeated (IVR_MAX_REPLAYS, default 2) → goodbye + <Hangup>.
 */
import twilio from 'twilio';
import type { IvrConfig } from './config';
import type { CallerRecord } from './callers';
import type { SendResult } from './otp';
import { sayText, speak, type PromptKey } from './prompts';
import { speakableFirstName } from './sanitize';

type VoiceResponse = InstanceType<typeof twilio.twiml.VoiceResponse>;
const GATHER_TIMEOUT_SECONDS = 10;
const DIAL_TIMEOUT_SECONDS = 25;
const SUPPORT_DIAL_TIMEOUT_SECONDS = 30;

/** Relative callback URL (resolved by Twilio against the current request URL). */
export function cbUrl(_c: IvrConfig, path: string, params: Record<string, string | number> = {}) {
  const q = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();
  return `${path}${q ? `?${q}` : ''}`;
}

function menuGather(r: VoiceResponse, c: IvrConfig, attempt: number) {
  const action = cbUrl(c, '/api/voice/menu', { attempt });
  const g = r.gather({ input: ['dtmf'], numDigits: 1, timeout: GATHER_TIMEOUT_SECONDS, action, method: 'POST', actionOnEmptyResult: true });
  speak(g, c, c.profile === 'secure' ? 'secureMenu' : 'mainMenu'); // inside <Gather>: callers can press a key early
  r.redirect({ method: 'POST' }, action); // fallback if actionOnEmptyResult is ignored: counts as "no input"
}

function supportGather(r: VoiceResponse, c: IvrConfig, attempt: number) {
  const action = cbUrl(c, '/api/voice/support', { attempt });
  const g = r.gather({ input: ['dtmf'], numDigits: 1, timeout: GATHER_TIMEOUT_SECONDS, action, method: 'POST', actionOnEmptyResult: true, finishOnKey: '' });
  speak(g, c, 'supportMenu');
  r.redirect({ method: 'POST' }, action);
}

/** Hands the live call to a Dograh voice-AI workflow (Dograh picks the workflow from the called number). */
function toDograh(r: VoiceResponse, c: IvrConfig) {
  speak(r, c, 'aiAssistant');
  // Dograh: POST {base}/api/v1/telephony/inbound/run (api/routes/telephony.py, handle_inbound_run).
  r.redirect({ method: 'POST' }, `${c.dograhBaseUrl}/api/v1/telephony/inbound/run`);
}

function enqueue(r: VoiceResponse, c: IvrConfig, queue: string) {
  speak(r, c, 'queueJoin');
  r.enqueue({ waitUrl: cbUrl(c, '/api/voice/queue-wait', { queue }), waitUrlMethod: 'POST' }, queue);
}

function operator(r: VoiceResponse, c: IvrConfig) {
  speak(r, c, 'operator');
  const action = cbUrl(c, '/api/voice/dial-status', { dest: 'operator' });
  if (c.operatorNumber) {
    r.dial({ action, method: 'POST', timeout: DIAL_TIMEOUT_SECONDS, answerOnBridge: true, ...(c.callerId ? { callerId: c.callerId } : {}) }).number(c.operatorNumber);
  } else {
    // Bridge into a conference: caller waits (hold music) until an agent joins with startConferenceOnEnter=true.
    r.dial({ action, method: 'POST' }).conference({ startConferenceOnEnter: false, endConferenceOnExit: true, beep: 'false', ...(c.holdMusicUrl ? { waitUrl: c.holdMusicUrl, waitMethod: 'GET' } : {}) } as any, c.operatorConference);
  }
}

function retryOrHangup(r: VoiceResponse, c: IvrConfig, attempt: number, hadInput: boolean, replay: (n: number) => void) {
  if (attempt < c.maxReplays) { speak(r, c, hadInput ? 'invalid' : 'noInput'); replay(attempt + 1); }
  else { speak(r, c, 'goodbye'); r.hangup(); }
}

export function inboundTwiml(c: IvrConfig, opts: { skipGreeting?: boolean; caller?: CallerRecord | null } = {}) {
  const r = new twilio.twiml.VoiceResponse();
  if (!opts.skipGreeting) {
    if (c.profile === 'secure') {
      const first = c.personalize && opts.caller ? speakableFirstName(opts.caller.fullName) : '';
      // Dynamic text → sanitized, then XML-escaped by the SDK. First name only: caller ID can be spoofed.
      if (first) sayText(r, c, `Welcome back, ${first}. Thank you for calling ${c.businessName}.`);
      else speak(r, c, 'greetingGeneric');
    } else speak(r, c, 'greeting');
  }
  menuGather(r, c, 0);
  return r.toString();
}

/** Spoken outcome of an SMS code request. Privacy mode (personalize off) uses one neutral message for every outcome. */
function otpPrompt(c: IvrConfig, result: SendResult): PromptKey {
  if (!c.personalize && result.status !== 'unavailable' && result.status !== 'failed') return 'otpNeutral';
  switch (result.status) {
    case 'sent': return 'otpSent';
    case 'not_registered': return 'otpNotRegistered';
    case 'rate_limited': return 'otpRateLimited';
    case 'blocked_destination': return 'otpBlocked';
    default: return 'otpUnavailable';
  }
}

export interface MenuContext { otp?: SendResult }

export function menuTwiml(c: IvrConfig, digits: string, attempt: number, ctx: MenuContext = {}) {
  const r = new twilio.twiml.VoiceResponse();
  const retry = (hadInput: boolean) => retryOrHangup(r, c, attempt, hadInput, (n) => menuGather(r, c, n));

  if (c.profile === 'secure') {
    switch (digits) {
      case '1':
        // The route sends the SMS first (Twilio REST API) and passes the outcome in ctx.otp.
        speak(r, c, otpPrompt(c, ctx.otp ?? { status: 'unavailable' }));
        speak(r, c, 'thanksGoodbye');
        r.hangup();
        break;
      case '2':
        speak(r, c, 'supportTransfer');
        r.dial({ action: cbUrl(c, '/api/voice/dial-status', { dest: 'support' }), method: 'POST', timeout: SUPPORT_DIAL_TIMEOUT_SECONDS, answerOnBridge: true, ...(c.callerId ? { callerId: c.callerId } : {}) }).number(c.supportNumber);
        break;
      case '0': operator(r, c); break;
      case '4': if (c.dograhBaseUrl) toDograh(r, c); else retry(true); break;
      default: retry(digits !== '');
    }
    return r.toString();
  }

  switch (digits) {
    case '1':
      speak(r, c, 'sales');
      r.dial({ action: cbUrl(c, '/api/voice/dial-status', { dest: 'sales' }), method: 'POST', timeout: DIAL_TIMEOUT_SECONDS, answerOnBridge: true, ...(c.callerId ? { callerId: c.callerId } : {}) }).number(c.salesNumber);
      break;
    case '2': supportGather(r, c, 0); break;
    case '3': operator(r, c); break;
    case '4': if (c.dograhBaseUrl) toDograh(r, c); else retry(true); break;
    default: retry(digits !== '');
  }
  return r.toString();
}

export function supportTwiml(c: IvrConfig, digits: string, attempt: number) {
  const r = new twilio.twiml.VoiceResponse();
  switch (digits) {
    case '1': enqueue(r, c, c.billingQueue); break;
    case '2': enqueue(r, c, c.supportQueue); break;
    case '3': speak(r, c, 'supportHours'); supportGather(r, c, attempt); break;
    case '4': if (c.dograhBaseUrl) { toDograh(r, c); break; } retryOrHangup(r, c, attempt, true, (n) => supportGather(r, c, n)); break;
    case '*': speak(r, c, 'returningToMenu'); menuGather(r, c, 0); break;
    default: retryOrHangup(r, c, attempt, digits !== '', (n) => supportGather(r, c, n));
  }
  return r.toString();
}

export function queueWaitTwiml(c: IvrConfig, position: number | null) {
  const r = new twilio.twiml.VoiceResponse();
  if (position && position > 0) sayText(r, c, position === 1 ? 'You are next in line.' : `You are number ${position} in line.`);
  sayText(r, c, 'Thank you for holding. An agent will be with you shortly.');
  if (c.holdMusicUrl) r.play({ loop: 1 }, c.holdMusicUrl); else r.pause({ length: 20 });
  return r.toString();
}

export function dialStatusTwiml(c: IvrConfig, dest: string, dialStatus: string) {
  const r = new twilio.twiml.VoiceResponse();
  if (dialStatus === 'completed' || dialStatus === 'answered') { r.hangup(); return r.toString(); }
  speak(r, c, dest === 'sales' ? 'salesUnavailable' : dest === 'support' ? 'supportUnavailable' : 'operatorUnavailable');
  speak(r, c, 'returningToMenu');
  menuGather(r, c, 0);
  return r.toString();
}

export function errorTwiml(c: IvrConfig) {
  const r = new twilio.twiml.VoiceResponse();
  speak(r, c, 'error');
  r.hangup();
  return r.toString();
}
