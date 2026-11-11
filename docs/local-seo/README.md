# Local SEO & Reputation (Google Business Profile)

The **Local GBP** tab (`src/components/GbpView.tsx` → `localpilot/LocalPilotApp.tsx`) now runs on
real Google data through `/api/local-seo`. The former `mockData.ts` seed and the hardcoded
dashboard figures are no longer used.

## Status by feature (from the spec)

| Feature | Status |
|---|---|
| Connect Google Business Profile (OAuth, PKCE, revoke on disconnect) | **Live** |
| Discover accounts and locations, choose which to manage | **Live** |
| Review sync, sentiment + topics (rule-based estimate) | **Live** |
| AI reply drafts with safety flags, human approval to publish | **Live** (needs `GEMINI_API_KEY`; no canned fallback) |
| Publish / delete replies | **Live** |
| Profile health audit + recommendations | **Live** (this app's diagnostic, not a Google score) |
| Performance metrics (views, calls, clicks, directions) | **Live** |
| Google posts | **Live**, publish-now only (Google's API has no scheduling) |
| Profile edits | **Live** for phone, website, description; others link to Google |
| AI assistant drawer, Security log, Reports, Team settings, Photos, Attributes | **Not wired yet** (Phase 3); they show empty states, no fabricated data |
| New-review notifications (Pub/Sub) | Not built (use **Sync now** or a scheduled job) |

The **Business Profiles** tab (`docs/business-profiles/README.md`) builds on this connection to audit CRM
profile records against linked locations and publish reviewed changes.

## Google Cloud setup (required before it works)

1. In Google Cloud, create or choose a project and **request Business Profile API access**
   (Google must approve it; until then calls return 403).
2. Enable: *My Business Account Management API*, *My Business Business Information API*,
   *Business Profile Performance API*, and *Google My Business API* (v4, for reviews and posts).
3. OAuth consent screen: add the scope `https://www.googleapis.com/auth/business.manage`
   (sensitive scope → Google verification for production).
4. OAuth client (Web): authorized redirect URI `https://<your-domain>/api/local-seo/callback`.
5. Server environment:

```
GOOGLE_CLIENT_ID=…apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=…
APP_URL=https://<your-domain>
GOOGLE_GBP_REDIRECT_URI=https://<your-domain>/api/local-seo/callback   # optional, defaults to this
GEMINI_API_KEY=…                       # optional: AI drafts
SOCIAL_ACCOUNTS_ENCRYPTION_KEY=<32+ random chars>
SOCIAL_ACCOUNTS_STORE=firestore        # production
```

## Architecture

```
routes/localSeoApi.ts  ──► features/gbp/server/service.ts   (rules, ownership, audit, AI prompts)
                                 ├─► features/gbp/server/store.ts         (gbp_users/{uid} or file; tokens encrypted)
                                 └─► features/gbp/server/googleGateway.ts (the only Google-specific code)
components/localpilot/live/      (client, connection panel, performance view) ──► existing LocalPilot views
```

Google endpoints used (verified against the `googleapis@178` generated clients unless noted):
`GET mybusinessaccountmanagement/v1/accounts`, `GET mybusinessbusinessinformation/v1/{account}/locations?readMask`,
`PATCH …/v1/{location}?updateMask`, `GET businessprofileperformance/v1/{location}:fetchMultiDailyMetricsTimeSeries`.
**Reviews and posts use Google My Business API v4** (`…/v4/{account}/{location}/reviews`, `…/reviews/{id}/reply`,
`…/localPosts`), which isn't in the generated client; these follow Google's published v4 reference.
Re-verify them, and that v4 access is enabled for your project, before launch.

## Security

Same controls as the social planner (see `docs/social-accounts/API.md`): verified login on every route,
ownership (locations must be on the user's Google account and selected; review ids come from the user's
own synced data), CSRF origin checks, zod validation, rate limits (stricter on Google-quota calls),
log redaction (`ya29.` access tokens, `1//` refresh tokens), encrypted tokens at rest, no-store caching.

OAuth specifics: PKCE (S256) + HMAC-signed single-use state bound to an HttpOnly SameSite cookie;
code exchange on the server; refusal if `business.manage` wasn't granted (token revoked);
`access_type=offline` refresh tokens; expired or revoked refresh → **Reconnect** state.

**Disconnect** revokes the refresh token at Google (`oauth2.googleapis.com/revoke`, which also invalidates
access tokens), then deletes the stored tokens, locations, reviews and drafts. Google profiles and
reviews themselves are never changed by disconnecting.

## Fixes to the previous implementation

- The tab displayed `mockData.ts` and hardcoded numbers ("127 locations", "4.8★, 1,284 reviews",
  "Security 96/100", "+12.4% lift") as if live; all now come from real data or show empty states.
- "Reply published to Google Maps" and "Location synced" toasts appeared without any Google call.
- The reviews list's publish button was wired to a non-existent prop (`onReplyReview` vs `onApproveAndPublish`).
- **Regenerate** returned a hardcoded restaurant reply after a fake delay.
- The drawer's **Approve & Publish** button was covered by the CRM chat bubble (z-index).
- The legacy `src/routes/gbp.ts` (still mounted at `/api/gbp`, unused by this tab) fabricates locations for
  "mock" tokens, logs access tokens in plain text, returns canned replies, and has no login check.
  **Recommended: remove it** once nothing else depends on it.

## Tests

`npm run test:local-seo`: 27 end-to-end checks against a Google stand-in (`src/features/gbp/__tests__`).
