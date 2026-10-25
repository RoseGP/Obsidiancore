# Voice IVR (Twilio Programmable Voice + Dograh voice AI)

Inbound IVR served by the CRM's Express server, shown in **Voice Dialer → IVR (Twilio + Dograh)**.
Two menu profiles share the same routes (`IVR_MENU_PROFILE`):

## Secure profile (default)

```
Caller ─► POST /api/voice/inbound
            signature verified → caller looked up by From (E.164)
            known: "Welcome back, <first name>." · unknown: generic greeting
            <Gather> DTMF · 10 s · 1 digit:
            "Press 1 to receive a secure login code via SMS, Press 2 to transfer to Support,
             or Press 0 for an Operator."
       ─► POST /api/voice/menu?attempt=n
            1 → 6-digit code by SMS (Twilio REST) to the number on file → "Your verification code has
                been sent via text message." → <Hangup>
            2 → <Dial timeout="30"> +18005550199 → unanswered: back to the menu
            0 → <Conference> "operator-room" (or <Dial> IVR_OPERATOR_NUMBER)
            [4 → Dograh AI assistant, if DOGRAH_BASE_URL]
            invalid / missing digit → apology + menu repeated (IVR_MAX_REPLAYS, default 2) → goodbye + <Hangup>
       ─► POST /api/voice/otp/verify   { phone, code }   (your login screen)
```

### Security model

| Requirement | Implementation |
|---|---|
| Signature validation | `verifyTwilio` (`src/features/voice/server/webhook.ts`) runs `twilio.validateRequest()` on **every** webhook before any business logic; failures get `403 Forbidden`. |
| URL from protocol + Host | `expectedUrl()` rebuilds `proto://Host/originalUrl`. Behind ngrok/load balancers TLS ends upstream, so `X-Forwarded-Proto` is honoured when `IVR_TRUST_PROXY=true` (default). `validateRequest` also tries the URL with/without the default port. |
| Host header abuse | `IVR_ALLOWED_HOSTS` rejects any Host that isn't yours (403). Callback URLs in TwiML are **relative**, so a Host header is never written into TwiML. |
| Credentials | Only from environment variables. `server.ts` now starts with `import 'dotenv/config'` (previously `dotenv.config()` ran **after** all imports, so modules reading `process.env` at load time missed `.env` values). |
| Flooding / DoS (express-rate-limit) | ① 600 requests/min per IP (Twilio uses shared IP pools); ② **only rejected** requests counted: 20 per 10 min per IP, which stops forged-webhook floods fast without throttling Twilio; ③ 40/min per `CallSid` after verification (redirect loops); ④ 10 code checks per 15 min per IP. Standard `RateLimit` headers; `ipKeyGenerator` for IPv6. |
| XML / TTS injection | `sanitizeForSpeech()` strips XML-illegal characters, tags and markup characters, collapses whitespace and caps length; names must also pass a letters-only check. The Twilio SDK then XML-escapes text. A database name like `</Say><Dial>+1900…</Dial>` can't become TwiML (tested). |
| Webhook payload | `CallSid`/`AccountSid` format checks; optional pinning to `TWILIO_ACCOUNT_SID`; junk `Digits` treated as invalid and never echoed. |
| Errors | Handlers always return TwiML; failures apologise and hang up instead of Twilio's "application error". |

### Threat notes (important)

