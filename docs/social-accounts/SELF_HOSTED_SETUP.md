# Social Planner with a self-hosted Postiz

The planner talks to Postiz from the server only. The browser never sees Postiz tokens or keys.

## 1. Environment

```
APP_URL=https://crm.yourdomain.com
POSTIZ_URL=https://postiz.yourdomain.com       # backend = <url>/api, consent page = <url>
POSTIZ_CLIENT_ID=pca_…                          # Postiz → Settings → OAuth apps
POSTIZ_CLIENT_SECRET=pcs_…
SOCIAL_ACCOUNTS_ENCRYPTION_KEY=<32+ random chars>   # encrypts stored Postiz tokens (required in production)
```

In the Postiz OAuth app, set the redirect URL to `https://crm.yourdomain.com/api/accounts/callback`.

Optional, one shared team workspace instead of per-user authorization: leave the client id empty and set
`POSTIZ_API_KEY`. Add `POSTIZ_ENTERPRISE_JWT_SECRET` (your Postiz `JWT_SECRET`) so users return to the CRM
after connecting a channel instead of using a pop-up.

If your Postiz backend isn't at `<url>/api`, set `POSTIZ_API_URL` (and `POSTIZ_FRONTEND_URL`) explicitly.

## 2. How the planner maps to Postiz

| Planner action | App route | Postiz call |
|---|---|---|
| Connect workspace | `POST /api/accounts/connect` → `/api/accounts/callback` | `/oauth/authorize`, `POST /oauth/token` |
| Connect a channel | `POST /api/accounts/connect`, `/attempts/:id/check` | `GET /public/v1/social/:provider`, `GET /public/v1/integrations` |
| Channel list | `GET /api/social/integrations` (= `/api/accounts/integrations`) | `GET /public/v1/integrations` |
| Upload a file | `POST /api/posts/upload` (= `/api/media/upload`), multipart `file` | `POST /public/v1/upload` |
| Save draft / Schedule / Publish now | `POST /api/posts` with `mode: draft / schedule / now` | `POST /public/v1/posts` (`type`) |
| Calendar | `GET /api/posts?from&to` | `GET /public/v1/posts?startDate&endDate` |
| Edit / drag to reschedule | `PATCH /api/posts/:id` | `POST /public/v1/posts` with the post's group and id |
| Delete | `DELETE /api/posts/:id` | `DELETE /public/v1/posts/:id` (removes the whole group) |

Differences from generic OAuth: Postiz expects the raw `pos_…` token in `Authorization` (no `Bearer`),
workspace tokens don't expire and there is no refresh grant (HubSpot only), and there is no `PATCH` for
posts. If Postiz rejects a token, the planner asks the user to reconnect the workspace.

## 3. Check it works

1. Settings → Social Planner → Accounts: "Connect Instagram" (or any channel) → approve in Postiz.
2. New Post → pick the channel → Upload file → Schedule post. It appears in the planner calendar and in Postiz.
3. Drag it to another day; delete it. Both changes show in Postiz.
4. Publish now asks for confirmation and sends Postiz `type: "now"`.
