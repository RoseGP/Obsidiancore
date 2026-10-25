# Invoicing module

A financial dashboard and invoice workflow, mounted as the default
**Invoicing** view in the Proposals tab (`src/components/ProposalsView.tsx`).

## Layout

```
src/features/invoicing/
  domain/       Pure business logic, shared by browser and server
    money.ts        Decimal-safe money (BigInt minor units)
    calc.ts         Calculation engine (see CALCULATIONS.md)
    status.ts       Dates and derived statuses
    validation.ts   Field validation rules
    operations.ts   State transitions (save, send, pay, void…)
    metrics.ts      Dashboard and report figures
    types.ts        Data models
  services/     API client, prototype store, PDF, email composition
    invoiceDocument.ts  One layout model used by both preview and PDF
    pdf.ts              jsPDF renderer (same mm layout as the preview)
  server/       Server-only: JSON store, SMTP transport
  state/        React store (duplicate-submission guard) and navigation
  ui/           Reusable components
  components/   Feature components (tables, dialogs, preview, editor parts)
  pages/        Screens
  layout/       Sidebar and header
src/routes/billing.ts   REST API at /api/billing
```

## Running

The module works out of the box in **prototype mode**: sample data saved in
the browser, clearly labelled, with email disabled. It switches to the backend
automatically when `/api/billing/session` succeeds.

| Variable | Purpose |
|---|---|
| `BILLING_JWT_SECRET` (or `JWT_SECRET`) | Required for the backend. HS256 secret used to verify session tokens. Without it the API returns 503 and the UI stays in prototype mode. |
| `BILLING_SMTP_HOST`, `_PORT`, `_USER`, `_PASS`, `_SECURE`, `_FROM` | Outbound email (falls back to `SMTP_*`). Without `HOST` and `FROM`, sends are recorded as "not configured". |
| `BILLING_DATA_DIR` | Where the per-business JSON files live (default `data/billing/`). |
| `BILLING_SEED_DEMO=true` | Seed new businesses with sample data. Ignored when `NODE_ENV=production`. |

### Session tokens

The browser sends the token stored in `localStorage` under `billing_jwt_token`
(or `bff_jwt_token`). The payload must include `userId` (or `sub`),
`businessId`, and `role`. Roles: `owner`, `admin`, `accountant`/`finance`
can write; anything else is read-only. Settings changes need owner or admin.

The hard-coded dev tokens used elsewhere in this codebase
(`admin-jwt-token-2026`, `dev-mock-token`) are deliberately **not** accepted.

## Security notes

- Every request is scoped to the token's `businessId`.
- Request bodies are schema-checked (zod), then business rules run in
  `domain/operations.ts`. Totals, lifecycle, delivery history and timestamps
  are always set by the server.
- Saves use optimistic concurrency (`version`); a stale save returns 409.
- `Idempotency-Key` headers make retries of save, send and payment safe.
- The emailed PDF is rendered on the server from the stored invoice.
- SMTP and payment-provider credentials stay on the server.
- Manual payments are confirmed by the authenticated user who records them.
  Card payments should only be confirmed by the provider webhook
  (`src/routes/paymentWebhooks.ts`); nothing in this module assumes success.

## Persistence

`server/store.ts` writes one JSON document per business, atomically, under a
per-business lock. It's fine for a single server instance. For multiple
instances, replace `loadSnapshot` / `withSnapshot` with a database adapter
(the repo already has Postgres and D1 code); routes and UI don't change.

## Not included yet

- Recurring invoices store their schedule, but generating future invoices
  needs a scheduled job (the repo has BullMQ) that copies the template as drafts.
- "Viewed" status needs a tracked client-facing invoice link.
- Wallet and Budgeting are placeholders: there's no expense data to budget against.
- The previous `src/components/proposals/InvoiceBuilder.tsx` and
  `InvoiceDashboard.tsx` are no longer imported and can be deleted.

## Tests

```
npm run test:invoicing
```

23 calculation/status/validation tests and 15 API tests (auth, tenant
isolation, roles, concurrency, idempotency, email-not-configured behaviour).
