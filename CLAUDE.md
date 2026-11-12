# Obsidian CRM: notes for Claude Code

Multi-tenant CRM: Express + TypeScript server (`server.ts`), React 19 + Vite frontend (`src/`), Firestore
(firebase-admin), Firebase Functions (`functions/`), Cloudflare Workers (`src/workers/`, `wrangler.*.toml`).
It is **not** Next.js.

## Commands
```bash
npm ci
npm run dev            # NODE_ENV=development; needs SOCIAL_ACCOUNTS_DEV_AUTH=true in .env for demo sign-in
npm run typecheck      # must stay at 0 errors (CI gate)
npm run lint           # typecheck + scripts/lint-guards.mjs
npm run test:ci        # all suites CI runs (in-memory store; no real services)
npm run build
cd functions && npm install && npx tsc -p tsconfig.json
npm run key:generate   # MASTER_API_KEY into .env (never printed)
```
Tests are plain `tsx` scripts with node:assert + supertest (React component tests use happy-dom). Add a
`test:<name>` script for new suites and include it in `test:ci`.

## Architecture (where things live)
- **HTTP layer:** `src/server/http/` (request id, JSON request log, per-IP API limit, `validateBody(zod)`, `HttpError` helpers, central `errorHandler`, async-error forwarding). Throw `HttpError`s or call `sendError`; both use `toErrorResponse`. See `docs/HTTP_LAYER.md`. Production serving (`production.ts`): hashed `/assets` cached immutable, `index.html` no-cache, missing chunks 404; graceful SIGTERM/SIGINT shutdown (`SHUTDOWN_TIMEOUT_MS`).
- **Auth:** `src/features/social-accounts/server/auth.ts` (`identify`, `requireUser`; Firebase incl. two-step/TOTP), `src/server/routeGuards.ts` (`guard(PUBLIC.x)` on every `/api` mount; a test fails on an unguarded mount). Email sign-in links: `src/server/auth/magicLink.ts` + `src/routes/magicLinkApi.ts` (hashed single-use tokens → Firebase custom token), mailer `src/server/email/mailer.ts`; `docs/auth/MAGIC_LINK.md`.
- **Tenancy & permissions:** `src/server/tenancy/` (`requireTenant`, `requirePermission`, roles OWNER/ADMIN/MANAGER/SALES_REP/MARKETER/SUPPORT_AGENT/READ_ONLY/GUEST, invitations). Granular module × permission matrix with `requireAccess(module, perm)`; org security policy (require two-step, session age). Data path: `organizations/{orgId}/…`.
- **Audit log:** `src/server/audit/auditLog.ts` `recordAudit()` → `organizations/{org}/audit_log` (append-only, no secrets/message bodies); `GET /api/admin/audit-log`. Use it for any security-relevant change.
- **Compliance:** `src/server/compliance/` + `src/routes/complianceApi.ts` (consent, data requests with preview → approve → complete, retention with dry run, access reviews, incidents). Docs `docs/compliance/`.
- **Storage:** `src/server/data/docStore.ts`: `getDocStore()` → Firestore in production, strict in-memory store in tests/dev (`CRM_STORE`). Always `assertId()` request ids.
- **CRM records (one source each):** leads/deals `src/server/crm/crmRepository.ts` (routes `leadsApi.ts`, `dashboardApi.ts`); contacts & companies `src/server/crm/contacts.ts` (`/api/contacts`, `/api/companies`, duplicate check + merge); tasks `src/server/crm/tasks.ts` (`/api/tasks`; lead and inbox task endpoints write through); timeline `src/server/crm/timeline.ts`. Pipeline vocabulary: `src/lib/pipelineStages.ts`. Lead scoring: `src/server/crm/leadIntelligence.ts`.
- **Payments:** one org-scoped stack `src/services/payment/paymentDb.ts` + `src/routes/paymentIntegrations.ts` (`/api/integrations`, aliases `/api/payments`, `/api/invoices`); webhooks `paymentWebhooks.ts` mark Invoicing invoices paid. Invoicing `src/features/invoicing/` (`billing/{orgId}/…`), proposals `src/features/proposals/`.
- **AI:** `src/services/ai/aiService.ts` (Gemini + Claude, fallback), prompt `src/services/assistantPrompt.ts`, tools `src/services/crmAiAssistant.ts`, SSE controller `src/controllers/omniRouteChatController.ts`. CRM agent (RAG, dashboard "Ask your CRM"): `src/server/ai/crmRetrieval.ts` (tenant + role scoped BM25 retrieval, field allowlists), `src/server/ai/crmAgent.ts`, `/api/crm-agent`; `docs/ai/CRM_AGENT.md`.
- **Google Calendar:** `src/server/integrations/googleTokens.ts` (AES-256-GCM per user), clients from `src/server/integrations/googleClients.ts` (`@googleapis/calendar` + `@googleapis/oauth2`; don't add the full `googleapis` bundle back: it pushed `tsc` past Node's default heap), `src/services/gcalSyncService.ts`, `src/routes/gcalWebhook.ts`.
- **Social Planner (Postiz):** `src/features/social-accounts/server/*`, `src/routes/accountsApi.ts`, `src/routes/postsApi.ts`, UI `src/features/social-planner/`.
- **Local SEO (Google Business Profile):** `src/features/gbp/server/*` (OAuth, audit with profile/listing sections, access review, hours), `src/routes/localSeoApi.ts`, UI `src/components/localpilot/`; `docs/local-seo/README.md`. **Website forms → CRM:** `src/server/webforms/` (validation, spam/duplicates, adapters `obsidian` + signed `webhook`, SSRF-safe outbound), `src/routes/webFormsApi.ts` (`/api/web-forms`, public `POST /f/:formId`), lead write `src/server/crm/websiteLeads.ts`, UI `src/features/web-forms/` (its own tab `web_forms`, separate from Local SEO `gbp`); `docs/local-seo/WEB_FORMS.md`.
- **Embeddable calendar:** `public/widget.js`, `src/routes/embedEventsApi.ts`, `src/server/embed/embedKeys.ts`.
- **GREET (video meetings, LiveKit only):** hub `src/components/greet/GreetHub.tsx`, room `VideoMeetingWorkspace.tsx`, guest page `GreetGuestPage.tsx`, client `src/lib/greetClient.ts`; server `src/server/greet/` (scheduled meetings, invitations, recordings) + `src/server/meetings/` (plans, sessions, media tokens); routes `src/routes/meetings.ts`, `greetApi.ts`, `meetingAdminApi.ts`. Calendar reads server meetings. Meeting room (pre-join device check, join via the existing token endpoints, camera/mic/screen with recovery): `src/features/meeting-room/` (view `meeting_room`), optional C++→WASM quality hints in `native/media-analysis/` (`npm run build:wasm`). See `docs/greet/README.md`, `docs/greet/MEETING_ROOM.md` and `docs/meetings/PLANS.md`. Never hardcode limits: read the org's plan.
- **Analytics:** `src/server/crm/analytics/` (pure, explainable: forecast with Beta-smoothed stage win rates and an uncertainty range, pipeline health, RFM segments, fuzzy entity matching for duplicates with complete-linkage grouping (`clusterMatches`, no A≈B≈C chains), deal next actions; loader `load.ts`), `GET /api/reports/*` (`src/routes/reportsApi.ts`), page `src/features/reports/ReportsView.tsx` (Reports & Analytics). Deals record `stageHistory`/`stageEnteredAt`/`closedAt`. See `docs/analytics/README.md`.
- **Pages load lazily:** `App.tsx` imports pages with `lazyPage()` inside `PageBoundary` (`src/components/PageBoundary.tsx`: loading state, crash → error with retry, one reload on a stale chunk). LiveKit loads on the first meeting connect (`src/lib/meetingMedia.ts`). Keep new pages lazy.
- **Theme:** light by default (`DEFAULT_THEME`); every page uses the tokens in `src/styles/obsidian-theme.css` (no dark-first classes); only video surfaces stay dark. `docs/DESIGN_SYSTEM.md`.
- **Navigation:** `src/components/DynamicSidebar.tsx` `NAV_GROUPS` (search uses it too). One entry per page: leads/contacts/companies are tabs of Sales Pipeline (`deals`), the AI receptionist is a tab of Voice Calls, dashboard sections aren't repeated in the sidebar. Settings group has dedicated pages `billing` (Billing & Subscription: plan via `SubscriptionSettings`, invoices summary, link to payment providers; `src/features/billing/`) and `security_access` (Security & Access: `SettingsView page="security_access"`, sign-in, two-step, org rules, roles & permissions); old `settings:security|roles|billing` links open them. Old view ids (`leads`, `voice_receptionist`, …) still route.
- **Docs:** `docs/MODERNIZATION_REPORT.md`, `docs/greet/`, `docs/compliance/`, `docs/embed-calendar/`, `docs/api-key-auth/`, `docs/social-accounts/`.

