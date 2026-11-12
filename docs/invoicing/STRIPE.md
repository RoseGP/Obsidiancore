# Stripe invoicing (Stripe Connect)

Each organization connects **its own** Stripe account (Stripe Connect, Standard accounts, OAuth). The CRM creates
invoices in that account and Stripe emails them with a payment link; payments mark the CRM invoice paid.

## How it works
1. **Connect** (Proposals & Invoices › Payment providers, managers and up): OAuth to Stripe. The `state` is
   signed (organization, member, 15-minute expiry), bound to the starting browser by an HttpOnly cookie and used
   once. The connection is stored per organization (`organizations/{org}/payment_connections/stripe`), token
   encrypted (AES-256-GCM); one Stripe account can belong to one organization only.
2. **Create** (invoice page › *Collect with Stripe* › *Create Stripe invoice*): the server loads the stored CRM
   invoice and creates a **draft** in the connected account. Amounts come from the CRM calculation engine in
   integer minor units: one item per line, a negative *Discount* item, one item per tax rate, one per fee and a
   negative *Payments received* item, so Stripe's total equals the CRM balance due exactly (checked; a mismatch
   deletes the draft). Items are attached to the invoice (`pending_invoice_items_behavior: exclude`).
   The customer is reused: the CRM client's mapping, else an existing Stripe customer with that email, else a new
   one (`metadata.crm_ref`). Every write has an idempotency key. One live Stripe invoice per CRM invoice.
3. **Send** (*Finalize & email via Stripe*, after a confirmation): Stripe finalizes and emails it; the CRM invoice
   is marked sent. Nothing is finalized or emailed without this explicit action.
4. **Payments**: webhooks (and *Refresh status*) update the CRM: paid (records the card payment on the CRM invoice,
   exactly once), payment failed (shown on the invoice), action required, voided, uncollectible. Status only
   moves forward, so late or replayed events can't undo a payment. *Discard draft* deletes a draft in Stripe;
   *Void* voids an open invoice. Paid invoices are refunded in Stripe, not voided.

API: `src/routes/paymentIntegrations.ts` (header lists the routes), webhooks `src/routes/paymentWebhooks.ts`,
provider `src/services/payment/stripeProvider.ts`, client `stripeClient.ts`, status rules `stripeInvoiceSync.ts`,
UI `src/features/invoicing/components/StripeCollectPanel.tsx`. Access: role matrix module `billing`
(view / create / edit); connecting needs organization management.

## Setup (test mode first)
1. Stripe Dashboard (in **test mode**) › Settings › Connect › enable OAuth for Standard accounts; add the redirect
   URI `https://<APP_URL>/api/integrations/stripe/callback`; copy the **client id** (`ca_…`).
2. Developers › API keys › copy the **test secret key** (`sk_test_…`). Set on the server (secret manager, never in git):
   `STRIPE_SECRET_KEY`, `STRIPE_CLIENT_ID`, and `APP_URL`.
3. Developers › Webhooks › *Add endpoint* `https://<APP_URL>/api/webhooks/stripe`, **"Listen to events on Connected
   accounts"**, events: `invoice.finalized`, `invoice.sent`, `invoice.updated`, `invoice.paid`,
   `invoice.payment_succeeded`, `invoice.payment_failed`, `invoice.payment_action_required`, `invoice.voided`,
   `invoice.marked_uncollectible`, `invoice.deleted`, `account.application.deauthorized`. Set its signing secret as
   `STRIPE_WEBHOOK_SECRET`.
4. Restart the server. Payment providers shows *Test mode*; connect a test account, create and send an invoice,
   pay it on the hosted page with Stripe's test card `4242 4242 4242 4242`.
   Local webhooks: `stripe listen --forward-connect-to localhost:3000/api/webhooks/stripe` (prints a `whsec_…` to use).

No database migration is needed: new fields on stored records are optional.
