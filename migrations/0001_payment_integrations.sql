-- ==============================================================================
-- Cloudflare D1 Migration: 0001_payment_integrations.sql
-- Multi-Tenant SaaS Invoicing with Stripe Test Mode Payment Integration
-- All monetary amounts stored as integer minor units (e.g., $25.99 = 2599 cents)
-- ==============================================================================

-- 1. Businesses Table (Tenant Isolation)
CREATE TABLE IF NOT EXISTS businesses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 2. Customers Table
CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  stripe_customer_id TEXT,
  billing_address TEXT, -- JSON string formatted address
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_customers_business ON customers(business_id);
CREATE INDEX IF NOT EXISTS idx_customers_stripe_id ON customers(stripe_customer_id);

-- 3. Payment Accounts Table (Stripe, Square, PayPal Connected Accounts)
CREATE TABLE IF NOT EXISTS payment_accounts (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK(provider IN ('stripe', 'square', 'paypal')),
  provider_account_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'pending', 'disconnected')),
  access_token_encrypted TEXT,
  refresh_token_encrypted TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_accounts_biz_provider 
ON payment_accounts(business_id, provider);

-- 4. Invoices Table
CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  invoice_number TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  subtotal_cents INTEGER NOT NULL,  -- Stored in integer cents ($25.99 = 2599)
  tax_cents INTEGER NOT NULL,       -- Stored in integer cents
  total_cents INTEGER NOT NULL,     -- Stored in integer cents
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'open', 'paid', 'void', 'uncollectible')),
  payment_provider TEXT CHECK(payment_provider IN ('stripe', 'square', 'paypal', NULL)),
  provider_invoice_id TEXT,
  payment_url TEXT,
  payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK(payment_status IN ('unpaid', 'open', 'paid', 'failed', 'void')),
  due_date TEXT,
  description TEXT,
  paid_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_invoices_business ON invoices(business_id);
CREATE INDEX IF NOT EXISTS idx_invoices_provider_inv ON invoices(provider_invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);

-- 5. Invoice Line Items Table
CREATE TABLE IF NOT EXISTS invoice_items (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL,
  description TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price_cents INTEGER NOT NULL,     -- Stored in integer cents ($10.00 = 1000)
  tax_rate_percent INTEGER NOT NULL DEFAULT 0,
  amount_cents INTEGER NOT NULL,         -- Stored in integer cents (quantity * unit_price_cents)
  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id);

-- 6. Webhook Idempotency Events Table
CREATE TABLE IF NOT EXISTS webhook_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  event_id TEXT NOT NULL,
  processed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_events_provider_event 
ON webhook_events(provider, event_id);
