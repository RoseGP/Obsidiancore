# Proposals & Invoicing End-to-End Audit Report

**Date:** 2026-10-23  
**Target Subsystems:** Proposals Hub, Invoicing Engine, Payment Providers (Stripe & Square), Billing Backend, Database Layer, Route Guards & Webhooks  
**Reviewed Sources:**
- `src/components/ProposalsView.tsx` and child components (`InvoicingApp`, `PaymentProvidersSettings`, `BrandLogoCustomizerModal`, `VerticalTimeline`)
- `src/routes/proposals.ts`
- `src/utils/proposalsDb.ts`
- `src/routes/payments.ts`
- `src/routes/paymentIntegrations.ts`
- `src/routes/webhooks.ts`
- `src/routes/paymentWebhooks.ts`
- `src/services/payment/` (`encryption.ts`, `paymentDb.ts`, `providerFactory.ts`, `squareProvider.ts`, `stripeProvider.ts`, `types.ts`)
- `src/features/invoicing/` (`InvoicingApp.tsx`, `apiRepository.ts`, `localRepository.ts`, `repository.ts`, `store.ts`, `emailTransport.ts`, `pages/`, `components/`)
- `src/routes/billing.ts`
- `src/server/routeGuards.ts` (`PUBLIC.proposals`, `PUBLIC.payments`, `PUBLIC.paymentIntegrations`)
- `migrations/` (`0001_payment_integrations.sql`)

---

## 1. UI Inventory: Sub-Tabs, Buttons, Forms, Actions & API Calls

The Proposals view (`src/components/ProposalsView.tsx`) contains three primary modes toggled in the top bar (`proposalsTabMode`): **Invoicing**, **Payment Providers**, and **SOW Proposals Hub**.

