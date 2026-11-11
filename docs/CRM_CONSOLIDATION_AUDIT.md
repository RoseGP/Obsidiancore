# CRM System Audit & Consolidation Plan

Status: **Phases 1–4 complete — awaiting approval before Phase 5 (structural changes).**
Date: 2026-11-11 · Branch: `claude/crm-audit-consolidation-vjx287`

Only one code change was made alongside this audit: three broken API calls in the
Sales Pipeline were pointed at the endpoints that actually exist (see §6). No files,
modules, collections or records were deleted.

---

## 0. Executive summary

The CRM works as a set of strong individual features, but they do not share data.
The main problems are:

1. **There is no single source of truth for the core entities.** Contact is defined 6 times, Deal 5 times, Task 3 times, Activity 4 times and Invoice/Customer 4+ times. Each copy uses different field names and status values.
2. **Data lives in six kinds of storage.** These are Firestore, Postgres/Prisma, a fake "D1" (in-memory Maps), JSON files, in-memory arrays and localStorage. Leads, messaging, meetings, proposals, payments and IVR call logs **lose data on server restart**, because they either live only in memory or write to Firestore without waiting for the result.
3. **Modules do not talk to each other.** The contact list in the UI always starts empty and is never loaded. Messages, calls, meetings and bookings never reach the lead/contact timeline. Deals, proposals, invoices and payments are not linked.
4. **The same capability is often built several times.** There are about 10 social OAuth flows, 8 schedulers, 8+ publisher sets, 4 invoice backends, 2 payment-provider stacks, 3 inbox UIs, 3 video surfaces, 2 dialers, 5 AI assistants, 3 UI kits and 4+ toast systems.
5. **Navigation is nested.** "Proposals", "Social Planner" and "Local GBP" each embed a complete app with its own sidebar, dashboard, settings and command palette.
6. **Security (P0).** `firestore.rules` gives `allow read, write: if true` on every `crm_*` collection, plus `conversations` and `video_rooms`. Anyone who has the public Firebase config can read and change all CRM data. Separately, `/api/leads` and `/api/dashboard` are mounted without `guard()`, and `tenantContext` lets a client-supplied `x-org-id` override the org from the user's membership.

The rest of this document gives the evidence (§1–2), the target architecture (§3–4), what changed (§6) and the decisions that need approval (§7).

---

## 1. Discovery — current architecture

| Layer | What exists |
|---|---|
| Frontend | React 19 SPA (Vite). `App.tsx` is the shell and router. View state comes from `CommandContext`. |
| Backend | Express (`server.ts`) with 35 routers. A Socket.IO signalling server. A separate Cloudflare Worker (`src/index.ts`) handles email and the voice agent. |
| Persistence | Firestore (admin and client SDK), Postgres/Prisma (`utils/db.ts`, `proposalsDb.ts`, with in-memory fallback), "D1" (`payments/d1Database.ts`, which is really in-memory Maps), JSON files (`data/billing`, `data/gbp.json`, `data/social-accounts`, `src/utils/*.json`), localStorage. |
| Live feature stacks | Leads/Deals (`leadsApi`, `dashboardApi`), Messaging (`messagingPlatform`), Social (`features/social-accounts` + Postiz, `features/social-planner`), Local SEO (`features/gbp` + `components/localpilot`), Invoicing (`features/invoicing` via `/api/billing`), Voice (`/api/voice` + `components/voice`), Video (`greet/VideoMeetingWorkspace`), Calendar (`CalendarView`). |

---

## 2. Redundancy inventory

### 2.1 Core entities: duplicate definitions