## Rules for this codebase
1. **Nothing simulated.** No fake success, invented numbers, mock connections or sample data shown as real. If something isn't configured or built, say so (503 `*_not_configured` / 501 `not_available`, or a clear UI message). `scripts/lint-guards.mjs` blocks `/simulate` routes, removed legacy mounts and secret-looking literals.
2. **Every route** goes through `guard()`; data access goes through the tenant (`tenantOf(req).orgId`) or the verified user, never ids from the client body.
3. **Secrets** only from env / secret managers. Tokens encrypted at rest. Never log secrets or return them.
4. **Errors:** use `sendError(res, err, tag)`; no `err.message` / stack traces to clients.
5. Keep `npm run typecheck` at 0 and `npm run test:ci` green. Add tests for every behavior change, including cross-tenant and unauthorized attempts.

## Status
Done (see git log): Phase 0 security, Phase 1 organizations, meeting controls, Postiz planner, AI assistant
(Gemini + Claude), embeddable calendar, master API key, Phase A (all stores org-scoped in the document store:
invoicing, payments, proposals, inbox), Command Center dashboard, Lead Intelligence, modernization
(one contact/task/timeline, one payments stack, one pipeline vocabulary, GREET on LiveKit, audit log, RBAC
matrix, two-step sign-in, privacy & compliance, deduplicated navigation and dashboard). Details and remaining
limitations: `docs/MODERNIZATION_REPORT.md`.

