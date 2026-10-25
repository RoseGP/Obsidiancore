# Hardening pass: what changed and what's left

## Security
- **Auth on every route** (`src/server/routeGuards.ts`): older routers are mounted behind `guard(PUBLIC.x)`.
  Only OAuth callbacks, provider webhooks, the public booking page and the website widget are public.
  The verified user overwrites any client-supplied `userId`. `/simulate` endpoints are off in production.
- **No bypass tokens**: `admin-jwt-token-2026` / `dev-mock-token` removed from the API gateway, the socket
  handshake and the clients. Sockets now reject unverified connections (previously any or no token passed).
- **Secrets** (`src/utils/secrets.ts`): no secret values in code. Core secrets are required in production
  (`src/server/startupChecks.ts` lists all missing ones); integrations without keys report "not configured".
- **Stripe webhooks** must be signed in production. **SMTP**: no public default TLS key. **PORT** from env.
- **Sandbox personas** only in dev builds or with `VITE_ENABLE_SANDBOX_LOGIN=true`.
- **Billing** accepts Firebase sign-in (per-user workspace; see the TO COMPLETE note for teams).
- **AI chat** never streams invented answers: OmniRoute (if set) → Gemini → explicit error.

## Data
Mock and seed data were removed. Every place that needs a real source is marked `// TO COMPLETE:` in the
code (`grep -rn "TO COMPLETE" src`). Most important: **contacts and calendar events have no backend yet**
(they live in React state in `App.tsx`), and **conversations** are in memory on the server.

## Fixed along the way
- Social Planner reload loop in development (Vite watched `data/`; `vite.config.ts` now ignores it).
- Repeated hash writes in `CommandContext.setActiveView`.
- Requests sent before the signed-in identity was known (set during render in `AuthContext`).
- Crashes on empty data: Voice Dialer, Email, Local SEO reports, Free-time finder, messaging participants.

## Dashboard
One AI assistant (`src/components/assistant/UnifiedAssistant.tsx`) replaces the two chats: streaming,
options (model, length, tone, CRM context), real text-file attachments, settings, read-aloud, copy,
regenerate, stop. Dashboard figures show real counts or "—" with the data source to connect.

## Still to do
- Voice Dialer "Alex" receptionist scenarios are still simulated (development-style demo).
- Public booking page meeting types are hardcoded (`PublicSchedulingPage.tsx` MEETING_TYPES).
- 59 pre-existing TypeScript errors (`npm run lint`), mostly prop mismatches in LocalPilot and mail utils.
- Deeper UI polish beyond the dashboard and assistant.

## Tests
`npm run test:security` (21) plus the feature suites: invoicing 38, social accounts 78, local SEO 27, voice IVR 38.