```
Proposals View
├── Top Bar Controls
│   ├── Tab: Invoicing (proposalsTabMode = 'invoicing')
│   ├── Tab: Payment Providers (proposalsTabMode = 'payment_providers')
│   ├── Tab: SOW Proposals Hub (proposalsTabMode = 'proposals_hub')
│   └── Header Button: "+ Add Logo" / "Brand Logo" (BrandLogoCustomizerModal)
│
├── Mode A: Invoicing Engine (InvoicingApp)
│   ├── Repository Connection: GET /api/billing/session -> fallback to localRepository
│   ├── Dashboard Page: GET /api/billing/snapshot
│   │   ├── Range Control: 6M / 12M / YTD (client-side recalculation)
│   │   └── Quick Actions: Create Invoice, Add Client, Record Payment, View Reports
│   ├── Invoices Page:
│   │   ├── Status Filter Tabs: All, Draft, Sent, Viewed, Partially Paid, Overdue, Paid, Void
│   │   ├── Export CSV Button: Client-side CSV generation (no API call)
│   │   ├── Bulk PDF Download: Client-side jsPDF generation (no API call)
│   │   ├── Bulk Void: Multiple calls to POST /api/billing/invoices/:id/void
│   │   └── Row Actions: View, Edit, Duplicate, Void, Mark as Sent, Record Payment, Download PDF
│   ├── Invoice Editor Page:
│   │   ├── Save Invoice Button: PUT /api/billing/invoices/:id (with Idempotency-Key)
│   │   └── Send Invoice Button: Opens SendDialog
│   ├── Invoice View Page:
│   │   ├── Send / Resend Button: Opens SendDialog
│   │   ├── Record Payment Button: Opens PaymentDialog
│   │   ├── Mark as Sent Button: POST /api/billing/invoices/:id/mark-sent
│   │   ├── Void Invoice Button: POST /api/billing/invoices/:id/void
│   │   └── Download PDF Button: Client-side jsPDF download (no API call)
│   ├── SendDialog:
│   │   └── Send Invoice Button: POST /api/billing/invoices/:id/send (Nodemailer SMTP + server PDF)
│   ├── PaymentDialog:
│   │   └── Record Payment Button: POST /api/billing/invoices/:id/payments (manual payment)
│   ├── Clients Page:
│   │   ├── Add / Edit Client Dialog: PUT /api/billing/clients/:id
│   │   └── Archive / Restore Action: POST /api/billing/clients/:id/archive
│   ├── Settings Page:
│   │   ├── Save Settings Button: PUT /api/billing/settings
│   │   └── Reset Prototype Data Button: Client-side local prototype reset
│   ├── Transactions Page:
│   │   ├── Filter & Search: Client-side over snapshot payments
│   │   └── Download Receipt PDF: Client-side jsPDF receipt generation
│   ├── Wallet Page:
│   │   ├── Payment Instructions Edit: Navigates to Settings
│   │   └── "Manage Payment Providers" Button: Switches tab mode to 'payment_providers'
│   └── Reports Page:
│       └── Aging, Collection Rate, Revenue by Client: Computed client-side from snapshot
│
├── Mode B: Payment Providers (PaymentProvidersSettings)
│   ├── On Mount / Sync Status:
│   │   ├── GET /api/payments/status
│   │   └── GET /api/integrations/status?userId=usr_101
│   ├── Header "Create Invoice" Button: Switches tab mode to 'invoicing'
│   ├── Stripe Card:
│   │   ├── "Connect Stripe" Button: GET /api/payments/stripe/connect?format=json (or fallback GET /api/integrations/stripe/connect?format=json&userId=usr_101)
│   │   ├── "Disconnect" Button: POST /api/payments/stripe/disconnect and POST /api/integrations/stripe/disconnect (body: { userId: 'usr_101' })
│   │   └── "Copy Webhook URL" Button: Copies `/api/webhooks/stripe` to clipboard (no API call)
│   ├── Square Card:
│   │   ├── "Connect Square" Button: GET /api/integrations/square/connect?format=json&userId=usr_101
│   │   ├── "Disconnect" Button: POST /api/integrations/square/disconnect (body: { userId: 'usr_101' })
│   │   └── "Copy Webhook URL" Button: Copies `/api/webhooks/square` to clipboard (no API call)
│   └── Webhooks Setup Card:
│       └── Copy Stripe / Square Webhook URLs to clipboard
│
└── Mode C: SOW Proposals Hub (ProposalsView)
    ├── Hero Section Actions:
    │   ├── "Change Logo" / "Add Logo": Opens BrandLogoCustomizerModal
    │   ├── "Reset" Button: Resets contact, pricing tier, and delivery speed state in React (no API call)
    │   └── "Compile Draft" Button: Runs client-side `setInterval` animation stepping through 6 dummy strings; shows success toast (no API call)
    ├── Account Lead Selection Card:
    │   ├── Contact List: Sarah Jenkins ('1'), Marcus Chen ('2'), Elena Rostova ('3')
    │   │   └── On Select: Calls `GET /api/proposals/PROP-0${contactId}94`
    │   ├── Industry Sector Dropdown: Updates React state (no API call)
    │   └── Sovereign DB Dropdown: Updates React state (no API call)
    ├── Sub-Document Navigation Switcher:
    │   ├── Sub-tab: "SOW Agreement"
    │   │   ├── Discovery Findings Textarea: Debounced (350ms) save to `localStorage` key `proposal_profile_${contactId}` (no API call)
    │   │   ├── Strategic Solution Blueprint Textarea: Debounced save to `localStorage` (no API call)
    │   │   ├── Interactive Security Checklist Chips: Toggles array in React state (no API call)
    │   │   ├── Milestone Phases Display: Pure React rendering (no API call)
    │   │   ├── Timeline Phase Sign-Off Buttons: Toggles phase completed status in React state (no API call)
    │   │   └── Phase-Based Invoice Allocation Table: Computed client-side from fee multipliers (no API call)
    │   ├── Sub-tab: "CEO Cover Mail"
    │   │   ├── Tone Switcher: Warm / Formal / Priority (updates React state; no API call)
    │   │   └── Cover Letter Display: Pure React template rendering (no API call)
    │   ├── Sub-tab: "MSA Contract"
    │   │   └── Legal Covenant Text: Scrollable covenant container (no API call)
    │   └── Document Action Buttons:
    │       ├── "Copy" Button: Copies formatted proposal text to clipboard (no API call)
    │       ├── "MD Download" Button: Downloads client-side Blob as `.txt` (no API call)
    │       └── "PDF" Button: Opens `window.open('/api/proposals/PROP-0${selectedContactId}94/render-pdf', '_blank')` -> `GET /api/proposals/:id/render-pdf`
    ├── Investment Breakdown Card:
    │   ├── Optional Add-on Deliverables Checkboxes: Updates React state `selectedAddonIds` (orphaned from `handleToggleOptionalItemLink` which called `PATCH /api/proposals/:id/items/:itemId`)
    │   ├── SLA Margin Tier Buttons: Updates pricing multiplier in React state (no API call)
    │   ├── Deployment Pace Buttons: Updates delivery multiplier in React state (no API call)
    │   └── "PAY DEPOSIT VIA STRIPE" Button: Calls `POST /api/proposals/PROP-0${selectedContactId}94/stripe-checkout`
    ├── Acceptance & Signature Card:
    │   ├── E-Signature Canvas: HTML5 mouse/touch drawing; Clear Pad button (client-side canvas)
    │   ├── "Authorized Name" Input: Controlled React state
    │   ├── "Corporate Title" Input: Controlled React state
    │   └── "SUBMIT SIGNED PROPOSAL" Button: Calls `POST /api/proposals/PROP-0${selectedContactId}94/sign`
    └── BrandLogoCustomizerModal:
        ├── Presets (Ace Minimalist, Obsidian Tech, Sovereign Crest, Horizon SaaS, Quantum Studio)
        ├── File Upload: Local `FileReader` to base64 Data URL (no API call)
        ├── Direct URL Input: Updates React state
        └── "Save & Apply": Saves to browser `localStorage` keys `invoice_custom_business_logo` and `invoice_custom_business_name` (no API call)
```

