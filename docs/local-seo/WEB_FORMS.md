# Website forms → CRM

Local SEO → **Website forms**. A business pastes a form on its website; submissions are validated, filtered for
spam and duplicates, and delivered to this CRM (a lead plus a follow-up task) and/or to any other CRM through a
signed webhook.

Code: `src/server/webforms/` (`submission.ts` validation/spam, `service.ts` config + submit + log, `adapters.ts`
CRM adapters, `safeHttp.ts` outbound requests), routes `src/routes/webFormsApi.ts`, UI
`src/components/localpilot/forms/WebFormsView.tsx`, lead write `src/server/crm/websiteLeads.ts`.
Tests: `npm run test:web-forms`.

## Endpoint

`POST {APP_URL}/api/web-forms/f/{formId}`. `formId` (`wf_` + 16 characters) is public and appears in page HTML. It
identifies the organization; it is **not** a secret and grants nothing except submitting this form. It can be rotated
(Advanced → Create a new form address); the old one returns 404 immediately.

Accepts `application/json` (fetch) or a normal HTML form post (`application/x-www-form-urlencoded`).

| Field | Rules |
|---|---|
| `name` | required, 2–120 characters |
| `email` | required, valid address |
| `phone` | optional, digits and `+ ( ) - . space`, up to 40 |
| `company` | optional, up to 160 |
| `message` | optional, up to 4000 (line breaks kept) |
| `formName`, `pageUrl`, `utm_source`, `utm_medium`, `utm_campaign` | optional |
| `consent`, `marketingOptIn` | optional booleans (`true`/`on`/`1`) |
| `_hp` | honeypot: must stay empty (hidden from people) |
| `_ts` | optional: ms timestamp when the form was shown (submissions under 2.5 s are treated as bots) |

Other fields are ignored. Text is trimmed and control/zero-width characters are removed. Visitor input is never
echoed back in error responses or HTML pages (all output is HTML-escaped).

Responses:

| Status | Body |
|---|---|
| 200 | `{ success: true, message }`: accepted. Spam and duplicates also get 200 (so bots learn nothing) but are not delivered. |
| 400 | `{ code: "invalid_input", fields: [{ field, message }] }` |
| 403 | `origin_not_allowed`: the browser's `Origin` isn't in the allowed websites list |
| 404 | `form_not_found` |
| 429 | `rate_limited` (`Retry-After`) |
| 503 | `crm_unavailable`: the CRM write failed and no webhook is configured |

HTML form posts get a 303 redirect to the thank-you page (`?form_status=ok`, or `?form_status=error&form_error=<code>`)
or, without one, a small accessible confirmation page.

### Spam, duplicates, limits
- Honeypot, too-fast submissions, more than 3 links, or HTML markup → logged as spam, not delivered.
- The same organization + email + phone + message within 10 minutes → logged as a duplicate, not delivered again.
  In the CRM, a submission with an existing lead's email or phone is added to that lead instead of creating a new one.
- Rate limits: `WEBFORM_IP_LIMIT` per IP per 10 minutes (default 10), `WEBFORM_FORM_LIMIT` per form per hour
  (default 300). They are in-memory per server instance; use a shared store behind a load balancer.

### CORS / allowed websites
Browsers get CORS headers only for origins on the organization's allowed list (`https://…`; `http://` only for
localhost). With an empty list any origin may post (shown as a warning in the UI); add your site to lock it down.
Requests without an `Origin` (server-to-server, some HTML posts) aren't blocked by this check, so it limits browsers,
not determined attackers; the rate limits and spam checks still apply.

## Destinations (provider-neutral adapters)

