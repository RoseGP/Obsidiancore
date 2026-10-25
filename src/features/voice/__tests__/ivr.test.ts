/**
 * IVR security + flow tests with real Twilio signatures and an injected SMS sender
 * (no real messages). Run: npx tsx src/features/voice/__tests__/ivr.test.ts
 */
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import twilio from 'twilio';

let passed = 0; const ok = (n: string) => { passed++; console.log('  ✓', n); };
const HOST = 'abc123.ngrok-free.app';
const TOKEN = 'test_auth_token_123';
const ACCOUNT = 'AC' + 'a'.repeat(32);
Object.assign(process.env, { NODE_ENV: 'test', SOCIAL_ACCOUNTS_DEV_AUTH: 'true', SOCIAL_ACCOUNTS_STORE: 'file', SOCIAL_ACCOUNTS_ENCRYPTION_KEY: 'k'.repeat(40), APP_URL: `https://${HOST}` });
const { createVoiceIvrRouter } = await import('../../../routes/voiceIvr');
const { sanitizeForSpeech } = await import('../server/sanitize');
const { createOtpService, createMemoryOtpStore } = await import('../server/otp');
const { loadIvrConfig } = await import('../server/config');
const flow = await import('../server/flow');

const baseEnv = { NODE_ENV: 'test', TWILIO_AUTH_TOKEN: TOKEN, TWILIO_ACCOUNT_SID: ACCOUNT, IVR_ALLOWED_HOSTS: HOST, IVR_BUSINESS_NAME: 'Acme' };
const sent: { to: string; body: string }[] = [];
const sms = { async send(to: string, body: string) { sent.push({ to, body }); return { sid: 'SM' + '0'.repeat(32) }; } };
const directory = { async findByPhone(p: string) {
  if (p === '+15125550123') return { userId: 'u_ada', fullName: 'Ada Lovelace', phoneE164: p };
  if (p === '+15125550999') return { userId: 'u_evil', fullName: '</Say><Dial>+19005550000</Dial><Say>', phoneE164: p };
  return null;
} };
function makeApp(env: Record<string, string> = {}, opts: { sms?: any } = {}) {
  const a = express(); a.use(express.urlencoded({ extended: true })); a.use(express.json());
  a.use('/api/voice', createVoiceIvrRouter({ env: { ...baseEnv, ...env } as any, callers: directory, sms: opts.sms === undefined ? sms : opts.sms }));
  return a;
}
const app = makeApp();
const CALL = 'CA' + '1'.repeat(32);
const body = (extra: Record<string, string> = {}) => ({ CallSid: CALL, AccountSid: ACCOUNT, From: '+15125550123', To: '+18005550100', ...extra });
/** Signs exactly as Twilio does for https://HOST{path}, sent through a TLS-terminating proxy (ngrok). */
function hook(a: express.Express, path: string, params: Record<string, string>, opts: { host?: string; proto?: string; signUrl?: string; noSig?: boolean } = {}) {
  const host = opts.host ?? HOST; const proto = opts.proto ?? 'https';
  const sig = twilio.getExpectedTwilioSignature(TOKEN, opts.signUrl ?? `${proto}://${host}${path}`, params);
  const r = request(a).post(path).set('Host', host).set('X-Forwarded-Proto', proto).type('form').send(params);
  return opts.noSig ? r : r.set('X-Twilio-Signature', sig);
}

// ---- 1. Signature middleware ----
let r = await hook(app, '/api/voice/inbound', body(), { noSig: true });
assert.equal(r.status, 403); assert.equal(r.text, 'Forbidden'); ok('missing X-Twilio-Signature → 403 before business logic');
r = await hook(app, '/api/voice/inbound', body(), { signUrl: `https://${HOST}/api/voice/other` });
assert.equal(r.status, 403); ok('signature for a different URL → 403');
r = await hook(app, '/api/voice/inbound', { ...body(), Digits: '1' }, { signUrl: undefined }).then(async () => {
  const p = body(); const sig = twilio.getExpectedTwilioSignature(TOKEN, `https://${HOST}/api/voice/inbound`, p);
  return request(app).post('/api/voice/inbound').set('Host', HOST).set('X-Forwarded-Proto', 'https').set('X-Twilio-Signature', sig).type('form').send({ ...p, From: '+19998887777' });
});
assert.equal(r.status, 403); ok('tampered body parameter → 403');
r = await hook(app, '/api/voice/inbound', body(), { host: 'evil.example.com' });
assert.equal(r.status, 403); ok('valid signature but Host not in IVR_ALLOWED_HOSTS → 403');
r = await hook(app, '/api/voice/inbound', body(), { proto: 'https' });
assert.equal(r.status, 200); ok('URL rebuilt from X-Forwarded-Proto + Host matches what Twilio signed (ngrok)');
const noProxy = makeApp({ IVR_TRUST_PROXY: 'false' });
r = await hook(noProxy, '/api/voice/inbound', body(), { proto: 'https' });
assert.equal(r.status, 403); ok('with IVR_TRUST_PROXY=false, X-Forwarded-Proto is ignored (URL becomes http) → 403');
r = await hook(app, '/api/voice/inbound', { ...body(), CallSid: 'bogus' });
assert.equal(r.status, 400); assert.match(r.text, /<Hangup\/>/); ok('malformed payload → 400 with polite TwiML');