---

## 2. Comprehensive Endpoint Inventory

The following table lists every endpoint across all inspected proposal and payment route files:

| Router File | HTTP Method | Route Path | Mount Path | Effective URL | Auth Requirement | Reads / Writes |
|---|---|---|---|---|---|---|
| `proposals.ts` | `GET` | `/invoices` | `/api/proposals` | `/api/proposals/invoices` | **Public** (matches `/^\/[A-Za-z0-9_-]+$/` in `PUBLIC.proposals`) | Reads in-memory `INVOICES_STORE` Map |
| `proposals.ts` | `GET` | `/invoices/:id` | `/api/proposals` | `/api/proposals/invoices/:id` | Signed-in (`requireUser`) | Reads in-memory `INVOICES_STORE` Map |
| `proposals.ts` | `POST` | `/invoices` | `/api/proposals` | `/api/proposals/invoices` | **Public** (matches `/^\/[A-Za-z0-9_-]+$/` in `PUBLIC.proposals`) | Writes in-memory `INVOICES_STORE` & attempts Firestore `invoices` |
| `proposals.ts` | `POST` | `/invoices/:id/send` | `/api/proposals` | `/api/proposals/invoices/:id/send` | Signed-in (`requireUser`) | Updates in-memory `INVOICES_STORE` & attempts Firestore `invoices` |
| `proposals.ts` | `GET` | `/:id` | `/api/proposals` | `/api/proposals/:id` | **Public** (matches `/^\/[A-Za-z0-9_-]+$/`) | Reads Postgres `proposals` & `proposal_items` (fallback: `mockProposals`) |
| `proposals.ts` | `PATCH` | `/:id/items/:itemId` | `/api/proposals` | `/api/proposals/:id/items/:itemId` | Signed-in (`requireUser`) | Updates `is_selected` in Postgres `proposal_items` (fallback: `mockProposalItems`) |
| `proposals.ts` | `POST` | `/:id/sign` | `/api/proposals` | `/api/proposals/:id/sign` | **Public** (matches `/^\/[A-Za-z0-9_-]+\/sign$/`) | Updates Postgres `proposals` (status='accepted', signed_at, signature_name); writes Firestore `proposal_signatures` |
| `proposals.ts` | `POST` | `/:id/stripe-checkout` | `/api/proposals` | `/api/proposals/:id/stripe-checkout` | **Public** (matches `/^\/[A-Za-z0-9_-]+\/stripe-checkout$/`) | Reads proposal details; creates Stripe Checkout Session (or returns mock test URL) |
| `proposals.ts` | `GET` | `/:id/render-pdf` | `/api/proposals` | `/api/proposals/:id/render-pdf` | **Public** (matches `/^\/[A-Za-z0-9_-]+\/render-pdf$/`) | Reads proposal details; renders raw HTML string with `Content-Type: text/html` |
| `payments.ts` | `GET` | `/status` | `/api/payments` & `/api` | `/api/payments/status` & `/api/status` | Signed-in (`requireUser`) | Reads D1 in-memory `paymentAccounts` via `d1Db.getPaymentAccount` |
| `payments.ts` | `GET` | `/stripe/connect` | `/api/payments` & `/api` | `/api/payments/stripe/connect` | Signed-in (`requireUser`) | Reads D1 `businesses`; calls `stripePaymentProvider.createConnectAccount` |
| `payments.ts` | `GET` | `/stripe/callback` | `/api/payments` & `/api` | `/api/payments/stripe/callback` | **Public** (matches `/^\/stripe\/callback$/` in `PUBLIC.payments`) | Writes D1 in-memory `paymentAccounts` (`status = 'active'`) |
| `payments.ts` | `POST` | `/stripe/disconnect` | `/api/payments` & `/api` | `/api/payments/stripe/disconnect` | Signed-in (`requireUser`) | Deletes from D1 in-memory `paymentAccounts` |
| `payments.ts` | `POST` | `/invoices/:invoiceId/payment` | `/api/payments` & `/api` | `/api/payments/invoices/:invoiceId/payment` & `/api/:invoiceId/payment` | Signed-in (`requireUser`) | Reads D1 invoice & customer; creates Stripe hosted invoice; updates D1 invoice with `payment_url` |
| `payments.ts` | `GET` | `/invoices` | `/api/payments` & `/api` | `/api/payments/invoices` & `/api/invoices` | Signed-in (`requireUser`) | Reads all invoices from D1 in-memory `invoices` for businessId |
| `payments.ts` | `GET` | `/invoices/:invoiceId` | `/api/payments` & `/api` | `/api/payments/invoices/:invoiceId` & `/api/:invoiceId` | Signed-in (`requireUser`) | Reads single invoice from D1 in-memory `invoices` |
| `paymentIntegrations.ts` | `GET` | `/status` | `/api/integrations` | `/api/integrations/status` | Signed-in (`requireUser`) | Reads in-memory `CONNECTED_ACCOUNTS_MAP` for user |
| `paymentIntegrations.ts` | `GET` | `/stripe/connect` | `/api/integrations` | `/api/integrations/stripe/connect` | Signed-in (`requireUser`) | Generates signed CSRF OAuth state; returns Stripe OAuth URL |
| `paymentIntegrations.ts` | `GET` | `/stripe/callback` | `/api/integrations` | `/api/integrations/stripe/callback` | **Public** (matches `/^\/(stripe\|square)\/callback$/`) | Validates state; exchanges code for access token; writes encrypted token to `CONNECTED_ACCOUNTS_MAP` |
| `paymentIntegrations.ts` | `POST` | `/stripe/disconnect` | `/api/integrations` | `/api/integrations/stripe/disconnect` | Signed-in (`requireUser`) | Deletes Stripe account from `CONNECTED_ACCOUNTS_MAP` |
| `paymentIntegrations.ts` | `GET` | `/square/connect` | `/api/integrations` | `/api/integrations/square/connect` | Signed-in (`requireUser`) | Generates signed CSRF OAuth state; returns Square OAuth URL |
| `paymentIntegrations.ts` | `GET` | `/square/callback` | `/api/integrations` | `/api/integrations/square/callback` | **Public** (matches `/^\/(stripe\|square)\/callback$/`) | Validates state; exchanges code for access token; writes encrypted token to `CONNECTED_ACCOUNTS_MAP` |
| `paymentIntegrations.ts` | `POST` | `/square/disconnect` | `/api/integrations` | `/api/integrations/square/disconnect` | Signed-in (`requireUser`) | Deletes Square account from `CONNECTED_ACCOUNTS_MAP` |
| `paymentIntegrations.ts` | `POST` | `/invoices/create` | `/api/integrations` | `/api/integrations/invoices/create` | Signed-in (`requireUser`) | Calls provider adapter; writes to in-memory `INVOICES_MAP` |
| `paymentIntegrations.ts` | `POST` | `/invoices/:id/send` | `/api/integrations` | `/api/integrations/invoices/:id/send` | Signed-in (`requireUser`) | Calls provider adapter; updates status in in-memory `INVOICES_MAP` |
| `paymentIntegrations.ts` | `GET` | `/invoices` | `/api/integrations` | `/api/integrations/invoices` | Signed-in (`requireUser`) | Reads list from in-memory `INVOICES_MAP` |
| `paymentIntegrations.ts` | `POST` | `/invoices/:id/void` | `/api/integrations` | `/api/integrations/invoices/:id/void` | Signed-in (`requireUser`) | Calls provider adapter; updates status to 'void' in `INVOICES_MAP` |
| `webhooks.ts` | `POST` | `/stripe` | `/api/webhooks` | `/api/webhooks/stripe` | **Public** (unauthenticated webhook) | Validates Stripe signature; checks D1 `webhook_events`; updates D1 `invoices` payment status |
| `paymentWebhooks.ts` | `POST` | `/stripe` | `/api/webhooks` | `/api/webhooks/stripe` (conflicts with `webhooks.ts`) | **Public** (unauthenticated webhook) | Validates Stripe signature; checks `paymentDb` idempotency; updates `paymentDb` invoice status |
| `paymentWebhooks.ts` | `POST` | `/square` | `/api/webhooks` | `/api/webhooks/square` | **Public** (unauthenticated webhook) | Validates Square HMAC-SHA256 signature; checks `paymentDb` idempotency; updates `paymentDb` invoice status |
| `billing.ts` | `GET` | `/session` | `/api/billing` | `/api/billing/session` | Signed-in (`requireAuth`: JWT or Firebase identity) | Returns `{ user, emailConfigured }` |
| `billing.ts` | `GET` | `/snapshot` | `/api/billing` | `/api/billing/snapshot` | Signed-in (`requireAuth`) | Reads JSON snapshot file (`data/billing/${businessId}.json`) |
| `billing.ts` | `PUT` | `/invoices/:id` | `/api/billing` | `/api/billing/invoices/:id` | Signed-in (`requireAuth`) | Recomputes totals server-side; writes JSON snapshot file |
| `billing.ts` | `POST` | `/invoices/:id/void` | `/api/billing` | `/api/billing/invoices/:id/void` | Signed-in (`requireAuth`) | Updates invoice lifecycle to 'void' in JSON snapshot file |
| `billing.ts` | `POST` | `/invoices/:id/mark-sent` | `/api/billing` | `/api/billing/invoices/:id/mark-sent` | Signed-in (`requireAuth`) | Updates invoice lifecycle to 'sent' in JSON snapshot file |
| `billing.ts` | `POST` | `/invoices/:id/send` | `/api/billing` | `/api/billing/invoices/:id/send` | Signed-in (`requireAuth`) | Authoritatively renders PDF; dispatches via Nodemailer SMTP; logs delivery attempt in JSON snapshot file |
| `billing.ts` | `POST` | `/invoices/:id/payments` | `/api/billing` | `/api/billing/invoices/:id/payments` | Signed-in (`requireAuth`) | Records manual payment; recalculates invoice balance; writes JSON snapshot file |
| `billing.ts` | `PUT` | `/clients/:id` | `/api/billing` | `/api/billing/clients/:id` | Signed-in (`requireAuth`) | Validates and writes client record to JSON snapshot file |
| `billing.ts` | `POST` | `/clients/:id/archive` | `/api/billing` | `/api/billing/clients/:id/archive` | Signed-in (`requireAuth`) | Toggles client `archived` in JSON snapshot file |
| `billing.ts` | `PUT` | `/settings` | `/api/billing` | `/api/billing/settings` | Signed-in (`requireAuth`: owner or admin only) | Writes business settings to JSON snapshot file |

