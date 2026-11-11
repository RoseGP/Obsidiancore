# Modernization report

What the system-wide audit found, what was consolidated, what was built, how it was tested, and what is still
open. Branch `ccr-3cb69e97-gobm6h`.

## 1. Completed functionality

| Area | Now | Where |
|---|---|---|
| Navigation | One sidebar entry per page. Leads, Contacts and Companies are tabs of **Sales Pipeline & Deals**. The AI receptionist is a tab of **Voice Calls**. New entries: **Tasks**, **Security**, **Privacy & Compliance**. The app opens on the dashboard. | `DynamicSidebar.tsx`, `App.tsx` |
| Dashboard | Copilot, Needs your attention (including tasks due), Business performance, Upcoming meetings, Live activity, Daily missions, Service monitoring, AI insights, Support tickets. No section repeats another. | `DashboardView.tsx` |
| Contacts & companies | One contact record with owner, tags and company. Duplicate check on create. Merge keeps every link and leaves a tombstone. Profile with linked leads, deals, meetings, proposals, invoicing clients and the full communication history. | `src/server/crm/contacts.ts`, `src/features/crm-records/` |
| Tasks | One organization task list linked to lead, contact, deal, conversation or meeting. Views: mine, team, overdue, today, upcoming, done. Reminders. Lead and inbox task endpoints write through to it. | `src/server/crm/tasks.ts`, `/api/tasks` |
| Activity timeline | Inbox notes and tasks on a linked conversation, meeting notes and record changes all reach the record's timeline and the organization feed. | `src/server/crm/timeline.ts` |
| Pipeline | One stage vocabulary for leads, deals and the board. Lost and Unqualified columns. Drag and drop works. No invented values. | `src/lib/pipelineStages.ts`, `DealsPipelineView.tsx` |
| Payments | One stack scoped by organization. The business is never taken from the client. Provider webhooks mark Invoicing invoices paid, with idempotent replays. | `src/services/payment/`, `paymentIntegrations.ts`, `paymentWebhooks.ts` |
| GREET | The new name for video meetings, on LiveKit. Hub (start, schedule, join, upcoming, invitations, history, recordings). Meetings linked to CRM records. Reschedule and cancel. Signed guest invitation links with a waiting room. Host mute, remove and end for everyone. Network quality. Recording only with consent. Outcomes and follow-up tasks. | `docs/greet/README.md` |
| Calendar | One server calendar. Every scheduling form saves GREET meetings on the server. Public booking saves or answers 501. | `CalendarView.tsx`, `availability.ts` |
| Search | Real deals, contacts and navigation, using the sidebar labels. | `UnifiedCommandSearchBar.tsx` |

## 2. Redundancy removed

| Duplicate | Single home now |
|---|---|
| "Contacts & Leads" page and Sales Pipeline | Sales Pipeline & Deals with Leads, Contacts and Companies tabs |
| "AI Voice Receptionist" page and Voice Calls | Voice Calls › AI Receptionist tab |
| Sidebar links into dashboard sections (AI Copilot, Needs Your Attention, Daily Missions, AI Insights) | The dashboard |
| Dashboard "Business Tools" | Sidebar and Quick Action |
| Dashboard "Work Queues" (sales performance, open opportunities, recent leads) | Business performance and Needs your attention. Support tickets is its own section. |
| Unanswered messages shown in both Insights and Attention | Needs your attention |
| Four task stores (lead, organization, inbox, meeting follow-ups) | `organizations/{org}/tasks` (old endpoints write through) |
| Contact records created but never shown, app-level contact list going stale | One contact record, with the app list refreshed on change |
| Three payment and invoice stores, client-chosen business id, bare `/api` mount | One organization-scoped payments stack and Invoicing |
| Lead, deal and board stage names that disagreed | `pipelineStages.ts` |
| Two video stacks (LiveKit and peer-to-peer WebRTC) | LiveKit only (P2P client, old welcome page and fake meeting links deleted) |
| Local-only calendars and schedulers | Server meetings |
| GREET's own audit module | The central audit log |

Deleted because nothing referenced them: `crmActivityLinker.ts`, the D1 in-memory payments copy (`src/payments/*`,
`routes/webhooks.ts`), the work-queue grid and its three widgets, the tools grid, `VideoWelcomePage.tsx`, the P2P
WebRTC client (`utils/app.ts`, `utils/webrtcEvents.ts`), and the tracked token sample files
(`social_tokens_db.json`, `postiz_vault_store.json`).

## 3. Database changes

These changes are all additive. No customer data is deleted.
- **New collections** under `organizations/{org}/`:
  - `contacts` and `companies` (used fully now)
  - `tasks` (unified)
  - `audit_log`
  - `consent`, `privacy_requests`, `retention_policies`, `access_reviews`, `incidents`
  - GREET `scheduled_meetings` fields: associations, invitees, status, actual times, outcome
  - `greet_recordings`
  - `payments/*` (moved from memory)
- **New fields:**
  - `contactId` on invoicing clients and proposals, added next to the embedded data
  - `unifiedTaskId` on legacy tasks
  - `lastActiveAt` and `lastSignInMfa` on members
- **Migrations** (dry run by default, `--apply` to write, safe to re-run):
  - `npx tsx src/scripts/backfillContacts.ts`
  - `npx tsx src/scripts/migrateTasks.ts`
