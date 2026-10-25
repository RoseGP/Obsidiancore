# Social Planner (Pulse)

The Social Planner tab (`src/components/SocialPlannerTab.tsx`) renders the Pulse
planner from `src/features/social-planner/`. The previous planner
(`SocialPlannerView`: Postiz, OAuth connections, worker monitor, grid) is kept
under **Settings → Advanced tools**, and opens automatically after an OAuth
connection redirect.

## Data

All posts and accounts come from the existing posts API (`src/routes/posts.ts`).
There is no client-side sample data. Only view preferences (week start, clock,
default time and platforms) are kept in the browser, per user.

| Call | Endpoint |
|---|---|
| Load visible range | `GET /api/posts/queue?status=all&from&to&limit&userId` |
| Accounts | `GET /api/posts/accounts?userId` |
| Create (draft or scheduled) | `POST /api/posts/schedule` with `status: "draft"` for drafts |
| Edit / reschedule | `PATCH /api/posts/:id` (new) |
| Delete | `DELETE /api/posts/:id` |
| Retry failed | `POST /api/posts/retry/:id` |

Status mapping: `pending` → Scheduled, `processing` → Publishing, `draft`,
`published`, `failed`. Only `pending` posts are picked up by the scheduler.

## Changes to `src/routes/posts.ts`

- Drafts: `POST /schedule` accepts `status: "draft"`.
- New `PATCH /:id` to edit content, platforms, media, time or draft/scheduled
  state. Published and in-flight posts are locked; scheduled times must be in
  the future; editing a failed post re-queues it.
- `GET /queue` now returns only the caller's posts and supports `from`/`to`.
- Edit, delete and retry check that the post belongs to the caller (404 otherwise).
  Retry only accepts failed posts.
- Firestore is used only when credentials resolve. Previously, any `/api/posts`
  request crashed the Node process when credentials were missing (an
  unhandled rejection inside the Firebase SDK); it now uses the route's
  in-memory fallback.

## Known limits

- Auto-publishing adapters exist for X, LinkedIn, Bluesky and Mastodon only.
  Instagram, TikTok and Facebook posts can be scheduled but won't auto-publish;
  the UI says so.
- The posts API identifies users by a client-supplied `userId` (unchanged from
  before). Server-side session verification is recommended before production.
- Engagement metrics and the social inbox aren't provided by the API; those
  screens show explicit empty states.
- `GET /api/social-planner/analytics` still returns fixed numbers from before;
  the new UI doesn't use it (analytics are computed from real posts).

## Structure

```
domain/      model + platform config, calendar math, validation (pure)
services/    plannerApi.ts — HTTP client for /api/posts
state/       PlannerStore (cache, optimistic updates + rollback, per-post locks), prefs
ui/          kit: buttons, segmented, glyphs, skeletons, states, dialog, toasts
components/  post chip + preview popover, composer
pages/       calendar (month/week/list), dashboard, analytics, accounts, inbox, settings
```