---

## 3. Data Storage & Persistence Audit

| Data Entity | Primary Store | Backup / Fallback Store | Survives Process Restart? | Issues Identified |
|---|---|---|---|---|
| SOW Proposals (`proposals`) | Postgres `proposals` table | `mockProposals` In-Memory Map | **Conditional**: Survives only if `DATABASE_URL` is configured. If unconfigured or points to mock, lost on restart. | Tables created via inline `CREATE TABLE IF NOT EXISTS` in `proposalsDb.ts` instead of versioned migrations. |
| SOW Line Items (`proposal_items`) | Postgres `proposal_items` table | `mockProposalItems` In-Memory Map | **Conditional**: Same as proposals above. | No migration file in `migrations/`. Prices cast in-line to DOUBLE PRECISION. |
| Proposal Signatures & Audit | Firestore `proposal_signatures` | None (in-memory only) | **Yes** if Firestore connected; lost if network error. | Does not write to a dedicated Postgres audit log table. |
| Legacy Proposals Invoices | `INVOICES_STORE` in `proposals.ts` | Best-effort Firestore `invoices` | **NO**: Stored in a process-level JavaScript `Map<string, any>()`. | Seeded with static 'Amelia Morgan' sample data. |
| Payment Integration Accounts | `CONNECTED_ACCOUNTS_MAP` in `paymentDb.ts` | None | **NO**: In-Memory Map. | Lost on restart. Pre-seeded with `usr_101`. |
| Payment Integration Customers | `CUSTOMERS_MAP` in `paymentDb.ts` | None | **NO**: In-Memory Map. | Lost on restart. Pre-seeded with `cust_kappy_001`. |
| Payment Integration Invoices | `INVOICES_MAP` in `paymentDb.ts` | None | **NO**: In-Memory Map. | Lost on restart. Pre-seeded with demo invoice. |
| D1 Businesses & Accounts | `InMemoryD1Store` in `d1Database.ts` | None | **NO**: In-Memory Map. | Pre-seeded with `biz_default_101`. `migrations/0001_payment_integrations.sql` exists but D1 store executes in RAM. |
| D1 Invoices & Line Items | `InMemoryD1Store` in `d1Database.ts` | None | **NO**: In-Memory Map. | Lost on restart. Pre-seeded with `INV-000001`. |
| Webhook Idempotency Events | `PROCESSED_WEBHOOK_EVENTS` in `paymentDb.ts` & `d1Database.ts` | None | **NO**: In-Memory `Set<string>`. | Webhook replay attacks or duplicate deliveries will reprocess after server restarts! |
| Invoicing Engine Billing Snapshot | Atomic JSON files: `data/billing/${businessId}.json` | `localStorage` (`inv:state`) when unconfigured | **YES**: Stored as persistent JSON on server disk (via atomic `.tmp` rename). | File-based rather than relational Postgres; does not support multi-tenant SQL joins with CRM contacts. |
| Invoicing Idempotency Cache | `idem` In-Memory Map in `billing.ts` | None | **NO**: In-Memory Map (24h eviction). | Replay cache lost on process restart. |
| Custom Branding & Logo | Browser `localStorage` (`invoice_custom_business_logo`) | None | **NO** (client-only): Bound to a single browser. Does not sync across devices or team members. | Zero server persistence. |
| Draft Bottlenecks & SOW Inputs | Browser `localStorage` (`proposal_profile_${contactId}`) | None | **NO** (client-only): Stored in browser. | Changes not synced to server until explicit sign submission. |