## Next
1. **Marketing**: `src/features/marketing/marketingEngine.ts` is still in memory and has no UI caller: persist or remove.
2. **One inbox**: bring WhatsApp/SMS/voicemail into the Unified Inbox; email/SMS inbox replies are stored but not sent.
3. **AI through `aiService` only**: `communication.ts` (receptionist, voice dialer), `salesIntel`, `crmBrain`, GBP still call Gemini directly; remove unused assistant endpoints.
4. **Proposals checkout** through the payments stack; **booking pages per organization** (today one env-configured host).
5. **Unified dialer** should load real leads (`CRM_LEADS` is empty); global voice IVR config/call log should be per org.
6. Invitation emails for GREET; Google Calendar events in the calendar; archived records filtered from lists.

## Environment
See `.env.example`. Production needs at least: `APP_URL`, `JWT_SECRET`, `ENCRYPTION_KEY`,
`SOCIAL_ACCOUNTS_ENCRYPTION_KEY`, `GOOGLE_TOKEN_ENCRYPTION_KEY`, `EMBED_TOKEN_SECRET`, Firebase credentials;
for GREET `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `GREET_INVITE_SECRET`; `AUDIT_IP_SALT`, `TRUST_PROXY`.
Data moves for existing records (dry run by default, `--apply` to write): `src/scripts/backfillContacts.ts`,
`src/scripts/migrateTasks.ts`.
After first deploy, copy old shared data into an organization with
`npx tsx src/scripts/migrateLegacyCrmToOrg.ts --owner-uid <uid> --org-name "<name>"` (dry run, then `--apply`).