| Concept | Definitions found | Field and status conflicts |
|---|---|---|
| **Contact** | Postgres `01_init…sql:39` and a Knex copy · D1 `schema.sql:11` and `03_…sql:15` · Prisma `Client` · TS `CRMContact` (`types.ts:1`) · Firestore `crm_contacts` · `users/{uid}/contacts` (unused) | `company` vs `company_name`. `status` holds a *conversation* state (`active/pending/resolved`), while `lifecycle_status` holds a lifecycle state. There is no `companyId`. |
| **Lead** | `CRMLead` (`types.ts:106`) · local `LeadItem` in `RecentLeadsWidget` and `CRMVoiceDialer` · Postgres and Prisma treat it as a *lifecycle value* on contact | `new…converted` vs `lead/mql/sql…` vs `LEAD` |
| **Deal / Opportunity** | blueprint `CRMDeal` · `crmActivityLinker.CRMDeal` · `OpportunityItem` · `OpportunityData` · `PipelineItem` | `stage` vs `status`. Five different stage lists, for example `discovery…won` vs `new_leads…closed_won` vs `Lead/Contacted/Won`. `value` is stored as a number in some places and a string in others. |
| **Company** | blueprint `CRMCompany` only | Everywhere else it is a plain `company` string. |
| **Task** | `CRMLeadTask` · `crmActivityLinker.CRMTask` · `CalendarEvent.type='task'` | `completed: boolean` vs `status` enum. Collections: `crm_tasks`, `crm_leads/{id}/tasks`, `tasks` (linker). |
| **Activity / timeline** | `crm_leads/{id}/activities` · `crm_activities` (`logCrmActivity`) · linker `timeline: string[]` · messaging `CRM_ACTIVITIES` Map · invoicing `ActivityEntry` | Five timelines, and none of them is shared. |
| **Client / Customer** | invoicing `Client` (JSON file) · `paymentDb` `Customer` · D1 `customers` · Prisma `Client` | Scoped by `business_id`, `user_id` or `workspaceId`. |
| **Invoice** | `/api/proposals/invoices` (memory) · `/api/payments`+`/api/invoices`+`/api` (fake D1) · `/api/integrations/invoices` (memory) · `/api/billing/invoices` (JSON; **the only one the UI uses**) | `lifecycle` vs `status`. Status values differ between implementations. |
| **Proposal** | blueprint `CRMProposal` (`contactId`) · `proposalsDb.Proposal` (`client_name` only) | No link to deal or contact. |

There are **seven different tenant keys**: `orgId`, `ownerId`/`owner`, `uid`/`userId`, `workspaceId`, `crm_account_id`, `business_id` and `owner_id`. Most lead and dashboard queries are not tenant-scoped at all.

### 2.2 Duplicate or overlapping functionality

