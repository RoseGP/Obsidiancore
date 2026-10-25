# Social planner API (application routes)

All routes are Express routers in `src/routes/` and follow the project's
conventions (`Router()`, JSON bodies, mounted in `server.ts`). Postiz-specific
code lives only in `src/features/social-accounts/server/postiz/postizGateway.ts`
behind the provider-neutral `WorkspaceGateway` interface (`server/gateway.ts`).

```
routes/accountsApi.ts ─┐
routes/postsApi.ts ────┼─► server/service.ts, server/postsService.ts  (business rules, ownership)
routes/analyticsApi.ts ┘          │
                                  ├─► server/store.ts      (Firestore / file; encrypted tokens)
                                  └─► server/gateway.ts ◄── server/postiz/postizGateway.ts (only Postiz code)
```

## Endpoints and their Postiz mapping

| App route | Does | Postiz call(s) |
|---|---|---|
| `GET /api/accounts` | the user's accounts + one card per platform | `GET /public/v1/integrations` |
| `POST /api/accounts/connect` `{ platform, credentials? }` | start a connection (or connect Bluesky directly) | `GET /public/v1/social/:provider` (or `POST /enterprise/url` self-hosted); first time: consent at `/oauth/authorize` |
| `GET /api/accounts/callback?code&state` | Postiz OAuth redirect | `POST /oauth/token`, `GET /public/v1/me` |
| `POST /api/accounts/:id/reconnect` | refresh an account the user owns | `GET /public/v1/social/:provider?refresh=:channelId` |
| `DELETE /api/accounts/:id` | disconnect | `DELETE /public/v1/integrations/:id` |
| `POST /api/accounts/attempts/:id/check` `{ final }` | detect a finished connection | `GET /public/v1/integrations` (diff vs. baseline) |
| `POST /api/accounts/attempts/:id/cancel` | cancel a pending connection | none |
| `DELETE /api/accounts/workspace` | forget the stored Postiz token | none (see revocation) |
| `GET /api/posts?from&to` | the user's posts | `GET /public/v1/posts?startDate&endDate` filtered to owned channels |
| `POST /api/posts` | create / schedule / draft | `POST /public/v1/upload-from-url` per media, `POST /public/v1/posts` |
| `PATCH /api/posts/:id` | edit content/time/media/draft | `POST /public/v1/posts` with the post's `group` + `value[].id` (Postiz updates in place) |
| `DELETE /api/posts/:id` | delete | `DELETE /public/v1/posts/:id`, which removes the **whole group** |
| `GET /api/analytics?days=30` | publishing activity | `GET /public/v1/posts` (no Postiz analytics endpoint exists) |

Legacy paths in `src/routes/posts.ts` (`/api/posts/queue`, `/schedule`, `/retry/:id`,
`/accounts`) still exist for the older panels, but now sit behind the same
authentication and use only the verified user id.

### What Postiz doesn't support (and how the app behaves)

- **Editing posts created outside the app:** Postiz's post list omits media, and
  re-saving would replace it. Such posts are listed with `editable: false`;
  PATCH returns `409 external_post` unless new `mediaUrls` are supplied.
- **Editing published posts:** `409 published` (Postiz also guards against republishing).
- **Deleting one channel's post from a multi-channel group:** Postiz deletes the whole group.
  The app refuses (`403`) if the group contains any channel the user doesn't own, and
  returns `deletedIds` so the UI can show what went.
- **Engagement analytics:** not available; `engagement.available: false`.
- **Retry:** no Postiz endpoint. The planner reschedules a failed post (PATCH).

## Security controls

| Requirement | Implementation |
|---|---|
| Authenticate every call | `requireUser` (`server/auth.ts`): Firebase ID token verified with firebase-admin, or HS256 JWT. Dev header only with `SOCIAL_ACCOUNTS_DEV_AUTH=true` outside production. |
| Ownership | Accounts: user's own records + `owners` table (one owner per channel). Posts: server-side post index per user; ids from the client are looked up there and their channel re-checked against ownership. Workspace ids are never accepted from the client (strict schemas reject them). |
| No secrets client-side | Client ID/secret, API key, `pos_` tokens and app passwords stay on the server; responses never include them (tested). |
| Server-side code exchange | `workspaceCallback` → gateway `exchangeCode`. |
| Random, validated state | 96-bit random attempt id inside an HMAC-SHA256-signed, 15-minute state; single use; bound to the starting user. |
| Cookies | `sa_oauth_state`: `HttpOnly; SameSite=Lax; Path=/api/accounts; Max-Age=900; Secure` in production. Must equal the returned state. |
| Open redirects | Callback only redirects to `APP_URL` + `SOCIAL_ACCOUNTS_RETURN_PATH` (same-site path only). Postiz return URLs are built server-side. |
| Encryption at rest | AES-256-GCM (`server/config.ts`), key from `SOCIAL_ACCOUNTS_ENCRYPTION_KEY`; production refuses to connect without it. |
| Log redaction | `server/http.ts` `redact()` masks `pos_`, `pca_`/`pcs_`, Bearer tokens, `code`/`state` query values, secret JSON fields and app passwords. Errors are logged through it. |
| CSRF | Writes require the app's `Origin` (or Referer) and JSON bodies; auth is a header browsers never attach automatically. The callback is protected by state + cookie. |
| Input validation | zod schemas, `.strict()` (unknown fields rejected), https-only media, future times, range limits. |
| Rate limiting | Per user: 120/min (API), 20 connects/10 min, 30 writes/min, 30 analytics/min; per IP: 30 callbacks/min. In-memory: use a shared store (e.g. Redis) when running several instances. |
| Safe errors | Fixed `{ code, error }` shapes; no stack traces or upstream bodies; `Cache-Control: no-store`, `Referrer-Policy: no-referrer` on account routes. |
| Cancellation / denial / duplicates / expiry | Cancel endpoint; `error=access_denied` → cancelled; replayed callbacks → `expired`; states older than 15 minutes → `invalid_state`; stale attempts → `expired`. |

## Token revocation and disconnect strategy

Postiz has **no API to revoke a `pos_` token** (revocation is only in the Postiz
dashboard: `/user/approved-apps`, which needs a Postiz login). So:

1. **Disconnect one account:** `DELETE /api/accounts/:id`. The app deletes the channel from the
   Postiz workspace (`DELETE /public/v1/integrations/:id`; Postiz also deletes that channel's
   scheduled posts), removes the local record and its ownership entry.
2. **Disconnect the workspace:** `DELETE /api/accounts/workspace`. The app deletes its encrypted
   `pos_` token immediately, so it stops using it at once. The response tells the user to finish
   revocation in Postiz under **Settings → Approved apps**.
3. **Revoked from Postiz's side:** the next API call gets 401; the app marks the workspace
   **Expired**, stops using the token, and the next Connect starts a fresh authorization.
4. **Compromise response:** rotate `SOCIAL_ACCOUNTS_ENCRYPTION_KEY` (stored tokens become
   unreadable → users re-authorize), rotate the Postiz client secret, and ask users to revoke
   the app in Postiz.
5. **Account deletion in this app:** delete `social_account_users/{uid}` and the user's
   `social_account_owners` entries after step 1/2 for each account.

## Tests

`npm run test:social-accounts`: 39 checks (OAuth mode) + 31 (shared workspace) end-to-end
against a mock that follows the verified Postiz contracts, plus 8 Firestore-store checks.
