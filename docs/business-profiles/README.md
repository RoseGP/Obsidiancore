# Business Profile Manager (business profiles & SEO audit)

A CRM tab (**Business Profiles** in the sidebar, view id `business_profiles`) for keeping business
listings complete, accurate and consistent. The CRM keeps its own record of each business; external
listings such as Google Business Profile are linked to it and only changed through a previewed,
explicitly confirmed publish.

Code: `src/features/business-profiles/` · API: `/api/business-profiles` · Tests: `npm run test:business-profiles`

## What it does

| Area | Behaviour |
|---|---|
| Dashboard | Every profile you’re a member of: status, health score, completeness, issues to fix, stale flags, outdated-audit flag, Google link. Portfolio KPIs, search and filters (needs attention, drafts, active, archived). |
| Profile management | Name, legal name, categories, description, phones, email, website, address or service area, weekly + special hours, services, attributes, media links, opening date. Validated on client and server with the same zod schema. |
| Traceability | Every change bumps the profile `version` and writes a change-log entry: who, when, source (manual / reviewed AI suggestion / import / review / system) and field-level before → after. Optimistic concurrency: a save based on an old version gets **409** and the user reloads. |
| Audit | Deterministic rules (no LLM) across completeness, accuracy, content quality, freshness, media and listing consistency. Each finding has a plain-language explanation, a recommendation, impact, effort, severity and a priority (impact × severity ÷ effort). Checks that can’t run are reported as **not checked** and excluded from the score. |
| Progress | Live audit on every view, plus recorded audits (history with trend chart). “Confirm hours are correct” and “Mark profile as reviewed” record freshness. Editing hours clears the confirmation. |
| AI assistant | Drafts a description or service descriptions from the profile’s own facts. Output is checked, shown with warnings, editable, and only saved when the user saves the profile. |
| Listings | Links a Google Business Profile location (via the existing Local GBP connection), reads a timestamped snapshot, compares it with the CRM record, and publishes phone / website / description after a preview and confirmation. |
| Team | Per-profile roles enforced on the server: viewer, editor, manager, owner. |

The health score is **this app’s own diagnostic**. It is not a Google metric and the UI states that no
recommendation guarantees rankings or business outcomes.

## Provenance (shown on every finding and suggestion)

- **Rule-based check** (`algorithmic`): deterministic rule over CRM data.
- **Verified from Google** (`verified`): comparison against data read from Google’s official API, with the date it was read.
  A warning appears when that data is older than 30 days.
- **AI suggestion** (`ai`): model output; never saved without user review.

## Roles

| Action | viewer | editor | manager | owner |
|---|:-:|:-:|:-:|:-:|
| View profile, audits, history | ✓ | ✓ | ✓ | ✓ |
| Edit, confirm hours/review, record audits, AI suggestions, refresh listing data | | ✓ | ✓ | ✓ |
| Link/unlink listings, publish to Google, archive/restore | | | ✓ | ✓ |
| Manage members, delete (typed name confirmation) | | | | ✓ |

The creator becomes owner. Roles live in the profile document and are checked inside the store
transaction on every mutation; the client’s claimed CRM role (`AuthContext`) is **not** trusted.
Non-members get 404 so profile ids don’t leak. A profile always keeps at least one owner.
Members are added by sign-in user id (there is no server-side user directory to search yet).

## Google Business Profile integration

Reuses `features/gbp` (Local GBP tab): OAuth with PKCE, encrypted tokens, refresh/reconnect handling.
Business profiles never see tokens. Each user publishes with **their own** Google connection, so Google’s
own permissions also apply: a manager can only publish to locations their Google account manages and
has selected in the Local GBP tab.

- **Link**: manager chooses a selected location; a snapshot is stored with its timestamp.
- **Refresh**: re-reads locations from Google (quota-sensitive; rate limited).
- **Import**: reads a location into a draft the user reviews before creating a profile (nothing saved until they confirm).
- **Publish**: `POST /:id/publish/preview` re-reads Google, returns a field-by-field diff (current Google value
  vs CRM value), skips unchanged and empty fields (publishing never clears a field on Google), lists audit
  warnings for those fields, and returns a confirmation token signed with HMAC-SHA256. The token is bound to
  user, profile, version, listing, field list and a hash of the exact values, and expires in 10 minutes.
  `POST /:id/publish` requires `confirm: true` and that token; any edit after the preview invalidates it.
  The publish result (success or failure) goes into the publish log and change history.