---

## 4. Architectural Gaps & Vulnerabilities

### A. UI Actions with No Backend
1. **"Compile Draft" Simulation**: In `ProposalsView.tsx` (`handleCompileProposalBtn`), clicking "Compile Draft" triggers a 2.4-second client-side `setInterval` cycle stepping through 6 static strings and immediately announces success. It makes no API call, executes no server-side LLM inference, and does not assemble real CRM telemetry.
2. **Timeline Phase Checkpoints**: The phase sign-off buttons in `ProposalsView.tsx` update a React state array (`completedPhases`). They do not persist quality sign-offs to a database or trigger audit logs.
3. **Interactive Security Checklist Chips**: Toggling GDPR, SOC 2, HIPAA, or ISO 27001 updates local React state and adjusts client-side math multipliers; no database record is updated.
4. **Brand Customization**: `BrandLogoCustomizerModal.tsx` stores logos and business names exclusively in `localStorage`. There is no backend endpoint to store or retrieve tenant branding.
5. **Orphaned Optional Items Sync**: `ProposalsView.tsx` defines `handleToggleOptionalItemLink` which calls `PATCH /api/proposals/:id/items/:itemId`. However, in the right column (`id="pricing-calculator-widget"`), clicking optional add-on cards only modifies local state `selectedAddonIds` without invoking the API!