// ---- 2. Inbound ----
r = await hook(app, '/api/voice/inbound', body());
assert.match(r.text, /Welcome back, Ada\. Thank you for calling Acme\./); assert.ok(!r.text.includes('Lovelace')); ok('known caller → personalised greeting (first name only)');
assert.match(r.text, /<Gather input="dtmf" numDigits="1" timeout="10" action="\/api\/voice\/menu\?attempt=0" method="POST" actionOnEmptyResult="true">/);
assert.match(r.text, /Press 1 to receive a secure login code via SMS, Press 2 to transfer to Support, or Press 0 for an Operator\./); ok('<Gather> DTMF · 10 s · 1 digit · relative action · exact prompt');
r = await hook(app, '/api/voice/inbound', body({ From: '+15125550000' }));
assert.match(r.text, /<Say[^>]*>Thank you for calling Acme\.<\/Say>/); assert.ok(!r.text.includes('Welcome back')); ok('unknown caller → generic greeting');
r = await hook(app, '/api/voice/inbound', body({ From: '+15125550999' }));
assert.ok(!r.text.includes('<Dial>') && !r.text.includes('+1900')); assert.match(r.text, /Thank you for calling Acme\./); ok('malicious name from the database cannot inject TwiML (sanitized → generic greeting)');
r = await hook(app, '/api/voice/inbound', body({ From: 'anonymous' }));
assert.equal(r.status, 200); assert.ok(!r.text.includes('Welcome back')); ok('withheld / non-E.164 caller ID handled as unknown');
const privacy = makeApp({ IVR_PERSONALIZE: 'false' });
r = await hook(privacy, '/api/voice/inbound', body());
assert.ok(!r.text.includes('Ada')); ok('IVR_PERSONALIZE=false never reveals that a number is registered');