- **Supported fields**: phone, website, description (what the existing gateway sends with an `updateMask`).
  Name, address, categories and hours must be edited in Google Business Profile; the UI says so.
- Nothing is faked: when Google isn’t configured or connected, status says exactly that and consistency
  checks are “not checked”.

### Setup still required (not available in this repository)

1. Complete the Google Cloud steps in `docs/local-seo/README.md` (Business Profile API access approval,
   APIs enabled, OAuth consent with `business.manage`, OAuth client, redirect URI).
2. Server environment:
   ```
   GOOGLE_CLIENT_ID=…            GOOGLE_CLIENT_SECRET=…
   APP_URL=https://<your-domain>
   SOCIAL_ACCOUNTS_ENCRYPTION_KEY=<32+ random chars>   # also keys the publish confirmation HMAC
   SOCIAL_ACCOUNTS_STORE=firestore                     # production (collection: business_profiles)
   GEMINI_API_KEY=…                                    # optional: AI suggestions
   BUSINESS_PROFILES_AI_MODEL=gemini-2.5-flash         # optional override
   ```
3. Firestore: the collection `business_profiles` is written only by the server (Admin SDK). Keep client
   access denied in `firestore.rules`, and add a single-field index on `memberIds` (array-contains) if your
   project doesn’t create it automatically.

Without step 2, the tab still works for managing profiles and audits; integration and AI sections show
“not configured”. Without `SOCIAL_ACCOUNTS_ENCRYPTION_KEY` in production, publishing is disabled (503).

## AI safety

- Used only for language generation (description, service descriptions). Completeness, consistency and
  validation are deterministic.
- Data minimisation: only business name, categories, city/region (unless the address is hidden), service
  areas, services, attributes, opening year, current description and the user’s optional notes are sent.
  Phone, email, website and street address are never sent.
- Prompt-injection hardening: facts are passed as a JSON data block marked as data, not instructions.
- Output must be JSON and is validated with zod; malformed output → 502 `ai_malformed`.
- Deterministic post-checks flag numbers and proper names not in the facts, contact details, ranking or
  results guarantees, and promotional wording. Service suggestions for services not on the profile are dropped.
- 25 s timeout, one retry on transient errors, mapped errors (`ai_timeout`, `ai_rate_limited`, `ai_error`)
  without provider details; per-user rate limit of 8 requests/minute.

## API

See the route table at the top of `src/features/business-profiles/server/router.ts`. All routes require a
verified user (Firebase ID token, HS256 JWT, or the dev header outside production), use CSRF origin checks
on writes, accept JSON only, use strict schemas (unknown fields rejected), and send `Cache-Control: no-store`.
Rate limits per user: 120 req/min overall, 40 writes/min, 8 AI/min, 10 Google calls/min.

## Data model

One document per profile (`BusinessProfile` in `domain/types.ts`): data, status, version, members/memberIds,
review timestamps, last audit, audit summaries (last 30), change log (last 300), pending suggestions (last 20),
listing links with snapshots, publish log (last 50). File store fallback: `<SOCIAL_ACCOUNTS_DATA_DIR>/business-profiles.json`
(written atomically, mode 0600) — for development only.

## Security notes

- Input sanitisation: control and bidi characters and HTML tags are stripped; values render as text.
  URLs must be http(s) with a real hostname (no credentials, no IP literals); media links must be https.
  The server never fetches user-supplied URLs (no SSRF surface); website reachability is therefore not checked.
- Logs: errors go through the existing redacting logger with an error code; profile contents are not logged.
- Tokens: none in responses (asserted in tests).

## Tests

`npm run test:business-profiles` runs:

- `__tests__/audit.test.ts` (17 checks): matching helpers, scoring, priorities, unknown handling, consistency
  vs snapshot, validation/sanitisation, diff, AI grounding flags.
- `__tests__/api.test.ts` (23 checks): auth/CSRF, validation, roles, concurrency, history, AI review flow and
  failure modes, Google connect/link/import/preview/publish against the Google stand-in, tamper/expiry/edit
  invalidation of confirmations, archive/delete permissions, rate limiting.

## Known limitations

- Media are links recorded in the CRM; uploading photos to Google isn’t implemented (Google’s media API
  isn’t wired in `features/gbp`).
- Publishing covers phone, website and description only.
- The failure branch of publish (Google rejects the PATCH) is handled and logged but not exercised by the
  test stand-in, which always accepts.
- In-memory rate limits are per server instance.
- The audit uses heuristics (e.g. keyword stuffing, promotional wording, name keywords); findings are worded
  as things to check, not verdicts.