### B. Endpoints with No UI
1. **`GET /api/proposals/invoices` & `POST /api/proposals/invoices`**: Replaced visually by the `InvoicingApp` module; these endpoints read and write to an abandoned `INVOICES_STORE` Map.
2. **`POST /api/integrations/invoices/create` & `/send` & `/void`**: `paymentIntegrations.ts` implements an entire adapter-driven invoicing layer that operates against in-memory `paymentDb.ts`. The actual UI (`InvoicingApp`) uses `src/routes/billing.ts` instead, leaving these endpoints orphaned.
3. **Competing Webhook Listeners**: `server.ts` mounts `webhooksRouter` at `/api/webhooks` AND `paymentWebhooksRouter` at `/api/webhooks`. Both define `POST /stripe`. Express executes the first match (`webhooks.ts`), so the Stripe handler in `paymentWebhooks.ts` is permanently shadowed!
4. **Catch-All Mount Collision**: `server.ts` mounts `paymentsRouter` at bare `/api` (`app.use('/api', guard(PUBLIC.payments), paymentsRouter)`). This creates overlapping route patterns such as `GET /api/:invoiceId` which risk intercepting other routes if mounted incorrectly.

### C. Public Endpoints Exposing Data & Permitting Unauthenticated Writes
1. **Public Path Regex Hole**: In `src/server/routeGuards.ts`, `PUBLIC.proposals` includes `/^\/[A-Za-z0-9_-]+$/`. This was intended for customer proposal view links (`/:id`), but it also matches `/invoices`! Consequently, `GET /api/proposals/invoices` and `POST /api/proposals/invoices` bypass authentication completely.
2. **Unauthenticated Contract Signing**: `POST /api/proposals/:id/sign` is public (`/^\/[A-Za-z0-9_-]+\/sign$/`). Anyone who enumerates or guesses a proposal ID (e.g. `PROP-0194`) can submit arbitrary signature names, titles, and fake emails to legally seal a contract without demonstrating possession of a signed share token or email invite.
3. **Unauthenticated PDF & Proposal Snooping**: `GET /api/proposals/:id` and `GET /api/proposals/:id/render-pdf` are public without token validation. Competitors or unauthorized parties can inspect enterprise SOW deliverables, budgets, client identities, and pricing tiers simply by guessing reference IDs.
4. **Unauthenticated Stripe Checkout Trigger**: `POST /api/proposals/:id/stripe-checkout` is public. Anyone can trigger arbitrary checkout sessions with custom amounts against any proposal ID.