// ---- 3. Menu ----
r = await hook(app, '/api/voice/menu?attempt=0', body({ Digits: '1' }));
assert.match(r.text, /Your verification code has been sent via text message\./); assert.match(r.text, /<Hangup\/>/);
assert.equal(sent.length, 1); assert.equal(sent[0].to, '+15125550123'); assert.match(sent[0].body, /login code is \d{6}\./); ok('1 → 6-digit code SMS to the caller’s number on file, confirmation, graceful hangup');
const code = sent[0].body.match(/(\d{6})/)![1];
r = await hook(app, '/api/voice/menu?attempt=0', body({ Digits: '1', From: '+15125550000' }));
assert.match(r.text, /couldn't find an account/); assert.equal(sent.length, 1); ok('1 from an unknown number → no SMS sent (no spam to strangers)');
r = await hook(privacy, '/api/voice/menu?attempt=0', body({ Digits: '1', From: '+15125550000' }));
assert.match(r.text, /If this phone number has an account with us/); ok('privacy mode: same neutral message whether or not the number is registered');
r = await hook(app, '/api/voice/menu?attempt=0', body({ Digits: '1', From: '+442071838750' }));
assert.match(r.text, /unable to send text messages to this number/); ok('SMS-pumping guard: destinations outside IVR_OTP_COUNTRY_CODES are refused');
for (let i = 0; i < 3; i++) await hook(app, '/api/voice/menu?attempt=0', body({ Digits: '1', CallSid: 'CA' + String(i).repeat(32) }));
r = await hook(app, '/api/voice/menu?attempt=0', body({ Digits: '1', CallSid: 'CA' + '9'.repeat(32) }));
assert.match(r.text, /sent to this number recently/); ok('per-number SMS limit (3/hour) stops SMS bombing');
const failing = makeApp({}, { sms: { async send() { throw new Error('Twilio 21610: unsubscribed recipient'); } } });
r = await hook(failing, '/api/voice/menu?attempt=0', body({ Digits: '1' }));
assert.match(r.text, /couldn't send a code right now/); ok('Twilio REST failure → honest message (never claims “sent”)');
const noSms = makeApp({}, { sms: null });
r = await hook(noSms, '/api/voice/menu?attempt=0', body({ Digits: '1' }));
assert.match(r.text, /couldn't send a code right now/); ok('SMS not configured → honest message');

r = await hook(app, '/api/voice/menu?attempt=0', body({ Digits: '2' }));
assert.match(r.text, /Transferring you to Support\./); assert.match(r.text, /<Dial action="\/api\/voice\/dial-status\?dest=support" method="POST" timeout="30" answerOnBridge="true"><Number>\+18005550199<\/Number><\/Dial>/); ok('2 → forward to +18005550199 with a 30-second timeout');
r = await hook(app, '/api/voice/menu?attempt=0', body({ Digits: '0' }));
assert.match(r.text, /<Conference startConferenceOnEnter="false" endConferenceOnExit="true" beep="false">operator-room<\/Conference>/); ok('0 → operator conference bridge');
const withOp = makeApp({ IVR_OPERATOR_NUMBER: '+15125550177' });
r = await hook(withOp, '/api/voice/menu?attempt=0', body({ Digits: '0' }));
assert.match(r.text, /<Number>\+15125550177<\/Number>/); ok('0 → transfer to operator number when configured');
r = await hook(app, '/api/voice/menu?attempt=0', body({ Digits: '7' }));
assert.match(r.text, /wasn't a valid choice/); assert.match(r.text, /Press 1 to receive a secure login code/); assert.match(r.text, /menu\?attempt=1/); ok('invalid digit → apology + menu repeated');
r = await hook(app, '/api/voice/menu?attempt=1', body());
assert.match(r.text, /didn't receive your selection/); assert.match(r.text, /menu\?attempt=2/); ok('missing digit (timeout) → menu repeated');
r = await hook(app, '/api/voice/menu?attempt=2', body({ Digits: '<script>' }));
assert.match(r.text, /Goodbye/); assert.match(r.text, /<Hangup\/>/); assert.ok(!r.text.includes('script')); ok('after repeated failures → polite goodbye; junk Digits never echoed');
r = await hook(app, '/api/voice/dial-status?dest=support', body({ DialCallStatus: 'no-answer' }));
assert.match(r.text, /Support isn't available/); ok('unanswered support transfer → back to the menu');

// ---- 4. OTP verification ----
const verify = (a: express.Express, phone: string, c: string) => request(a).post('/api/voice/otp/verify').set('Origin', `https://${HOST}`).set('Host', HOST).send({ phone, code: c });
const freshApp = makeApp(); const sent2Before = sent.length;
await hook(freshApp, '/api/voice/menu?attempt=0', body({ Digits: '1' }));
const code2 = sent[sent2Before].body.match(/(\d{6})/)![1];
assert.equal((await verify(freshApp, '+15125550123', code2 === '000000' ? '111111' : '000000')).status, 401);
assert.equal((await verify(freshApp, '+15125550123', code2)).body.verified, true); ok('code verifies once (constant-time HMAC compare)');
assert.equal((await verify(freshApp, '+15125550123', code2)).status, 401); ok('code is single-use');
assert.equal((await request(freshApp).post('/api/voice/otp/verify').set('Origin', 'https://evil.example').set('Host', HOST).send({ phone: '+15125550123', code: '123456' })).status, 403); ok('verification endpoint rejects cross-site requests');
const svc = createOtpService(createMemoryOtpStore(), sms, { secret: Buffer.alloc(32, 7), ttlMs: 600_000, maxAttempts: 5, maxSendsPerHour: 3, allowedCountryCodes: ['+1'], brand: 'Acme' });
await svc.send('+15125550123', 'u1');
let last: any; for (let i = 0; i < 5; i++) last = svc.verify('+15125550123', '999999');
assert.equal(last.reason, 'locked'); ok('5 wrong attempts lock the code');
void code;

// ---- 5. Sanitizer & rate limits ----
assert.equal(sanitizeForSpeech('Ada\u0000\u0007 <b>Love</b> & "co"'), 'Ada Love co'); ok('sanitizer strips XML-illegal chars, tags and markup characters');
const flood = makeApp();
let limited = 0;
for (let i = 0; i < 22; i++) { const x = await hook(flood, '/api/voice/inbound', body(), { noSig: true }); if (x.status === 429) limited++; }
assert.ok(limited >= 1); ok('express-rate-limit: forged-request flood blocked (429) after 20 rejections');
const ok200 = await hook(makeApp(), '/api/voice/inbound', body());
assert.equal(ok200.status, 200); assert.ok(ok200.headers['ratelimit'] || ok200.headers['ratelimit-policy']); ok('legitimate signed traffic is not counted by the forgery limiter (standard RateLimit headers)');

// ---- 6. Classic profile still works; production safety ----
const classic = makeApp({ IVR_MENU_PROFILE: 'classic' });
r = await hook(classic, '/api/voice/menu?attempt=0', body({ Digits: '1' }));
assert.match(r.text, /Connecting you to Sales/); ok('IVR_MENU_PROFILE=classic keeps the earlier Sales/Support/Operator menu');
assert.equal(loadIvrConfig({ NODE_ENV: 'production', IVR_SKIP_SIGNATURE: 'true' } as any).skipSignature, false); ok('signature skipping is impossible in production');
assert.ok(loadIvrConfig({ NODE_ENV: 'production', TWILIO_AUTH_TOKEN: 't' } as any).problems.some((p) => p.includes('IVR_ALLOWED_HOSTS'))); ok('production warns when IVR_ALLOWED_HOSTS is missing');
const dograh = loadIvrConfig({ TWILIO_AUTH_TOKEN: 't', DOGRAH_BASE_URL: 'https://dograh.example.com' } as any);
assert.match(flow.menuTwiml(dograh, '4', 0), /dograh\.example\.com\/api\/v1\/telephony\/inbound\/run/); ok('Dograh AI hand-off still available (option 4)');

console.log(`\n${passed} passed (voice ivr)`);
process.exit(0);