`CrmAdapter { id, deliver(payload, ctx) }` in `adapters.ts`. Two are built in:
- `obsidian`: this CRM (lead, activity, follow-up task, lead score). Runs synchronously.
- `webhook`: any CRM or automation tool (Zapier, Make, n8n, a CRM's inbound webhook). Runs in the background, with
  retries after 2 s and 15 s on 5xx/408/429/network errors. 8 s timeout, no redirects followed, HTTPS only, and
  private, loopback and metadata addresses are refused (DNS is resolved once and the connection pinned to the checked
  address). `WEBFORM_ALLOW_PRIVATE_WEBHOOKS=true` allows private targets outside production only (local testing).

At least one destination must stay on. To add a provider-specific adapter (HubSpot, Salesforce…), implement
`CrmAdapter`, keep its credentials server-side (sealed like the webhook secret), and register it in `ADAPTERS`.

### Webhook payload (version 1)

```json
{
  "event": "form.submission",
  "version": 1,
  "id": "sub_…",
  "submittedAt": "2026-11-12T10:00:00.000Z",
  "isTest": false,
  "form": { "name": "Contact page" },
  "contact": { "name": "Ada Lee", "email": "ada@example.com", "phone": "+1 555 0100", "company": null },
  "message": "Do you deliver on weekends?",
  "consent": { "contactAboutRequest": true, "marketing": false },
  "source": { "pageUrl": "https://www.example.com/contact", "utm": { "source": null, "medium": null, "campaign": null } }
}
```

Headers: `Content-Type: application/json`, `User-Agent: ObsidianCRM-Webhooks/1.0`, `X-Obsidian-Event: form.submission`,
`X-Obsidian-Delivery: <id>`, `X-Obsidian-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256>`.
"Send test" posts the same shape with `"isTest": true` and sample contact details marked as a test.

### Verifying the signature (receiver side)

`v1 = HMAC_SHA256(secret, "<t>.<raw request body>")`. Reject if it doesn't match or `t` is more than 5 minutes old.

```js
import crypto from 'node:crypto';
function verify(secret, rawBody, header) {
  const m = /^t=(\d+),v1=([a-f0-9]{64})$/.exec(header || '');
  if (!m || Math.abs(Date.now() / 1000 - Number(m[1])) > 300) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${m[1]}.${rawBody}`).digest();
  const got = Buffer.from(m[2], 'hex');
  return got.length === expected.length && crypto.timingSafeEqual(got, expected);
}
```

Use the raw body bytes, not re-serialized JSON. Deduplicate on `X-Obsidian-Delivery` (retries reuse it).

The signing secret (`whsec_…`) is generated server-side, shown once when the webhook URL is added or the secret is
rotated, and stored encrypted (AES-256-GCM with `WEBFORM_ENCRYPTION_KEY`, falling back to `ENCRYPTION_KEY`). It never
appears in browser code, API responses after that, logs or the audit log.

## Admin API (signed in, organization-scoped)

`GET /config`, `GET /submissions` need Settings view (owners, admins, managers). `PUT /config`,
`POST /webhook/rotate-secret`, `POST /webhook/test`, `POST /form-id/rotate` need Settings manage (owners, admins) and
are recorded in the audit log (no URLs' secrets, no submission contents).

## Retention and privacy

- Submission contents are stored only where they're delivered: as the lead in this CRM (subject to the
  organization's retention rules and data requests in Privacy & Compliance) and/or at the webhook receiver.
- The delivery log (`organizations/{org}/web_form_submissions`) holds no name, email, phone or message: time, form name,
  the website's host name, result (accepted/duplicate/spam and reason), a SHA-256 fingerprint for duplicate
  detection, and delivery status. Each entry has `expireAt` = +30 days and is deleted when the log is read after that.
  For deletion without reads, add a scheduled job or convert `expireAt` to a Firestore timestamp and enable a TTL policy.
- Consent: `consent` is recorded as `data_processing` and `marketingOptIn` as `marketing_email` consent on the lead.
  Add a short privacy notice to your form that says who receives the data and why.
- Server logs record the form id, outcome and timings only; never field values. IP addresses are used for rate
  limiting in memory and are not stored.

## Example: simple HTML form

The Website forms page generates this with your form address (and a fetch version that sends `_ts` and `pageUrl`):

```html
<form action="https://crm.example.com/api/web-forms/f/wf_XXXXXXXXXXXXXXXX" method="POST">
  <label>Name <input name="name" required maxlength="120"></label>
  <label>Email <input name="email" type="email" required></label>
  <label>Message <textarea name="message" maxlength="4000"></textarea></label>
  <label><input type="checkbox" name="consent" value="true" required> I agree to be contacted about my request.</label>
  <input type="text" name="_hp" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px" aria-hidden="true">
  <button type="submit">Send</button>
