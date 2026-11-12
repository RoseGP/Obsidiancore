# Email sign-in links (magic links)

The sign-in page offers **Email me a sign-in link**. The person enters their address, receives a link, opens it
in the browser, and is signed in. It's built on the existing Firebase sign-in: the link is exchanged for a
Firebase custom token (`signInWithCustomToken`), so everything after sign-in (ID tokens, organization security
policy, required two-step, session age) works exactly as for a password sign-in.

## Flow
1. `POST /api/auth/magic-link/request { email }` → always **202** with the same message, whether or not an account
   exists, is disabled, or was throttled. Only accounts that exist and are enabled get a link.
2. The server stores **only the SHA-256** of a 32-byte random token (`auth_magic_links/{sha256}`) with the account
   id and expiry. The email links to `APP_URL/auth/magic#token=…`; the token is in the URL **fragment**, which
   browsers never send to servers (no access logs, proxies or Referer leaks).
3. `/auth/magic` (`MagicLinkLanding.tsx`) removes the token from the address bar, then calls
   `POST /api/auth/magic-link/verify { token }`. In one transaction the record is read **and deleted**, so the
   link works once, even with concurrent attempts. Unknown, used, expired or tampered tokens all get
   **400 `invalid_or_expired_link`**. Redemption needs JavaScript, so mail scanners that fetch links don't use them up.
4. The response is a Firebase custom token; the browser signs in with it.

Accounts with **two-step sign-in** enrolled never get a link (they're emailed an explanation instead), and a link
issued before enrolment is refused (403 `second_factor_required`): a link must not bypass a second factor.

## Limits
| Limit | Default | Setting |
|---|---|---|
| Link lifetime | 15 minutes | `MAGIC_LINK_TTL_MINUTES` (5–60) |
| Links per address per 15 min (excess silently dropped) | 3 | `MAGIC_LINK_MAX_PER_WINDOW` |
| Requests per IP per 15 min (then 429) | 10 | `MAGIC_LINK_IP_LIMIT` |
| Redemptions per IP per 15 min (then 429) | 30 | — |
Failed redemptions also count toward the existing sign-in failure monitor.

## Configuration
| Variable | Needed for |
|---|---|
| `APP_URL` | Link base URL (required in production; never taken from the request's Host header) |
| `SMTP_HOST`, `SMTP_FROM` (+ `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`) | Sending the email (any SMTP provider). `AUTH_SMTP_*` overrides for sign-in mail only |
| Firebase Admin credentials that can sign tokens | `GOOGLE_APPLICATION_CREDENTIALS` (service-account JSON) locally/elsewhere; on Google Cloud, the runtime service account needs **Service Account Token Creator** |
| `FIREBASE_PROJECT_ID` (or `firebase-applet-config.json`) | Firebase project |

`GET /api/auth/magic-link/status` reports `{ enabled, reason }` (`email_not_configured`, `sign_in_not_configured`,
`app_url_not_configured`); the sign-in page shows the option disabled with that reason. Without configuration,
requests get **503 `magic_link_not_configured`** (this says nothing about any account).

## Local development and testing
- `MAIL_DEV_LOG=true` with `NODE_ENV=development` prints the email (with the link) to the server log instead of
  sending it. It is ignored when `NODE_ENV` is anything else, so it can't leak links in production.
- Redeeming still needs Firebase Admin credentials (custom tokens are signed by your Firebase project). Without
  them, `verify` answers 503 `sign_in_unavailable` and the account lookup fails closed (no email is sent).
- Automated tests use stand-ins for Firebase and SMTP: `npm run test:magic-link`.

## Storage
Firestore collections written only by the server (client access is denied by the default rule in
`firestore.rules`): `auth_magic_links/{sha256(token)}` `{ uid, emailKey, createdAt, expiresAt }` and
`auth_magic_link_throttle/{emailKey}` `{ windowStart, count }` (`emailKey` is a SHA-256 of the address, not the
address). Used links are deleted when redeemed; links that are never used remain until tried (then removed) —
add a Firestore TTL policy on `expiresAt` for `auth_magic_links` to clean them up automatically.
No migration is needed.
