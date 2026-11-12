# Obsidian CRM

Multi-tenant CRM: an Express + TypeScript API (`server.ts`) serving a React 19 + Vite app (`src/`), with Firestore
storage (firebase-admin), Firebase Functions (`functions/`) and Cloudflare Workers (`src/workers/`). Developer
notes and the architecture map are in [CLAUDE.md](CLAUDE.md); feature docs are in [docs/](docs/).

## Requirements
- Node.js 20 or newer (CI uses 22) and npm. `package-lock.json` is the lockfile.

## Run locally
```bash
npm ci
cp .env.example .env        # fill in what you need; SOCIAL_ACCOUNTS_DEV_AUTH=true enables demo sign-in
npm run dev                 # http://localhost:3000 (API + Vite dev server)
```

## Checks (same as CI)
```bash
npm run typecheck           # must stay at 0 errors
npm run lint                # typecheck + scripts/lint-guards.mjs
npm run test:ci             # all suites; in-memory store, no real services
npm run build               # dist/ (web app) + dist/server.cjs
```

## Deploy
```bash
npm ci && npm run build
NODE_ENV=production PORT=8080 npm start
```
- Set the production secrets listed in `.env.example` / CLAUDE.md (at least `APP_URL`, `JWT_SECRET`,
  `ENCRYPTION_KEY`, `SOCIAL_ACCOUNTS_ENCRYPTION_KEY`, `GOOGLE_TOKEN_ENCRYPTION_KEY`, `EMBED_TOKEN_SECRET`, Firebase
  credentials). The server refuses to start in production when a required one is missing and lists them.
- Behind a load balancer or proxy set `TRUST_PROXY` (e.g. `1`) so rate limits see the client address.
- Health check: `GET /api/health`. The server shuts down gracefully on `SIGTERM` (`SHUTDOWN_TIMEOUT_MS`, default 10 s).
- Static files: `dist/assets/*` are content-hashed and served as immutable; `index.html` is revalidated on every load.