</form>
```

The legacy `POST /api/leads/capture` (hashed lead-capture key) still works for existing forms but tells the caller
whether the lead already existed; new forms should use this endpoint.

## Other website stacks and hosting

The endpoint is plain HTTP, so the website's framework doesn't matter:
- **Static sites / site builders** (plain HTML, WordPress custom HTML block, Webflow/Squarespace code embed): use the
  HTML form. Builders that only allow their own form widgets need their "send to webhook" option pointed at the
  endpoint (send JSON with the same field names), or Zapier/Make in between.
- **React, Vue, Svelte, Next.js, etc.**: post JSON with `fetch` (the UI has a React example). No server code is
  needed on the website: secrets stay in this server.
- **If you'd rather run the endpoint on your own hosting** (serverless function, Worker), the logic to port is `submission.ts` (validation + spam checks), the duplicate check, and an adapter; keep CRM keys in that
  platform's secret store, and replace the in-memory rate limiter with the platform's (e.g. Cloudflare rate limiting
  rules) because serverless instances don't share memory.

## CAPTCHA: Cloudflare Turnstile (optional, built in)

The hidden trap field, the timing, link and markup checks, and the rate limits stop most automated spam without
bothering visitors. If a form is still targeted, turn on Turnstile on the Website forms page:

1. Cloudflare dashboard → **Turnstile → Add widget**: add your website's hostname(s), widget mode **Managed**.
2. Paste the **site key** (public) and **secret key** on the Website forms page. The secret is encrypted
   (AES-256-GCM) and never returned to the browser or written to logs.
3. Copy the form code again: it now loads `https://challenges.cloudflare.com/turnstile/v0/api.js` and adds
   `<div class="cf-turnstile" data-sitekey="…">`, which puts a one-time `cf-turnstile-response` field in the form.

The server checks every token with Cloudflare's Siteverify API (`POST https://challenges.cloudflare.com/turnstile/v0/siteverify`,
`secret` + `response` + `remoteip`) before anything is saved (`src/server/webforms/turnstile.ts`):

| Result | Response |
|---|---|
| no token, rejected or expired token (tokens are single-use, valid 5 minutes) | 400 `captcha_failed` |
| token solved on a hostname that isn't in Allowed websites | 400 `captcha_failed` |
| Cloudflare unreachable, or the secret key is wrong | 503 `captcha_unavailable` (fails closed; logged with Cloudflare's error codes, never the token) |

While Turnstile is on, forms without the widget are refused, so update the website right after turning it on.
For local testing, Cloudflare publishes test keys (site key `1x00000000000000000000AA` with secret
`1x0000000000000000000000000000000AA` always passes).

## Cloudflare hosting (your setup)

**Your website on Cloudflare Pages (or any site behind Cloudflare):** nothing runs on the website's side. Paste the
form code into the page; the browser posts straight to Obsidian. Add every address the form is served from to
Allowed websites: `https://www.yourdomain.com`, `https://yourdomain.com`, and your `https://<project>.pages.dev`
address if you test there (preview deployments get their own hostnames; add the ones you use).

If Obsidian itself is behind Cloudflare's proxy (orange cloud):
- Set `TRUST_PROXY` so rate limits see the visitor's IP, not Cloudflare's: `1` when Cloudflare connects straight to
  the Obsidian server, `2` if there's also a platform load balancer in between (Cloud Run, Render, a Kubernetes
  ingress). Without it, all visitors share one limit. Only trust the proxy if the origin accepts traffic from
  Cloudflare alone (firewall to Cloudflare's IP ranges, or a Cloudflare Tunnel); otherwise anyone can fake
  `X-Forwarded-For`.
- **Bot Fight Mode / Super Bot Fight Mode** can challenge `fetch` posts, which then fail silently in the browser.
  Use Turnstile on the form instead, or add a WAF skip rule for `/api/web-forms/f/*`.
- Optional: a Cloudflare rate-limiting rule on `/api/web-forms/f/*` (e.g. 20 requests per minute per IP) stops floods
  before they reach the server, in addition to the server's own limits.
- Don't cache `/api/*` (responses already send `Cache-Control: no-store`).

**Moving the endpoint itself onto a Cloudflare Worker** isn't needed for this setup and isn't built: the existing
`wrangler.api.toml` Worker serves health checks only, and the endpoint needs the CRM's Firestore data. If you want it
later, port `submission.ts` + `turnstile.ts` to the Worker and have it forward accepted submissions to this
server's endpoint, keeping secrets in Worker secrets (`wrangler secret put`).