| Capability | Implementations | Wired today | Dead or unreachable |
|---|---|---|---|
| Social account OAuth | 10 | `features/social-accounts` (`/api/accounts`) | `socialLogin`, `oauthExpressUtility`, `unifiedSocialAuthService`, `functions/src/oauth`. `LinkedInCallbackHandler` calls routes that don't exist. Legacy routers that are mounted but superseded: `socialConnection`, `socialAuth`, `auth.ts /connect`, `postiz /connect`. |
| Post composer | 6 (+ the GBP composer, which is legitimate) | `social-planner/components/Composer` | "Classic tools" `SocialPlannerView`, `social/UnifiedPostComposer`, `PostizIntegrationPanel`, `LinkedInUgcPlayground`, `ScheduledPostsList`, `SocialPostCard` |
| Post scheduling | 8 | Postiz via `postsService` | `posts.ts`, `socialPosts` BullMQ, `backgroundScheduler`, `postSchedulerQueue`, `socialPostEngine`, `socialPostWorker`, the `functions` trigger. Most of their init functions are never called. |
| Publishing adapters | 8–10 sets (about 6 for LinkedIn alone) | Postiz | `services/publisher/*`, `utils/*Publish*`, `linkedinPublisherService`, `facebookPublish`, `mockPlatforms`, `functions/src/publishers` |
| Token storage | 8 | `social-accounts/server/store`, `gbp/server/store` | `socialAuthStore` (writes JSON into `src/`), `postizStore`, `posts.ts social_accounts`, `googleBusinessAuth` |
| Inbox / chat UI | 3 live + 4 dead | `messaging/ProductionMessagingPlatform`, `ExpandableOmnichannelChat` (floating) | `MessagingView` (3,358 lines; imported but never rendered; calls routes that aren't mounted), `CloudflareD1Inbox`, `SendPortalDeveloperDesk`, `SecureHtmlViewer` |
| Chat router | 2 | `chat.ts` | `chatRoutes.ts` (word-for-word copy) |
| AI assistant | 5 UIs, 3 backends | `UnifiedAssistant`→`crmAiAssistant`. Also `chat.ts /brain`→`crmBrain`, and 5 ad-hoc Gemini endpoints in `communication.ts` | — |
| Inbound email | 3 handlers | `src/index.ts` (the entry in `wrangler.jsonc`) | `inbound.js`, `d1InboxWorker`, `imapSyncService`. `wrangler.toml` points to a file that doesn't exist. |
| Outbound email | 5 | `features/invoicing/server/emailTransport` | `mailer.ts`, `secureOutboundMailer` (only reachable from the unmounted `meetingBot`), `outbound.js`. `communication /send-email` **only logs; it doesn't send.** |
| Voice dialer | 2 | `CRMVoiceDialer` + `components/voice/*` | Dialer inside `CRMSoftphoneCanvas` (calls the unmounted `/api/bot/invite`). There are two near-identical copies of `agent.ts`. |
| Voice backend | 2 | `/api/voice` | Twilio and voice routes inside `communication.ts` |
| Video | 3 surfaces + 2 signalling servers | `greet/VideoMeetingWorkspace` + `signalingServer` | `CRMCallCanvas` (its `switch` case is unreachable because of an early return at `App.tsx:435`), `VideoConsultation`, `twilioVideoService`, `VideoPreviewContainer`, `webrtc-call-canvas/` |
| Calendar | 2 | `CalendarView` | `WeeklyCalendar`. `FreeTimeFinder` sits under Analytics. |
| Payment providers | 2 stacks + direct Stripe | **Both** stacks are called by `PaymentProvidersSettings` | `routes/webhooks.ts` (not mounted). `proposals.ts:379` makes direct Stripe calls. |
| Leads UI | 2 | `DealsPipelineView` | `leads/LeadsView` (1,460 lines; imported but never rendered) |
| Lead metrics | 2 | `dashboardApi /stats` and `leadsApi /analytics` | `/stats` returns hard-coded calls, meetings and SLA figures. `/api/dashboard/leads` returns **seed leads** when the collection is empty. |
| Notifications | 2 | `NotificationContext` | App-level `notifications` state, seed data and four handlers. `NotificationDropdown` ignores them. |
| Toasts | 4 providers + about 14 local `showToast` copies | — | `sonner` is a dependency but is never imported. |
| UI kits | 3 | `invoicing/ui/primitives`, `social-planner/ui/kit`, `localpilot/ui/*` | Three versions each of `Button`, `Skeleton` and `EmptyState`; two of `Dialog` and `Segmented`. |
| Dashboards | 4 | Main, Invoicing, LocalPilot, Social overview | Analytics doesn't call `/api/analytics`. `LocationInsightsCacheDashboard` is a mock duplicate of GBP. |
| Settings screens | 4 | Main, Invoicing, LocalPilot, Social | — |
| Command palettes / nav lists | 4 palettes, 3 nav lists | — | Each view alias is defined twice (`CommandContext` and the `App.tsx` switch). There is also a third `ActiveView` union. |

### 2.3 Duplicate API mounts (`server.ts`)

- `/api/posts` is mounted twice. `postsApiRouter` comes first, so the legacy `PATCH /:id` and `DELETE /:id` can never be reached.
- `postsApiRouter` is also mounted at `/api/media`.
- `postizRouter` is mounted 3 times. `socialConnectionRouter` is mounted twice and defines `GET /callback` twice.
- `marketingApi` is mounted at both `/api/marketing` and `/api/v1/marketing`. Its only consumer is a dead component.
- `/api/social-planner` re-mounts all of `socialPostsRouter`.
- `paymentsRouter` is mounted at `/api/payments` and also as a catch-all on `/api`.

### 2.4 Terminology conflicts

| Concept | Terms in use | Proposed standard |
|---|---|---|
| Person not yet qualified | Lead, Prospect, "Enterprise Prospect" | **Lead** |
| Qualified revenue opportunity | Deal, Opportunity, Pipeline item | **Deal** (UI label "Deal"; "Opportunity" only in analytics copy) |
| Person record | Contact, Client, Customer | **Contact** (person), **Company** (organisation). "Client" becomes a role on Company (has invoices). |
| Commercial offer | Proposal, Quote, Estimate | **Proposal** |
| "Billing" | Both the SaaS subscription and customer invoicing | **Subscription** (Settings) and **Invoicing** (module) |
| Nav labels | "CRM Dashboard"/"Dashboard", "Proposals"/"Enterprise Proposals", "Messaging"/"Email & Messaging", … | One label per view, from a single registry |

### 2.5 Disconnected workflows

- **Contacts.** `App.tsx` contacts start as `[]` and only grow through Quick Action. Search, Greet and Proposals therefore receive an empty list. `messagingPlatform.AVAILABLE_CRM_RECORDS = []`, so "Link CRM record" is empty.
- **Activity.** Messaging, SMS/WhatsApp, calls, IVR, meetings and bookings write nothing to the lead or contact timeline.
- **Calendar.** Events live in React state only. `/api/availability/book` returns an appointment without storing it, and `PublicSchedulingPage` never calls availability.
- **Revenue chain.** Deal → Proposal → Invoice → Payment has no foreign keys. Proposals defaults to an embedded copy of the Invoicing app.
- **App.tsx dead state.** `INITIAL_MESSAGES`, `messages`, `handleSendMessage`, `handleUpdateContactStatus`, `notifications` and its handlers are not used by any rendered component.

### 2.6 Dead files (zero importers; verified with grep)

`CloudflareD1Inbox`, `CustomSendingDomainSettings`, `EnterpriseAuthModal`, `LinkedInMobilePreview`, `LinkedInUgcPlayground`, `LockScreen`, `ScheduledPostsList`, `SecureHtmlViewer`, `SendPortalDeveloperDesk`, `SidebarUserProfile`, `SocialPostCard`, `VideoConsultation`, `VideoPreviewContainer`, `WebRTCCallToast`, `WeeklyCalendar`; `routes/chatRoutes`, `socialLogin`, `oauthExpressUtility`, `facebookPublish`, `mockPlatforms`, `webhooks`, `meetingBot` (not mounted); `utils/mailer`, `bffClient`, `imapSyncService`, `jwzThreader`, `InstagramPublishingService`, `ThreadsPublishingService`, `socialMediaPublishingService.js`; `services/unifiedSocialAuthService`, `postSchedulerQueue`; `workers/socialPostWorker`, `d1InboxWorker`; `src/inbound.js`, `src/outbound.js`.

The following are imported but never rendered: `MessagingView`, `leads/LeadsView`, `CRMCallCanvas`.

---

## 3. Consolidation plan — one owner per capability

| Capability | Single owner | Accessed by | Retire after migration |
|---|---|---|---|
| **Contacts / Companies** | New `crm` domain service on Firestore `crm_contacts`, `crm_companies` (`/api/crm/contacts`, `/api/crm/companies`) | Pipeline, Messaging (link record), Greet, Proposals, Invoicing (Client → Company), Search, AI tools | App `INITIAL_CONTACTS`, Prisma `Client`, Postgres/D1 contacts DDL (kept for history; marked deprecated) |
| **Leads** | `leadsApi` (`crm_leads`) | Dashboard widgets, Quick Action, AI | `/api/dashboard/leads` seed fallback, `LeadsView` |
| **Deals** | `crm_deals` + **one** stage enum in `src/domain/crm/stages.ts` | Pipeline, Dashboard, Sales Intel, Proposals | `crmActivityLinker` `deals` collection, local deal types |
| **Tasks** | `crm_tasks` (one shape: `status` + derived `completed`) | Lead/Contact/Deal drawers, Calendar, Messaging "Convert to task" | `crm_leads/{id}/tasks` copy, linker `tasks` |
| **Activity timeline** | `crm_activities` with `entityType` + `entityId` (+ `contactId`, `dealId`) via one `logActivity()` | Every module writes to it; every record drawer reads from it | Per-lead subcollection (backfilled), messaging `CRM_ACTIVITIES`, linker `timeline[]` |
| **Proposals** | `proposals.ts` with `dealId` and `contactId` added | Deal drawer ("Create proposal") | `/api/proposals/invoices` |
| **Invoices & payments** | `features/invoicing` (`/api/billing`) moved from JSON to Firestore; `services/payment/*` as the only provider layer | Proposal ("Convert to invoice"), Company ("Invoices" tab) | `payments.ts` + `src/payments/*`, `/api/integrations/invoices`, direct Stripe in `proposals.ts`, `routes/webhooks.ts` |
| **Messaging** | `messagingPlatform` moved to Firestore; conversations linked to `contactId` | Contact drawer ("Conversations"), floating widget (thin view) | `MessagingView`, `chatRoutes`, dead inbox UIs |
| **Email send** | One `services/email` (generalised `emailTransport`) | Messaging, Invoicing, Calendar invites, post-meeting | `mailer`, `secureOutboundMailer`, `outbound.js`, the fake `/send-email` |
| **Voice** | `/api/voice` + `CRMVoiceDialer` | Contact/Lead "Call" action logs to the timeline | Twilio/voice routes in `communication.ts`, dialer in `CRMSoftphoneCanvas`, duplicate `agent.ts` |
| **Video** | `VideoMeetingWorkspace` + `MeetingSessionContext` + `signalingServer` | Calendar event "Join", contact "Meet" | `CRMCallCanvas`, `VideoConsultation`, `webrtc-call-canvas/` |
| **Calendar & booking** | `CalendarView` backed by Firestore `crm_events` + `gcalSyncService`; `/api/availability` persists bookings | Public scheduling, Greet, Lead/Contact drawer | `WeeklyCalendar`; move `FreeTimeFinder` under Calendar |
| **AI assistant** | `crmAiAssistant` (tool-calling) behind `/api/chat` | Dashboard, Messaging, Pipeline, Dialer (same endpoint with different tool scopes) | `/brain`/`crmBrain`, ad-hoc Gemini endpoints in `communication.ts` |
| **Social** | `features/social-accounts` + `features/social-planner` + Postiz | — | All legacy social routes, workers, publishers and token stores listed in §2.2 |
| **Local SEO** | `features/gbp` + `localpilot` | — | `LocationInsightsCacheDashboard`, `googleBusinessAuth`, `auth.ts /google/*` |
| **Notifications & toasts** | `NotificationContext` (adds `toast()`) | All modules | App-level notification and toast state, per-module toast providers |
| **UI kit** | `src/ui/` (promote `social-planner/ui/kit`, the most complete) | All modules | `invoicing/ui/primitives`, `localpilot/ui` (re-export shims during migration) |
| **Navigation** | One `src/app/viewRegistry.ts` (id, label, icon, aliases, component) | Sidebar, search, `CommandContext`, `App.tsx` | `SEARCH_NAV_ITEMS`, duplicate alias maps, `ActiveView` |
| **Tenancy** | `tenantContext` (membership-derived `orgId`) on every CRM router | All APIs | `ownerId`/`business_id`/`workspaceId` scoping (mapped, not dropped) |

---

## 4. Functionality design — target data model

```
Company 1─* Contact 1─* Conversation (messaging)
   │           │  └─* Activity (call, email, sms, meeting, note, stage_change …)
   │           └─* Task
   │
   └─* Deal ─* Proposal ─* Invoice ─* Payment
         ▲
Lead ──convert──► Contact + Company + Deal   (existing transaction in leadsApi, kept)
CalendarEvent ─(contactId, dealId?)─► Activity on completion
```

- **Shared fields on every CRM record.** `id`, `orgId`, `ownerId`, `createdAt`, `updatedAt`, `createdBy`, `archivedAt?`. Records are archived, never hard-deleted.
- **Activity.** `{ id, orgId, type, entityType, entityId, contactId?, dealId?, companyId?, actor, summary, payload, occurredAt }`, written only through `logActivity()`.
- **Deal stages.** `discovery → qualified → proposal → negotiation → won | lost` (from the blueprint). The pipeline columns keep their UI labels through a single mapper.
- **Lead statuses.** These stay as `new|contacted|qualifying|qualified|unqualified|converted` (already validated server-side).
- **Record drawer component.** One shared `<RecordDrawer entity=…>` with tabs for Overview, Timeline, Tasks, Conversations, Deals, Proposals/Invoices and Files. The Pipeline, Contacts, Messaging and Search all open the same drawer.
- **Global actions.** Call, Email, Message, Meet, Add task and Log note are available from the drawer, Search and Quick Action. They all go through the same handlers and all write to the timeline.

---

## 5. Phased implementation (proposed for Phase 5)

Every step is additive or backwards-compatible. Old endpoints keep working as thin proxies until no callers remain.

| Step | Scope | Risk |
|---|---|---|
| **P0 – Security** | Firestore rules: `crm_*`, `conversations` and `video_rooms` require `isSignedIn()` and an org-membership check. Apply `guard()` to `/api/leads` and `/api/dashboard` (keep `/api/leads/capture` public). Accept `x-org-id` only when the user is a member of that org. | Medium. `RealtimeSyncContext` writes `crm_*` from the browser, so users must be signed in with Firebase Auth. This needs confirming in the deployed auth setup. |
| **P1 – Single source of truth** | `src/domain/crm/` with shared types, stage and status enums and `logActivity()`. Remove the dashboard seed-lead fallback. Make Firestore writes in `leadsApi` awaited, with memory as cache only. Add `/api/crm/contacts`, load contacts into the App, and replace `INITIAL_CONTACTS`. | Low–Medium |
| **P2 – Cross-module wiring** | Messaging, voice, meetings and bookings call `logActivity()`. Messaging links to real contacts. Calendar persists to `crm_events`. Proposals get `dealId`/`contactId`, plus a "Create invoice from proposal" action. | Medium |
| **P3 – Shell & UX** | View registry. Remove nested shells (Invoicing gets its own top-level nav item instead of living inside Proposals). Shared UI kit and toasts. Shared `RecordDrawer`. | Medium (visual) |
| **P4 – Retire duplicates** | Delete the dead files in §2.6. Collapse duplicate mounts behind compatibility aliases. Retire legacy social, payment and invoice stacks once traffic is confirmed to be zero. | Low once P1–P3 have shipped |
| **Data migration** | Backfill `crm_leads/{id}/activities` → `crm_activities`. Map linker `tasks/deals` → `crm_*`. Move invoicing JSON → Firestore. Each script is idempotent and has a dry run, and source collections are left in place. | Low (copy, never move) |

---

## 6. Changes made in this pass

**`src/components/DealsPipelineView.tsx`** now calls the API routes that exist. Before this change these three pipeline actions failed with a 404 on every attempt:

| Action | Before (404) | After |
|---|---|---|
| Drag a lead to another stage | `PUT /api/leads/:id` | `PATCH /api/leads/:id/status` (validated lifecycle) |
| Toggle a task | `PATCH /api/leads/:id/tasks/:taskId` | `PATCH /api/leads/:id/tasks/:taskId/toggle` |
| Bulk status / assign | `POST /api/leads/bulk` | `POST /api/leads/bulk/status`, `POST /api/leads/bulk/assign` (`{ ids, … }`) |
| Bulk delete | `POST /api/leads/bulk` (404) | **Deliberately not wired.** `DELETE /api/leads/:id` is a hard delete. The button now explains that and suggests marking leads "unqualified". It will be re-enabled once archive/soft-delete exists (P1). |

**Verification.** I mounted `leadsApi` in Express and exercised it with supertest on the in-memory path. The old paths return 404. The new paths return 200 or 201 and change the data. `tsc --noEmit` still reports the 70 errors it reported before this change, none of them in the changed file. The existing test suites still pass: messaging, invoicing, local-seo, voice-ivr, security and social-accounts.

---

## 7. Decisions needed before Phase 5

1. **Firestore security (P0).** Do all users authenticate with Firebase Auth in production? If they do, the `crm_*` rules can be locked down safely. If not, browser-side sync needs to move behind the API first.
2. **Primary database.** Should Firestore be the single store for CRM entities? It is the most widely used today. The alternative is Postgres via Prisma.
3. **Invoicing placement.** Should Invoicing be its own top-level nav item, rather than the default tab inside "Proposals"?
4. **Legacy stacks.** Can the legacy social stack (§2.2) and the two unused payment and invoice backends be retired once nothing calls them? Please confirm whether any external system (webhooks, Zapier, mobile app) calls `/api/social*`, `/api/postiz`, `/api/payments`, `/api/integrations` or the `/api` catch-all.
5. **Terminology.** Do you approve the standard terms in §2.4 (Lead / Deal / Contact / Company / Proposal / Invoicing / Subscription)?