### D. Hardcoded Sample Data & Placeholders
1. **`proposals.ts` Line 82**: Hardcoded `signatoryName: 'Amelia Morgan'`, `title: 'Managing Partner, Ace Studio'`, `email: 'Pay@Kappybara.ai'`, and Tron USDT wallet address `TY7MsheARe4bQSd6sEk14Q3PZ3PFj4Vbcs`.
2. **`paymentDb.ts` Lines 30–60**: Hardcoded user `usr_101` (`rpierrette45@gmail.com`) and default customer `cust_kappy_001` (`Kappy Bara AI`).
3. **`d1Database.ts` Lines 45–97**: Hardcoded business `biz_default_101` (`Ace Studio Enterprise`) and customer `cust_kappy_001`.
4. **`ProposalsView.tsx` Lines 41–66**: Hardcoded `DEFAULT_PROFILES` for contacts 1, 2, and 3 with static Discovery findings and SOW blueprints.
5. **`ProposalsView.tsx` Lines 635, 640, 645**: Hardcoded cover letter sender: `Rene Pierrette, CEO, Obsidian Enterprise Solutions`.
6. **`paymentIntegrations.ts` & `payments.ts`**: Fallback to hardcoded query parameter `userId=usr_101` and `businessId=biz_default_101`.

### E. False Success Reported Without Server Confirmation
1. **Contract Signing Offline Fallback**: In `ProposalsView.tsx` (`handleSignProposalSubmit`, lines 424–431), if `POST /api/proposals/:id/sign` throws an HTTP 500 error or network failure, the `catch` block unconditionally executes:
   ```ts
   setIsMsaSigned(true);
   setMsaSignDate(new Date().toLocaleString());
   setMsaSignedTitle('Director & Lead Signatory');
   showToast('Offline Mode: Sovereign Signature Certificate recorded locally.', 'info');
   ```
   The UI visually seals the contract, displays a green "Binding Agreement Sealed" badge, stamps a fake SHA-256 seal, and tells the user the contract is finalized when the server never recorded it!
2. **Stripe Checkout Offline Fallback**: In `ProposalsView.tsx` (`handleStripeCheckout`, line 384), if the checkout request fails or returns an error, the `catch` block shows:
   ```ts
   showToast('Stripe Checkout test session initialized.', 'info');
   ```
3. **Optional Addon Offline Fallback**: In `ProposalsView.tsx` (`handleToggleOptionalItemLink`, lines 288–297), if `PATCH /api/proposals/:id/items/:itemId` fails, the `catch` block mutates the frontend state and shows:
   ```ts
   showToast('Offline fallback: toggled optional parameters.', 'info');
   ```
4. **Payment Provider Disconnect Fallback**: In `PaymentProvidersSettings.tsx` (`handleDisconnect`, line 152), the response parser uses `.catch(() => ({ success: true }))`, resulting in a success toast even if the server threw an unhandled exception.
5. **Silent Invoicing Prototype Fallback**: In `InvoicingApp.tsx` via `connectBillingRepository()`, if `/api/billing/session` fails with 401 or 503, the app silently downgrades to `localRepository` using browser `localStorage`. Edits appear successful to the user but never persist to the server.

---

## 5. Numbered Implementation Plan (Prompts 2–7)

The following 6-phase roadmap addresses all identified security gaps, architectural fragmentation, in-memory volatile stores, and mock code paths.

### Phase 1: Database Architecture & Unified PostgreSQL Migration
- **1.1. PostgreSQL Schema Migrations**: Create numbered, idempotent SQL migrations in `migrations/` (using standard PostgreSQL syntax, UUID/TEXT identifiers, `TIMESTAMPTZ`, and integer minor units / cents):
  - `0002_proposals_core.sql`: Tables `proposals`, `proposal_items`, `proposal_signatures`, `proposal_audit_events`.
  - `0003_payment_accounts_postgres.sql`: Tables `payment_accounts`, `customers`, `invoices`, `invoice_items`, `payments`, `webhook_events`.
- **1.2. Shared PostgreSQL Connection Pool**: Replace the isolated private pool in `proposalsDb.ts` with the project's shared connection pool. Remove `useMock`, empty seed arrays, and inline `CREATE TABLE` queries.
- **1.3. Retire In-Memory Stores**: Remove `INVOICES_STORE` in `proposals.ts`, `paymentDb.ts` in-memory maps, and `InMemoryD1Store` in `d1Database.ts`. Route all invoice, proposal, and payment operations through PostgreSQL transactions with tenant isolation.

### Phase 2: Route Security, Token-Signed Links & Tenant Authorization
- **2.1. Guard & Authentication Enforcement**: Wrap all proposal, payment, and billing endpoints with `guard()` or `requireUser` from `src/server/routeGuards.ts`.
- **2.2. Eliminate Client-Supplied Identity**: Disallow `userId`, `businessId`, or `orgId` from `req.query` or `req.body`. Authoritatively resolve identity from `req.accountUser.id` and verified organization membership.
- **2.3. Cryptographic Share Tokens for Public Customer Links**:
  - Fix `PUBLIC.proposals` regex so `/invoices` is not public.
  - Require a signed, tamper-proof share token (HMAC-SHA256 with 30-day expiration) in the query string (e.g. `?token=...`) for customer-facing proposal view, PDF render, and digital signing (`/api/proposals/:id`, `/api/proposals/:id/render-pdf`, `/api/proposals/:id/sign`).
  - Reject unsigned or expired requests with HTTP 403 Forbidden.

