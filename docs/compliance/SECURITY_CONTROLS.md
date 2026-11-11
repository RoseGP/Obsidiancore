# Security controls

## Authentication

- **Firebase Authentication** (email/password, Google). Passwords are hashed by Firebase (scrypt); password reset
  and sign-in lockout (`auth/too-many-requests`) are Firebase's. Every API request carries a Firebase ID token in
  the `Authorization` header, verified with `verifyIdToken(token, checkRevoked = true)`.
- **Sign out everywhere**: Settings › Security calls `POST /api/account/sessions/revoke-all`
  (`revokeRefreshTokens`); revoked tokens stop working at once because revocation is checked per request.
- **Sign-in failure monitoring** (`src/server/security/loginMonitor.ts`): a request that presents a credential which
  fails verification counts against its IP. After `AUTH_FAILURE_LIMIT` (20) failures in
  `AUTH_FAILURE_WINDOW_MINUTES` (15), further bad credentials from that IP get `429 too_many_failed_sign_ins` for
  `AUTH_LOCKOUT_MINUTES` (15). Valid credentials from the same IP still work, so one client on a shared network
  can't lock others out. IPs are kept only as salted hashes. Behind a proxy set `TRUST_PROXY=1`.

### Two-step sign-in (TOTP): how to enable

Two-step sign-in uses Firebase multi-factor authentication with authenticator apps (TOTP). It needs
**Identity Platform** on the Firebase project:

1. Google Cloud console › Identity Platform: enable it for the project (upgrades Firebase Auth; billing applies above the free tier).
2. Identity Platform › Settings › MFA: enable **Multi-factor authentication**, turn on **Time-based one-time password (TOTP)**.
   (Or use the Admin SDK: `projectConfigManager().updateProjectConfig({ multiFactorConfig: { providerConfigs: [{ state: 'ENABLED', totpProviderConfig: { adjacentIntervals: 5 } }] } })`.)
3. Users need a verified email to enroll.

Until this is done, Settings › Security says two-step sign-in isn't switched on for the project (no fake success).
After enrolling, users sign out and in again so their session carries the second factor
(`firebase.sign_in_second_factor` in the ID token), which is what the server checks.

## Sessions

Organization rules (Settings › Security, admins): require two-step sign-in, maximum session age (server-enforced from
the credential's `auth_time`), sign-out after inactivity (browser). The existing screen lock (auto-lock) still applies.

## Authorization

See [ACCESS_CONTROL.md](ACCESS_CONTROL.md). Tenant data is always read through `tenantOf(req).orgId`; ids from
request bodies are never trusted.

## HTTP security headers (`src/server/security/headers.ts`)

| Header | Value |
|---|---|
| X-Content-Type-Options | `nosniff` |
| X-Frame-Options | `SAMEORIGIN` (not on the embeddable chat widget paths; set `FRAME_ANCESTORS` to allow other sites) |
| Referrer-Policy | `strict-origin-when-cross-origin` |
| Permissions-Policy | camera, microphone, screen capture for this site only (GREET) |
| Cross-Origin-Opener-Policy | `same-origin-allow-popups` (Google / Firebase sign-in popups) |
| Strict-Transport-Security | production only, 1 year |
| Content-Security-Policy | production only; **Report-Only** unless `CSP_ENFORCE=true`. Allows this site, Google Fonts, Firebase/Google sign-in, Stripe, `https:`/`wss:` connections (LiveKit URL varies), and the inline theme script by hash |
| Cache-Control | `no-store` on `/api` |

Rollout: deploy with report-only, check the browser console for violations across the app (sign-in, GREET, payments),
then set `CSP_ENFORCE=true`.

## CSRF

Every authenticated API call uses a bearer token in the `Authorization` header, which browsers never attach
automatically, so cross-site requests can't act as the user. No cookie authenticates a request: the only cookies
are short-lived OAuth `state` cookies (`HttpOnly`, `Secure`, `SameSite`) checked on the OAuth callbacks. The
account, Local SEO and Social Planner routers additionally check the `Origin` (`csrfGuard`). CORS only allows
`APP_URL` and `CORS_ALLOWED_ORIGINS`.

## Uploads (`src/server/security/uploads.ts`)

| Where | Rules |
|---|---|
| `/api/posts/upload`, `/api/media/upload` | One file, 25 MB, type from the file's bytes (JPEG, PNG, GIF, WebP, MP4, MOV; never SVG/HTML), sanitized file name, forwarded to the Social Planner gateway (not stored or served here) |
| Invoice logo and signature (`/api/billing`) | PNG/JPEG data URL whose decoded bytes really are PNG/JPEG, at most 750 KB |
| Inbox attachments | `501 not_available` until file storage is connected |

Nothing users upload is served from the app's origin.

## Encryption

- In transit: HTTPS (HSTS). LiveKit uses `wss://`.
- At rest: Firestore encrypts all data at rest (Google-managed keys; CMEK available). Connected-account and Google
  tokens are additionally encrypted by the app (AES-256-GCM; `SOCIAL_ACCOUNTS_ENCRYPTION_KEY`,
  `GOOGLE_TOKEN_ENCRYPTION_KEY`, `ENCRYPTION_KEY`).
- Secrets come only from environment variables or a secret manager and are never returned or logged
  (`scripts/lint-guards.mjs` blocks secret-looking literals).

## Audit log

`organizations/{org}/audit_log`, append-only, written through `recordAudit()` (`src/server/audit/auditLog.ts`).
Recorded: organization created; members invited, joined, role changed, removed or left; API/embed keys created,
rotated, revoked; lead exports and deletions; security policy changes; consent records; privacy requests (created,
approved, rejected, exported, corrected, erased); retention changes and runs; access reviews; incidents; audit
log exports. Not recorded: secrets, message text, raw IP addresses (salted hash only; set `AUDIT_IP_SALT` to keep
hashes stable across restarts). Read in Settings › Privacy & compliance › Audit log or `GET /api/admin/audit-log`
(CSV with `?format=csv`).

Not yet audited from this layer: GREET meeting token issuance and recording access (the GREET routes should call
`recordAudit` with the same shape), payment provider connect/disconnect (the payments routes are being moved to
organizations; they should audit once they have a tenant).

## Backups and recovery

Enable Firestore point-in-time recovery and scheduled exports in Google Cloud (`gcloud firestore databases update
--enable-pitr`, and a scheduled `gcloud firestore export` to a locked bucket). Test a restore at least yearly.
The in-memory store used in development has no persistence.

## Environment variables (security)

| Variable | Default | Purpose |
|---|---|---|
| `TRUST_PROXY` | unset | Proxy hops to trust for client IPs (e.g. `1` on Cloud Run/Render/Heroku) |
| `CSP_ENFORCE` | `false` | Enforce the Content-Security-Policy instead of report-only |
| `FRAME_ANCESTORS` | `'self'` | Sites allowed to frame the app (CSP `frame-ancestors`) |
| `AUTH_FAILURE_LIMIT` / `AUTH_FAILURE_WINDOW_MINUTES` / `AUTH_LOCKOUT_MINUTES` | 20 / 15 / 15 | Sign-in failure monitoring |
| `AUDIT_IP_SALT` | random per process | Salt for hashed IPs in the audit log |
