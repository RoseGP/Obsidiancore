# Embeddable calendar widget

A calendar your customers paste onto their own websites. It shows this organization's events in month and
week views, and, depending on the credential, lets visitors request a time or lets your staff create, edit,
drag-to-reschedule and delete events, with changes appearing live in every open copy.

```
Partner website (any origin)                    CRM (this app)
──────────────────────────────                  ────────────────────────────────────────────
<obsidian-calendar> (Shadow DOM, widget.js)
  GET  /api/v1/events?startDate&endDate   ───►  CORS: only origins listed on the key/token
  GET  /api/v1/events/stream  (live)      ───►  Auth: Bearer pk_… (public) or et_… (staff)
  POST/PATCH/DELETE /api/v1/events        ───►  organizations/{orgId}/calendar_events/{id}
Partner backend
  POST /api/v1/embed-tokens (sk_…)        ───►  short-lived et_… token for signed-in staff
```

## 1. Create a key

Settings → Organization & Members → **Website calendar**. List the website address(es) (e.g.
`https://www.yourshop.com`). Keys only work from those origins.

| Credential | Where it lives | Can do |
|---|---|---|
| Public key `pk_…`, view only | the website's HTML | see scheduled events |
| Public key `pk_…` + "visitors request a time" | the website's HTML | see events; create **pending** requests (no edit/delete); 10 requests per 15 min per visitor |
| Server key `sk_…` | the website's **server** only | mint staff tokens (`et_…`, max 1 hour) that can create, edit, reschedule, delete and confirm requests |

Anything in a page's HTML is public, which is why public keys can't edit or delete.

## 2. Embed snippets

**Public calendar (view, or view + requests):**
```html
<obsidian-calendar data-api-key="pk_…" data-theme="auto" data-view="month"></obsidian-calendar>
<script src="https://YOUR-CRM/widget.js" defer></script>
```

**Script tag only** (the widget is inserted after the script, or into `data-target`):
```html
<div id="events"></div>
<script src="https://YOUR-CRM/widget.js" data-api-key="pk_…" data-target="#events" defer></script>
```

**Staff editing on your site:** your backend returns a token for the signed-in staff member:
```html
<obsidian-calendar data-token-url="/internal/calendar-token" data-channels="LinkedIn,Instagram,X"></obsidian-calendar>
<script src="https://YOUR-CRM/widget.js" defer></script>
```
```js
// Your site's server (Express). CRM_SECRET_KEY = the sk_… key, from your environment.
app.post('/internal/calendar-token', requireStaffLogin, async (req, res) => {
  const r = await fetch('https://YOUR-CRM/api/v1/embed-tokens', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.CRM_SECRET_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ subject: req.user.email, ttlSeconds: 900 }),
  });
  if (!r.ok) return res.status(502).json({ error: 'Calendar unavailable' });
  const { token, expiresAt } = await r.json();
  res.set('Cache-Control', 'no-store').json({ token, expiresAt }); // the widget refreshes it before expiry
});
```
Next.js equivalent: `app/internal/calendar-token/route.ts` with `export async function POST()` doing the same `fetch`.

**iFrame fallback** (for sites whose Content Security Policy blocks third-party scripts; public keys only, and
the key must also list `https://YOUR-CRM` as an allowed origin):
```html
<iframe src="https://YOUR-CRM/embed/calendar.html?key=pk_…&theme=auto" title="Events calendar"
        style="width:100%;height:720px;border:0" loading="lazy"></iframe>
```

### Attributes
`data-api-key`, `data-token`, `data-token-url`, `data-endpoint` (default: where widget.js is served),
`data-theme` (light | dark | auto), `data-view` (month | week), `data-locale`, `data-channels`
(comma-separated choices in the form), `data-live="false"` (turn off live updates).

## 3. API

All requests: `Authorization: Bearer <pk_… | et_…>` (or `X-API-Key: pk_…`). Errors: `{ success:false, code, error }`.

| Method & path | Scope | Notes |
|---|---|---|
| `GET /api/v1/events?startDate=ISO&endDate=ISO` | events:read | range ≤ 100 days; public keys see scheduled events only |
| `GET /api/v1/events/stream` | events:read | Server-Sent Events: `{ type: created|updated|deleted, event }` |
| `POST /api/v1/events` | events:write | `{ title, scheduledAt, endAt?, allDay?, content?, channels?[], platform? }`; public keys → `status: "pending"` |
| `PATCH /api/v1/events/:id` | events:write, token | partial update + `version` (or `If-Match`); stale version → **409** with the current event |
| `DELETE /api/v1/events/:id` | events:write, token | |
| `POST /api/v1/embed-tokens` | secret key, server only | `{ subject?, ttlSeconds? (60–3600), scopes?, origins? }` → `{ token, expiresAt }`; refused if called from a browser |

## 4. Security notes
- **CORS:** `Access-Control-Allow-Origin` is sent only for origins on the key/token; no cookies (`credentials: omit`, no Allow-Credentials). The rest of the CRM API now allows only `APP_URL` (+ `CORS_ALLOWED_ORIGINS`).
- **Origin checks stop other websites from using your key in browsers.** They can't stop a determined script from sending a fake Origin header, so public keys are read-only or request-only, and rate-limited.
- **Isolation:** Shadow DOM, plus the widget resets inherited styles at its root, so even `!important` host rules don't change it. Event text is rendered as text, never HTML.
- **Keys** are stored as hashes; revoking a server key ends all of its tokens immediately.
- **Scaling:** live updates use an in-process event bus. With several server instances, put a shared pub/sub (e.g. Redis) behind `publish()` in `src/routes/embedEventsApi.ts`.

Set `EMBED_TOKEN_SECRET` (32+ random characters) in production; otherwise `JWT_SECRET` is used.