### Phase 3: Strict Input Validation & Stack Trace Sanitization (Zod)
- **3.1. Zod Request Schemas**: Define comprehensive Zod validation schemas for all parameters, query strings, and payloads across `proposals.ts`, `payments.ts`, and `billing.ts`:
  - Proposal creation, item toggle, signing payloads (`signature_name`, `signature_title`, `signature_vector`, `client_email`).
  - Stripe / Square checkout and connection initiation.
  - Manual payment recording and invoice state transitions.
- **3.2. Uniform Error Envelope**: Standardize all error responses to `{ code: string, error: string, fieldErrors?: Record<string, string> }`. Ensure `error.stack` is never returned to client responses.

### Phase 4: Production Payment Integrations (Stripe & Square) & Webhook Idempotency
- **4.1. Secrets Integration**: Access credentials exclusively through `src/utils/secrets.ts` using `coreSecret` or `optionalSecret`:
  - Stripe: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CLIENT_ID`.
  - Square: `SQUARE_APPLICATION_ID`, `SQUARE_APPLICATION_SECRET`, `SQUARE_ACCESS_TOKEN`, `SQUARE_WEBHOOK_SIGNATURE_KEY`.
- **4.2. Eliminate Sandbox Mock Fallbacks**: Remove mock URLs (`cs_test_...`, `simulated_stripe_code`, `mock_square_sandbox_...`) and fake client responses from production paths. When credentials are unconfigured, return clean `{ code: 'not_configured', error: 'Payment provider credentials are not configured.' }` (HTTP 503).
- **4.3. Unified Webhook Processing & Idempotency**:
  - Consolidate Stripe webhook routing to a single authoritative handler.
  - Enforce HMAC signature verification on raw request bodies.
  - Store processed webhook IDs in PostgreSQL table `webhook_events` within a transaction before mutating invoice status.
- **[CREDENTIALS REQUIRED FROM USER]**:
  - `STRIPE_SECRET_KEY` (test or live key, e.g. `sk_test_...`)
  - `STRIPE_WEBHOOK_SECRET` (`whsec_...`)
  - `STRIPE_CLIENT_ID` (`ca_...` for Stripe Connect)
  - `SQUARE_APPLICATION_ID` (`sandbox-sq0idb-...` or `sq0idp-...`)
  - `SQUARE_APPLICATION_SECRET`
  - `SQUARE_ACCESS_TOKEN`
  - `SQUARE_WEBHOOK_SIGNATURE_KEY`

### Phase 5: Outbound Email Delivery & Authoritative Document Dispatch (SMTP)
- **5.1. SMTP Transport Configuration**: Connect proposal email dispatch and invoice delivery to real SMTP transport via `nodemailer` using environment secrets:
  - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`.
- **5.2. Server-Authoritative PDF Generation**: Generate all emailed PDFs on the server using authoritative PostgreSQL records and `pdf.ts`, rather than trusting client-rendered HTML or base64 attachments.
- **5.3. Delivery Audit Logging**: Persist every dispatch attempt (`to`, `cc`, `subject`, `status`, `smtp_message_id`, `error_detail`, `timestamp`) into PostgreSQL table `delivery_attempts`.
- **[CREDENTIALS REQUIRED FROM USER]**:
  - `SMTP_HOST` (e.g. `smtp.sendgrid.net`, `smtp.mailgun.org`, or custom SMTP relay)
  - `SMTP_PORT` (e.g. `587` or `465`)
  - `SMTP_USER`
  - `SMTP_PASS`
  - `SMTP_FROM` (e.g. `proposals@yourcompany.com`)

### Phase 6: Frontend UI Hardening, Zero Fake Success, & End-to-End Automated Testing
- **6.1. Remove Simulated / Fake Success in UI**:
  - Remove all offline catch fallbacks in `ProposalsView.tsx` (`handleSignProposalSubmit`, `handleStripeCheckout`, `handleToggleOptionalItemLink`). Display clear, honest error banners when the server rejects or cannot reach the database.
  - Wire SOW optional addon cards to call `PATCH /api/proposals/:id/items/:itemId`.
  - Persist company logo and business branding to PostgreSQL settings rather than browser `localStorage`.
- **6.2. Automated Integration Test Suite**:
  - Add or update tests in `src/tests/` and `src/server/__tests__/` covering:
    - Proposal creation, item selection toggle, and cryptographic signing with audit trail.
    - Public route guard rejection when share tokens are missing or tampered.
    - Stripe & Square webhook signature verification and idempotency replay prevention.
    - Invoicing CRUD, manual payment reconciliation, and server-side PDF generation.
  - Verify complete codebase compilation with `npx tsc --noEmit`.
