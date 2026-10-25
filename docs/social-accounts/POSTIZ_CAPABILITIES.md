# Postiz capability check and connection architecture

Route reference, security controls and the revocation strategy: see [API.md](API.md).

Verified against the Postiz source (`github.com/gitroomhq/postiz-app`, `main`,
downloaded Oct 2026). No Postiz endpoint is used that isn't listed here.

## 1. What the `pca_…` / `pcs_…` credentials are

They are **Postiz OAuth application credentials** (Postiz "OAuth apps"):

- Consent page: `GET {POSTIZ_FRONTEND}/oauth/authorize?client_id&state[&redirect_uri]`
  (`apps/frontend/src/app/(app)/oauth/authorize/page.tsx`,
  backend validation in `apps/backend/src/api/routes/oauth.controller.ts`).
- On approval Postiz redirects to the **redirect URL stored on the OAuth app**
  (static apps ignore the `redirect_uri` sent in the request) with `code` and `state`.
- Token: `POST {POSTIZ_API}/oauth/token` with `grant_type=authorization_code`,
  `code`, `client_id`, `client_secret` → `{ access_token: "pos_…", token_type: "bearer" }`.
  Tokens never expire (`oauth.service.ts`); there's no refresh grant except for HubSpot.
- The `pos_` token authorizes the **user's Postiz workspace (organization)**.

**They do not, by themselves, produce social-provider OAuth links.** They're the
first step: authorize a workspace, then use the token with the public API.

## 2. Public API with a `pos_` token or API key

Auth: raw credential in `Authorization` (no `Bearer`), see
`apps/backend/src/services/auth/public.auth.middleware.ts`.

| Endpoint | Used for |
|---|---|
| `GET /public/v1/me` | workspace name |
| `GET /public/v1/integrations` | channels: `id, name, identifier, picture, disabled, profile` |
| `GET /public/v1/social/:integration[?refresh=:id]` | `{ url }` = the **provider's own consent screen** (e.g. Instagram) |
| `DELETE /public/v1/integrations/:id` | remove a channel. **Also deletes that channel's posts in Postiz** |

`/public/v1/social/:integration` validates the provider against Postiz's
allowlist and rejects providers that need an external URL.

### The return-URL gap

The provider consent URL's `redirect_uri` is Postiz's own page,
`{POSTIZ_FRONTEND}/integrations/social/:provider`. That page
(`apps/frontend/src/components/launches/continue.integration.tsx`) completes the
connection and then:

- redirects to a **return URL** if one was stored for that OAuth state, else
- navigates inside Postiz if the browser is logged into Postiz, else
- shows an inline "connected" message.

