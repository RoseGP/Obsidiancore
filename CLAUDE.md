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
npm run test:payments  # known failing (5) until Phase B, non-blocking in CI
npm run build
cd functions && npm install && npx tsc -p tsconfig.json
npm run key:generate   # MASTER_API_KEY into .env (never printed)
```
Tests are plain `tsx` scripts with node:assert + supertest (React component tests use happy-dom). Add a
`test:<name>` script for new suites and include it in `test:ci`.

## Architecture (where things live)
- **Auth:** `src/features/social-accounts/server/auth.ts` (`identify`, `requireUser`), `src/server/routeGuards.ts` (`guard(PUBLIC.x)` on every `/api` mount).
- **Tenancy:** `src/server/tenancy/` (`requireTenant`, `requirePermission`, roles OWNER…READ_ONLY, invitations). Data path: `organizations/{orgId}/…`.
- **Storage:** `src/server/data/docStore.ts`: `getDocStore()` → Firestore in production, strict in-memory store in tests/dev (`CRM_STORE`). Always `assertId()` request ids.
- **CRM data:** `src/server/crm/crmRepository.ts`; routes `src/routes/leadsApi.ts`, `dashboardApi.ts`, `orgsApi.ts`.
- **AI:** `src/services/ai/aiService.ts` (Gemini + Claude, fallback), prompt `src/services/assistantPrompt.ts`, tools `src/services/crmAiAssistant.ts`, SSE controller `src/controllers/omniRouteChatController.ts`.
- **Google Calendar:** `src/server/integrations/googleTokens.ts` (AES-256-GCM per user), `src/services/gcalSyncService.ts`, `src/routes/gcalWebhook.ts`.
- **Social Planner (Postiz):** `src/features/social-accounts/server/*`, `src/routes/accountsApi.ts`, `src/routes/postsApi.ts`, UI `src/features/social-planner/`.
- **Embeddable calendar:** `public/widget.js`, `src/routes/embedEventsApi.ts`, `src/server/embed/embedKeys.ts`.
- **Meetings UI:** `src/components/greet/MeetingControlBar.tsx`, `meetingControls.ts`, `VideoMeetingWorkspace.tsx`.
- **Meeting plans & sessions (server-enforced):** `src/lib/meetingPlans.ts` (shared rules), `src/server/meetings/` (plans, subscriptions, sessions, stats), routes `src/routes/meetings.ts`, `src/routes/meetingAdminApi.ts`. See `docs/meetings/PLANS.md`. Never hardcode limits: read the org's plan.
- **Docs:** `docs/embed-calendar/`, `docs/api-key-auth/`, `docs/social-accounts/`.

## Rules for this codebase
1. **Nothing simulated.** No fake success, invented numbers, mock connections or sample data shown as real. If something isn't configured or built, say so (503 `*_not_configured` / 501 `not_available`, or a clear UI message). `scripts/lint-guards.mjs` blocks `/simulate` routes, removed legacy mounts and secret-looking literals.
2. **Every route** goes through `guard()`; data access goes through the tenant (`tenantOf(req).orgId`) or the verified user, never ids from the client body.
3. **Secrets** only from env / secret managers. Tokens encrypted at rest. Never log secrets or return them.
4. **Errors:** use `sendError(res, err, tag)`; no `err.message` / stack traces to clients.
5. Keep `npm run typecheck` at 0 and `npm run test:ci` green. Add tests for every behavior change, including cross-tenant and unauthorized attempts.

## Status
Done (see git log): Phase 0 security, Phase 1 organizations, meeting controls, Postiz planner, AI assistant
(Gemini + Claude), embeddable calendar, master API key, Phase A part 1 (per-user Google tokens, legacy purge,
0 type errors, CI).

## Next: Phase A part 2, move remaining stores to Firestore, scoped by organization
Do one store at a time, each with migration tests (cross-tenant reads/writes must fail; data survives a restart):
1. **Invoicing**: `src/features/invoicing/server/store.ts` writes JSON files under `data/billing` (lost on most hosts). Key by organization, not `user_<uid>`; route `src/routes/billing.ts`.
2. **Payments**: `src/services/payment/paymentDb.ts` (in-memory Maps, incl. webhook idempotency). Also `app.use('/api', guard(PUBLIC.payments), paymentsRouter)` in `server.ts` catches all `/api/*` paths: mount it on its own prefix.
3. **Proposals**: `src/utils/proposalsDb.ts` (in-memory, seeded) + `ProposalsView.tsx` localStorage.
4. **Messaging inbox**: `src/routes/messagingPlatform.ts` (in-memory Maps + seeded conversations).
5. **Marketing**: `src/features/marketing/marketingEngine.ts` (in-memory engine).
6. **Meeting bot**: `src/routes/meetingBot.ts` (simulated; persist or remove honestly).

Then: Phase B (Stripe Connect Standard + Square invoicing, webhooks → Paid), C (inbox + lead capture),
D (proposals + booking calendar), E (real multi-person video, provider TBD), F (polish: remove invented
dashboard numbers, mobile nav, LocalPilot simulated actions), G (launch readiness).

## Environment
See `.env.example`. Production needs at least: `APP_URL`, `JWT_SECRET`, `ENCRYPTION_KEY`,
`SOCIAL_ACCOUNTS_ENCRYPTION_KEY`, `GOOGLE_TOKEN_ENCRYPTION_KEY`, `EMBED_TOKEN_SECRET`, Firebase credentials.
After first deploy, copy old shared data into an organization with
`npx tsx src/scripts/migrateLegacyCrmToOrg.ts --owner-uid <uid> --org-name "<name>"` (dry run, then `--apply`).