- **Deletion requests** anonymize records and leave a tombstone. Retention rules archive or anonymize, and only
  run automatically when an admin turns that on.

## 4. GREET and LiveKit

See `docs/greet/README.md`.
- **Tokens** are issued by the server only:
  - to a signed-in member, or a guest the host has admitted
  - for one room and one participant, and they expire
  - with `roomAdmin` only for the host, co-hosts and admins
  - rate limited, and audited without the token itself
- **Recording** is off by default. Every participant must consent, and a recording indicator is shown to all of
  them. Cloud recording uses LiveKit Egress to S3-compatible storage only when it is configured; otherwise the
  API returns 501. Access is limited to the host and admins, with 5-minute download links, retention, deletion
  workflow and audit entries.

## 5. Security

Details are in `docs/compliance/SECURITY_CONTROLS.md` and `docs/compliance/ACCESS_CONTROL.md`.
- **Access control:**
  - Every `/api` mount is guarded, and a test enforces it.
  - The tenant always comes from the verified user.
  - Module × permission matrix, plus new SUPPORT_AGENT and GUEST roles.
- **Sign-in:**
  - Two-step sign-in (Firebase TOTP), with an organization option to require it and a session age limit.
  - Monitoring of failed sign-ins, with temporary 429 lockout per address.
- **Other protections:**
  - Security headers, with CSP report-only unless `CSP_ENFORCE=true`.
  - Byte-level upload checks.
  - Audit log with CSV export.
- **Secrets:** a plain-text `JWT_SECRET` was removed from `wrangler.toml`. **Rotate it**, and any token that may have
  been real in the removed JSON samples.

## 6. Compliance readiness

Settings › Privacy & Compliance covers:
- consent records
- data requests (access, export, correction, deletion)
- retention
- access reviews
- incidents
- the audit log

Docs: `docs/compliance/` (GDPR, CCPA/CPRA, SOC 2 mapping, HIPAA applicability, incident response). This is
readiness only: the app is **not** certified for anything, and HIPAA is not claimed. Handling health data would
need BAAs with every provider.

## 7. Testing

- `npm run test:ci`: 36 suites, about 810 checks, all passing.
  - New suites: contacts, tasks, timeline, crm-screens, audit, rbac, compliance, security, greet, payments,
    pipeline, search, availability.
  - They cover cross-tenant and unauthorized attempts.
- `npm run typecheck`: 0 errors. Lint guards pass. Production build passes.
- Browser checks in Playwright, at desktop and phone width with no horizontal scroll and no page errors:
  - the new sidebar
  - the dashboard sections
  - the Contacts, Companies and Tasks pages
  - the GREET hub and guest page
  - the Voice Calls receptionist tab
  - the Privacy & Compliance settings
- **Not tested against live services:**
  - a real LiveKit server or Egress
  - a Firebase project with TOTP enabled
  - real Stripe or Square accounts
  - a production CSP

## 8. Remaining limitations

See CLAUDE.md "Next".
- Marketing engine is still in memory.
- WhatsApp/SMS is a separate inbox from the Unified Inbox, and email/SMS inbox replies are not delivered.
- Several AI routes still call Gemini directly.
- Proposals checkout uses its own Stripe session.
- Booking has one host set by an environment variable.
- The unified dialer doesn't load real leads.
- The voice IVR config and call log are global, not per organization.
- GREET invitations aren't emailed.
- Google Calendar events aren't merged into the calendar.
- Archived records still appear in lists.
- Contact search filters in memory, which is fine at current sizes but needs indexes for very large organizations.

## 9. Deployment

1. Set the environment variables below. They are documented in `.env.example`.
2. Deploy.
3. Run the migrations as a dry run, review the output, then run them again with `--apply`:
   - `src/scripts/backfillContacts.ts`
   - `src/scripts/migrateTasks.ts`
4. In Firebase, enable Identity Platform with TOTP if you want two-step sign-in.
5. In LiveKit, point the webhook at `<APP_URL>/api/greet/livekit-webhook` if you use cloud recording.
6. Rotate `JWT_SECRET`.

## 10. Environment variables

**Existing:**
- `APP_URL`, `JWT_SECRET`, `ENCRYPTION_KEY`, `SOCIAL_ACCOUNTS_ENCRYPTION_KEY`, `GOOGLE_TOKEN_ENCRYPTION_KEY`,
  `EMBED_TOKEN_SECRET`, Firebase credentials
- `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`
- `STRIPE_SECRET_KEY` + `STRIPE_CLIENT_ID`, or `SQUARE_APPLICATION_ID` + `SQUARE_APPLICATION_SECRET`
- `BOOKING_HOST_ORG_ID` + `BOOKING_HOST_USER_ID`

**New:**
- `GREET_INVITE_SECRET`
- `LIVEKIT_EGRESS_ENABLED`, `LIVEKIT_EGRESS_S3_{BUCKET,REGION,ACCESS_KEY,SECRET,ENDPOINT,PREFIX}`
- `TRUST_PROXY`, `CSP_ENFORCE`, `FRAME_ANCESTORS`
- `AUTH_FAILURE_LIMIT`, `AUTH_FAILURE_WINDOW_MINUTES`, `AUTH_LOCKOUT_MINUTES`
- `AUDIT_IP_SALT`