A return URL is stored (`redirect:{state}` in Postiz's Redis) **only** by:

1. `GET /integrations/social/:integration?redirectUrl=` — needs a Postiz dashboard
   session cookie; not usable server-to-server.
2. `POST /enterprise/url` — needs a JWT signed with the Postiz instance's
   `JWT_SECRET` (`apps/backend/src/api/routes/enterprise.controller.ts`).
   Only usable if **you run Postiz yourself**.

**Conclusion:** on Postiz Cloud, the public API cannot send the user back to this
app after a social-provider authorization. A fully redirect-based flow is possible
only with self-hosted Postiz.

### Other limits found

- **Bluesky:** Postiz's provider uses custom fields entered in the Postiz UI
  (`generateAuthUrl` returns a random token, not a URL). The public API can't drive
  it, so Bluesky uses this app's **direct adapter** instead.
- **"Expired" detection:** the public channel list exposes `disabled` but not
  `refreshNeeded`; channel health (`/public/v1/debug/channels`) is super-admin only.
- **Page pickers** (Facebook/Instagram/LinkedIn pages) happen on Postiz's landing
  page after consent, inside the same window.

## 3. Architecture implemented

```
Browser (Accounts page)                 This app's server                         Postiz / provider
────────────────────────                ─────────────────                         ─────────────────
Connect Instagram ───────────────────►  POST /api/accounts/connect
                                        • verify user (Firebase ID token / JWT)
                                        • allowlist check (shared/types.ts)
   (OAuth mode, first time)             • no workspace token → signed state + cookie
◄── authorize_workspace URL ─────────   ─────────────────────────────────────────►  /oauth/authorize (consent)
                                        GET /postiz/callback?code&state  ◄────────  redirect with code
                                        • verify HMAC state, expiry, single use, cookie
                                        • POST /oauth/token → pos_ token (encrypted)
◄── /?view=social_planner&sa=workspace_connected&sa_resume=instagram
Continue ────────────────────────────►  POST /instagram/connect
                                        • baseline = GET /public/v1/integrations
                                        • GET /public/v1/social/instagram → provider URL
◄── { next: popup, url, attemptId }
popup → provider consent ───────────────────────────────────────────────────────►  Instagram consent
                                                                                    → Postiz landing page saves channel
poll POST /attempts/:id/check ───────►  diff integrations vs baseline (same identifier,
                                        not owned by anyone else) → save connection +
                                        ownership → completed
close popup, refresh cards
```

**Self-hosted Postiz** (`POSTIZ_API_KEY` + `POSTIZ_ENTERPRISE_JWT_SECRET` + `APP_URL`):
`/enterprise/url` is called with `redirectUrl = {APP_URL}/api/accounts/return/{signedState}`.
The state is in the **path** because Postiz appends `?params` to the return URL.
The return handler verifies the signature, expiry and cookie, then the page
confirms the new channel. This is a full redirect with no popup.

### Modes

| Env | Mode | Who owns the Postiz workspace |
|---|---|---|
| `POSTIZ_CLIENT_ID` + `POSTIZ_CLIENT_SECRET` | OAuth | each user authorizes their own workspace |
| `POSTIZ_API_KEY` | API key | one shared workspace; per-user ownership in `store.owners` |
| + `POSTIZ_ENTERPRISE_JWT_SECRET`, `APP_URL` | API key + return-to-app | self-hosted only |

### Statuses

| Status | When |
|---|---|
| Connected | channel present in the workspace and not disabled |
| Not connected | no connection for the platform |
| Needs attention | disabled in Postiz, removed from the workspace, Postiz unreachable, or a direct account that couldn't be verified |
| Expired | Postiz rejected the workspace token / API key (revoked), or a direct credential was revoked |

### Security

- Every API call verifies the user server-side (Firebase ID token, or HS256 JWT).
  `X-Dev-User-Id` works only with `SOCIAL_ACCOUNTS_DEV_AUTH=true` and `NODE_ENV !== 'production'`.
- OAuth state is HMAC-signed, expires after 15 minutes, is single-use, and must match an
  HttpOnly `SameSite=Lax` cookie set when the flow started (prevents login CSRF).
- Platform allowlist enforced server-side before any Postiz call.
- `pos_` tokens and app passwords are encrypted with AES-256-GCM; in production, connecting is refused
  (503) until `SOCIAL_ACCOUNTS_ENCRYPTION_KEY` (≥ 32 chars) is set.
- A channel can be owned by one user only; attempts and disconnects check ownership.
- In shared-workspace mode, two users connecting the same platform at once is refused
  (ambiguous ownership) rather than guessed.
- No credential has a code fallback. The previously hardcoded `pca_…/pcs_…` values in
  `src/services/postizService.ts` were removed. **Rotate them in Postiz.**

## 4. The Postiz OAuth callback and token storage

`GET /api/accounts/callback` (`src/routes/socialAccounts.ts` →
`workspaceCallback` in `server/service.ts`):

1. Reads `code`, `state` (and `error` if the user declined).
2. Verifies the state: HMAC signature, 15-minute expiry, `workspace` kind, matches the
   `sa_oauth_state` HttpOnly cookie set when the signed-in user started the flow.
   The state carries that user's id, which is how the token is tied to them.
   (A browser redirect from Postiz has no Authorization header, and Firebase sessions
   live in the browser, so the signed state is the trusted link.)
3. Claims the attempt (single use) inside a transaction.
4. `POST {POSTIZ_API_URL}/oauth/token` with `grant_type=authorization_code`, `code`,
   `client_id`, `client_secret` (server-side only) → `pos_…` token.
5. Encrypts the token (AES-256-GCM) and saves it on the user's record, with the workspace
   name from `/public/v1/me`.
6. 302 to `{APP_URL}{SOCIAL_ACCOUNTS_RETURN_PATH}?view=social_planner&sa=workspace_connected`.
   Failures redirect with `sa=error&sa_reason=…`; the page explains them.

### Where it's stored

| Store | When | Layout |
|---|---|---|
| Firestore | `SOCIAL_ACCOUNTS_STORE=firestore`, or `auto` when firebase-admin credentials resolve | `social_account_users/{uid}`: token (encrypted), connections, attempts. `social_account_owners/{key}`: channel → owning uid, plus shared-workspace connection locks |
| File | `file`, or `auto` without Firestore credentials | `data/social-accounts/accounts.json` (mode 600) |

Every change is one transaction over the user's document and the owner keys it touches.
`firestore.rules` denies all browser access to both collections; only the server
(firebase-admin) reads them.

## 5. Adding a direct provider OAuth

Implement `DirectAdapter` in `src/features/social-accounts/server/directAdapters.ts`,
register it in `DIRECT_ADAPTERS`, and set the platform's `method: 'direct'` in
`shared/types.ts`. For a provider OAuth flow, reuse `signState`/`verifyState` and the
`/return/:state` pattern from the Postiz flow, and store tokens with `seal()`.

## 6. Not covered here

- **Bluesky posts:** Bluesky connects directly (not via Postiz), so `/api/posts` can't schedule
  to it yet; the legacy scheduler's Bluesky adapter still exists.
- Re-verify these endpoints when upgrading Postiz; none of `/enterprise/*` is part of
  the documented public API.

## Configuration

```
POSTIZ_API_URL=https://api.postiz.com
POSTIZ_FRONTEND_URL=https://platform.postiz.com
POSTIZ_CLIENT_ID=pca_…            # OAuth mode
POSTIZ_CLIENT_SECRET=pcs_…
POSTIZ_REDIRECT_URI=https://your-app.example/api/accounts/callback   # must equal the app's saved redirect URL in Postiz
# or: POSTIZ_API_KEY=…            # shared workspace mode
# POSTIZ_ENTERPRISE_JWT_SECRET=…  # self-hosted Postiz only (its JWT_SECRET)
APP_URL=https://your-app.example
SOCIAL_ACCOUNTS_ENCRYPTION_KEY=<32+ random characters>
BLUESKY_ALLOWED_SERVICES=https://bsky.social
SOCIAL_ACCOUNTS_STORE=auto           # firestore | file | auto
SOCIAL_ACCOUNTS_RETURN_PATH=/         # where users land after authorizing
```

Tests: `npm run test:social-accounts` (57 end-to-end checks across both modes against a
mock that follows the contracts above, plus 8 Firestore-store checks against a strict fake).
