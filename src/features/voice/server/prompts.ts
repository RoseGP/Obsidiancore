/**
 * Every spoken line of the IVR, in one place.
 *
 * ── Swapping Text-to-Speech for pre-recorded audio ──────────────────────────
 * Each prompt is spoken with <Say> (Amazon Polly neural voice by default) unless
 * an audio file is configured for its key. Then <Play> is used instead:
 *
 *   IVR_AUDIO_BASE_URL=https://cdn.example.com/ivr
 *   IVR_AUDIO_PROMPTS={"greeting":"greeting.mp3","mainMenu":"main-menu.wav"}
 *
 * - Values may be file names (joined to IVR_AUDIO_BASE_URL) or full https URLs.
 * - Twilio <Play> supports MP3 and WAV (8 kHz mono μ-law WAV sounds best on phone
 *   lines; MP3 at 64 kbps+ is fine). Files must be publicly reachable over https.
 * - Keep recordings in sync with the text below (it stays the fallback, and the
 *   IVR console shows it as the script for voice talent).
 * - Dynamic prompts (e.g. queue position) always use <Say> because they change per call.
 * ────────────────────────────────────────────────────────────────────────────
 */
import twilio from 'twilio';
import type { IvrConfig } from './config';

type VoiceResponse = InstanceType<typeof twilio.twiml.VoiceResponse>;
type Gather = ReturnType<VoiceResponse['gather']>;

export const PROMPTS = {
  greeting: (c: IvrConfig) => `Thank you for calling ${c.businessName}. We're glad you reached us.`,
  mainMenu: (c: IvrConfig) => `Press 1 for Sales, Press 2 for Technical Support, or Press 3 to speak with an Operator.${c.dograhBaseUrl ? ' Or press 4 to talk with our AI assistant.' : ''}`,
  invalid: () => `Sorry, that wasn't a valid choice.`,
  noInput: () => `Sorry, we didn't receive your selection.`,
  goodbye: () => `We're sorry we couldn't help you today. Please call back any time. Goodbye.`,
  sales: () => `Connecting you to Sales.`,
  salesUnavailable: () => `Sorry, our Sales team isn't available right now.`,
  supportMenu: (c: IvrConfig) => `Technical Support. Press 1 for billing questions, Press 2 for technical issues, or Press 3 to hear our support hours.${c.dograhBaseUrl ? ' Press 4 to get help from our AI assistant.' : ''} Press star to return to the main menu.`,
  supportHours: () => `Our support team is available Monday through Friday, 8 AM to 8 PM Eastern, and Saturday 9 AM to 5 PM.`,
  queueJoin: () => `Please hold while we connect you to the next available agent.`,
  operator: () => `Connecting you to an operator.`,
  operatorUnavailable: () => `Sorry, no operator is available right now.`,
  aiAssistant: () => `Connecting you to our AI assistant.`,
  returningToMenu: () => `Returning you to the main menu.`,
  error: () => `We're sorry, something went wrong on our end. Please try your call again later.`,
  // ---- Secure profile ----
  greetingGeneric: (c: IvrConfig) => `Thank you for calling ${c.businessName}.`,
  secureMenu: (c: IvrConfig) => `Press 1 to receive a secure login code via SMS, Press 2 to transfer to Support, or Press 0 for an Operator.${c.dograhBaseUrl ? ' Or press 4 to talk with our AI assistant.' : ''}`,
  otpSent: () => `Your verification code has been sent via text message.`,
  otpNeutral: () => `If this phone number has an account with us, you'll receive a text message with your code shortly.`,
  otpNotRegistered: () => `We couldn't find an account linked to this phone number.`,
  otpRateLimited: () => `A code was sent to this number recently. Please check your messages, or try again later.`,
  otpBlocked: () => `We're unable to send text messages to this number.`,
  otpUnavailable: () => `We couldn't send a code right now. Please try again later.`,
  supportTransfer: () => `Transferring you to Support.`,
  supportUnavailable: () => `Sorry, Support isn't available right now.`,
  thanksGoodbye: () => `Thank you for calling. Goodbye.`,
} as const;

export type PromptKey = keyof typeof PROMPTS;

function audioUrl(c: IvrConfig, key: PromptKey): string | null {
  const v = c.audioPrompts[key];
  if (!v) return null;
  if (/^https:\/\//i.test(v)) return v;
  return c.audioBaseUrl ? `${c.audioBaseUrl}/${encodeURIComponent(v)}` : null;
}

/** Speaks a prompt on a response or inside a <Gather> (so callers can barge in with digits). */
export function speak(target: VoiceResponse | Gather, c: IvrConfig, key: PromptKey) {
  const url = audioUrl(c, key);
  if (url) target.play({}, url); // pre-recorded file
  else target.say({ voice: c.voice as any, language: c.language as any }, PROMPTS[key](c)); // TTS fallback
}

/** Dynamic text (always TTS). */
export function sayText(target: VoiceResponse | Gather, c: IvrConfig, text: string) {
  target.say({ voice: c.voice as any, language: c.language as any }, text);
}