- **Caller ID can be spoofed.** `From` is never authentication. The greeting uses the first name only;
  set `IVR_PERSONALIZE=false` for privacy mode (generic greeting and one neutral SMS message for every
  outcome, so the IVR can't be used to discover which numbers are customers).
- **SMS abuse.** Codes go only to the number on file for a registered caller (never to unregistered
  numbers), are limited per number (`IVR_OTP_MAX_PER_HOUR`, default 3), and only to allowed country
  codes (`IVR_OTP_COUNTRY_CODES`, default `+1`) to block SMS-pumping toll fraud.
- **Codes:** `crypto.randomInt`, stored only as HMAC-SHA256 (`IVR_OTP_SECRET`), 10-minute expiry, single use,
  constant-time comparison, locked after 5 wrong attempts, never logged. The IVR says "sent" only after
  Twilio's REST API accepts the message.
- **Scaling:** code storage and rate-limit counters are in memory per instance. For several instances,
  back them with Redis (`OtpStore` interface; `rate-limit-redis` store for express-rate-limit).
- **Caller lookup:** `createSimulatedCallerDirectory` exists because the spec asks for a simulated lookup
  (seed with `IVR_SIMULATED_CALLERS`, ignored in production). Implement `CallerDirectory` over your user
  table before going live.
- **Session after verification:** `/api/voice/otp/verify` returns `{ verified: true }`; create the user's
  session where the route's comment indicates.

### Secure-profile configuration

```
TWILIO_ACCOUNT_SID=AC…              # from .env only
TWILIO_AUTH_TOKEN=…
TWILIO_SMS_FROM=+1…                 # or TWILIO_MESSAGING_SERVICE_SID=MG…
IVR_ALLOWED_HOSTS=abc123.ngrok-free.app,crm.example.com
IVR_OTP_SECRET=<32+ random characters>
IVR_SUPPORT_NUMBER=+18005550199
IVR_OPERATOR_NUMBER=+1…             # optional; otherwise conference "operator-room"
IVR_PERSONALIZE=true
IVR_OTP_COUNTRY_CODES=+1
```

Set `IVR_MENU_PROFILE=classic` for the earlier menu (below).

## Classic profile

```
Caller ─► Twilio number ─► POST /api/voice/inbound   greeting + menu (DTMF, 10 s)
                              │
                 POST /api/voice/menu?attempt=n
   1 Sales ──► <Dial> +1-800-555-0199 ──► /dial-status (unanswered → menu)
   2 Support ─► /support sub-menu: 1 Billing queue · 2 Technical queue · 3 Hours · [4 AI] · * menu
                 queues ──► /queue-wait (position + hold loop)
   3 Operator ─► <Dial> agent number, or <Conference> "operator-room"
   [4 AI] ────► <Redirect> Dograh /api/v1/telephony/inbound/run  (only if DOGRAH_BASE_URL is set)
   no/invalid input ─► replay (2×) ─► goodbye + <Hangup>
```

## Files

| File | Role |
|---|---|
| `src/routes/voiceIvr.ts` | Express routes (webhooks + console API) |
| `src/features/voice/server/flow.ts` | Call flow as pure TwiML builders (testable, also used by the simulator) |
| `src/features/voice/server/prompts.ts` | Every spoken line; TTS ↔ recorded audio swap |
| `src/features/voice/server/webhook.ts` | Signature verification, payload validation, safe error TwiML, masked logs |
| `src/features/voice/server/config.ts` | Environment configuration |
| `src/components/voice/DograhIvrConsole.tsx` | Console: status, webhook URLs, flow, simulator, recent calls |

## Configuration

```
PUBLIC_BASE_URL=https://<your-ngrok-or-domain>   # the URL Twilio calls; used for signatures
TWILIO_AUTH_TOKEN=…                              # required (Console → Account info)
TWILIO_ACCOUNT_SID=AC…                           # optional: only accept your account
IVR_SALES_NUMBER=+18005550199
IVR_OPERATOR_NUMBER=+15125550177                 # optional; otherwise conference "operator-room"
IVR_CALLER_ID=+1XXXXXXXXXX                       # a Twilio number you own, used on forwarded legs
IVR_SUPPORT_QUEUE=support   IVR_BILLING_QUEUE=billing
IVR_TTS_VOICE=Polly.Joanna-Neural   IVR_TTS_LANGUAGE=en-US
IVR_HOLD_MUSIC_URL=https://…/hold.mp3            # optional
IVR_MAX_REPLAYS=2
DOGRAH_BASE_URL=https://dograh.example.com       # optional: enables "press 4 for our AI assistant"
```

## Test locally with ngrok

1. **Install ngrok** (https://ngrok.com/download) and connect your account:
   `ngrok config add-authtoken <your-ngrok-token>`
2. **Start the app** (port 3000): `npm run dev`
3. **Expose it:** `ngrok http 3000`. Copy the `https://….ngrok-free.app` forwarding URL.
4. **Allow the ngrok host** in `.env` and restart the app. Signatures are checked against the URL rebuilt from each request's protocol and Host, so no base URL is needed:
   ```
   IVR_ALLOWED_HOSTS=abc123.ngrok-free.app
   TWILIO_ACCOUNT_SID=AC…
   TWILIO_AUTH_TOKEN=<your auth token>
   TWILIO_SMS_FROM=+1…
   ```
   The ngrok URL changes each time you restart ngrok on a free plan; update `IVR_ALLOWED_HOSTS` (and Twilio) when it does.
5. **Point your Twilio number at it:** Twilio Console → Phone Numbers → Manage → Active numbers → your number →
   *Voice configuration*:
   - A call comes in: **Webhook** `https://abc123.ngrok-free.app/api/voice/inbound`, **HTTP POST**
   - Call status changes: `https://abc123.ngrok-free.app/api/voice/status`, **HTTP POST**

   (The IVR console shows both URLs with copy buttons.)
6. **Call your Twilio number.** Press 1, 2, 3 (and 4 with Dograh) or let it time out.
7. **Debug:** ngrok's inspector at http://127.0.0.1:4040 shows every webhook and the TwiML returned
   (with *Replay*). Twilio Console → Monitor → Logs → Calls shows Twilio's side, including any errors.

No phone handy? Use **Try the menu** in the console. It runs the same flow code without placing a call.

**Signature errors (403)** usually mean the auth token is wrong, the Host isn't in `IVR_ALLOWED_HOSTS`, or a proxy
strips `X-Forwarded-Proto` (then the rebuilt URL is `http://` while Twilio signed `https://`). As a last resort for a quick local check,
`IVR_SKIP_SIGNATURE=true` disables verification; it's ignored when `NODE_ENV=production`.

## Swapping text-to-speech for recorded audio

Prompts use `<Say>` with an Amazon Polly neural voice until you configure a recording for a prompt key
(full list in `prompts.ts`, and the console shows the script):

```
IVR_AUDIO_BASE_URL=https://cdn.example.com/ivr
IVR_AUDIO_PROMPTS={"greeting":"greeting.mp3","mainMenu":"main-menu.wav","supportMenu":"support.wav"}
```

That prompt then uses `<Play>`. Files must be public over https; MP3, or WAV (8 kHz mono μ-law is ideal for phone audio).
Prompts inside a menu stay inside `<Gather>`, so callers can still press a key during the recording.
Dynamic lines (queue position) always use TTS.

## Agents: answering queues and the operator room

- **Queues:** an agent answers the next caller in a queue by dialling a Twilio number whose
  webhook returns `<Response><Dial><Queue>support</Queue></Dial></Response>` (same for `billing`),
  or via a TaskRouter workflow if you use one.
- **Operator conference** (no `IVR_OPERATOR_NUMBER`): callers wait with hold music; an agent joins with
  `<Dial><Conference startConferenceOnEnter="true">operator-room</Conference></Dial>` and the call starts.

## Dograh (self-hosted voice AI)

Verified in the Dograh source (`api/routes/telephony.py`, `handle_inbound_run`): Dograh accepts Twilio
call webhooks at `POST {DOGRAH_BASE_URL}/api/v1/telephony/inbound/run`, verifies `X-Twilio-Signature`
with the Twilio credentials saved in Dograh, picks the workflow from the **called number**, and answers
with `<Connect><Stream>` to its media pipeline.

Setup:
1. Run Dograh (see its README / `docker-compose.yaml`) at a public https URL.
2. In Dograh, add the **same Twilio account** as a telephony configuration, add your number, and set its
   **inbound workflow** to the AI agent you built.
3. Keep the Twilio number's voice webhook pointing at **this IVR** (`/api/voice/inbound`). If Dograh
   offers to configure inbound for the number, decline, or it will replace the IVR as the entry point.
4. Set `DOGRAH_BASE_URL` here. Option 4 appears in the main and support menus and redirects the live call to Dograh.

## Error handling

- Webhooks always answer with TwiML. Unexpected failures play a short apology and hang up instead of
  Twilio's generic "application error". Bad signatures get `403`; malformed bodies `400` with TwiML.
- Retries are stateless (`attempt` in the signed action URL), so they work across server instances.
- Phone numbers are masked in logs and in the console; the auth token is never returned.
- **Fallback URL:** in Twilio, set the number's *Primary handler fails* URL to a static TwiML Bin
  (e.g. "We're experiencing technical difficulties" + `<Dial>` to a backup line), so callers are
  handled even if this server is down.

## Tests

`npm run test:voice-ivr`: 38 checks with real Twilio signatures (`twilio.getExpectedTwilioSignature`) and an
injected SMS sender, so tests never send messages.
