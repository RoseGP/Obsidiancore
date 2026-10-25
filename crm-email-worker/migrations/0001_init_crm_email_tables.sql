-- =========================================================================================
-- CLOUDFLARE D1 (SQLITE) DATABASE ARCHITECTURE: CRM INBOUND/OUTBOUND EMAIL SYSTEM
-- Target Engine: Cloudflare D1 (SQLite 3.x with Foreign Keys & FTS5)
-- Version: 1.0.0
-- Migration: 0001_init_crm_email_tables.sql
-- =========================================================================================

-- Enable SQLite Foreign Key Constraints
PRAGMA foreign_keys = ON;

-- -----------------------------------------------------------------------------------------
-- 1. CONTACTS TABLE
-- Stores multi-tenant customer/lead contact profiles mapped to their CRM tenant account
-- -----------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contacts (
    id TEXT PRIMARY KEY,                             -- Unique Contact UUID (e.g., 'cnt_01HGB...')
    email TEXT NOT NULL COLLATE NOCASE,              -- Normalized email address (case-insensitive)
    name TEXT,                                       -- Full contact name
    crm_account_id TEXT NOT NULL,                    -- Tenant / Organization Account ID
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    
    -- Ensure uniqueness of email per CRM tenant account
    CONSTRAINT uq_contact_tenant_email UNIQUE (crm_account_id, email)
);

-- Indices for Contacts: Fast lookup by email, tenant, and creation recency
CREATE INDEX IF NOT EXISTS idx_contacts_crm_account ON contacts(crm_account_id);
CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email);
CREATE INDEX IF NOT EXISTS idx_contacts_tenant_email ON contacts(crm_account_id, email);
CREATE INDEX IF NOT EXISTS idx_contacts_created_at ON contacts(created_at DESC);


-- -----------------------------------------------------------------------------------------
-- 2. EMAIL THREADS TABLE
-- Aggregates conversations with a contact into a continuous chronological thread
-- -----------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_threads (
    id TEXT PRIMARY KEY,                             -- Unique Thread UUID (e.g., 'thd_01HGB...')
    contact_id TEXT NOT NULL,                        -- Reference to the primary contact
    subject TEXT NOT NULL DEFAULT '(No Subject)',    -- Root conversation subject line
    last_message_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    status TEXT NOT NULL DEFAULT 'open',             -- Thread workflow state
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    
    -- Foreign Key referencing contacts table with cascade delete
    CONSTRAINT fk_threads_contact 
        FOREIGN KEY (contact_id) 
        REFERENCES contacts(id) 
        ON DELETE CASCADE,

    -- Enforce standard thread status values
    CONSTRAINT chk_threads_status 
        CHECK (status IN ('open', 'pending', 'resolved', 'closed', 'archived', 'spam'))
);

-- Indices for Email Threads: Fast retrieval for inbox views, contact timelines, & sorting
CREATE INDEX IF NOT EXISTS idx_threads_contact_id ON email_threads(contact_id);
CREATE INDEX IF NOT EXISTS idx_threads_last_message_at ON email_threads(last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_threads_status ON email_threads(status);
CREATE INDEX IF NOT EXISTS idx_threads_contact_last_msg ON email_threads(contact_id, last_message_at DESC);


-- -----------------------------------------------------------------------------------------
-- 3. EMAILS TABLE
-- Stores individual inbound and outbound email messages belonging to a thread
-- -----------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS emails (
    id TEXT PRIMARY KEY,                             -- Unique Message UUID (e.g., 'eml_01HGB...')
    thread_id TEXT NOT NULL,                         -- Reference to the parent email thread
    direction TEXT NOT NULL,                         -- Message flow direction
    sender TEXT NOT NULL COLLATE NOCASE,             -- Sender email (e.g., 'sarah@example.com')
    recipient TEXT NOT NULL COLLATE NOCASE,          -- Recipient email or comma-separated list
    subject TEXT NOT NULL DEFAULT '(No Subject)',    -- Email subject
    body_text TEXT,                                  -- Plain-text parsed body content
    body_html TEXT,                                  -- Sanitized HTML body content
    message_id TEXT,                                 -- RFC 822 / 2822 Message-ID header (for threading)
    in_reply_to TEXT,                                -- RFC 822 In-Reply-To header
    raw_eml_key TEXT,                                -- Optional Cloudflare R2 storage key for raw .eml
    ai_summary TEXT,                                 -- AI-generated 2-sentence summary
    classification TEXT DEFAULT 'Important',        -- AI Classification: 'Important' | 'Spam'
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    
    -- Foreign Key referencing email_threads table with cascade delete
    CONSTRAINT fk_emails_thread 
        FOREIGN KEY (thread_id) 
        REFERENCES email_threads(id) 
        ON DELETE CASCADE,

    -- Enforce direction values
    CONSTRAINT chk_emails_direction 
        CHECK (direction IN ('inbound', 'outbound')),

    -- Enforce classification values
    CONSTRAINT chk_emails_classification 
        CHECK (classification IN ('Important', 'Spam'))
);

-- Indices for Emails: High-throughput lookups for threading, message routing, & search
CREATE INDEX IF NOT EXISTS idx_emails_thread_created ON emails(thread_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_emails_thread_id ON emails(thread_id);
CREATE INDEX IF NOT EXISTS idx_emails_direction ON emails(direction);
CREATE INDEX IF NOT EXISTS idx_emails_classification ON emails(classification);
CREATE INDEX IF NOT EXISTS idx_emails_message_id ON emails(message_id);
CREATE INDEX IF NOT EXISTS idx_emails_in_reply_to ON emails(in_reply_to);
CREATE INDEX IF NOT EXISTS idx_emails_sender ON emails(sender);
CREATE INDEX IF NOT EXISTS idx_emails_recipient ON emails(recipient);
CREATE INDEX IF NOT EXISTS idx_emails_created_at ON emails(created_at DESC);


-- -----------------------------------------------------------------------------------------
-- 4. ATTACHMENTS TABLE
-- Binary attachment metadata linking to files archived in Cloudflare R2
-- -----------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY,                             -- Unique Attachment UUID (e.g., 'att_01HGB...')
    email_id TEXT NOT NULL,                          -- Reference to the parent email
    filename TEXT NOT NULL,                          -- Original file name (e.g., 'contract.pdf')
    mime_type TEXT NOT NULL DEFAULT 'application/octet-stream', -- MIME content-type
    r2_key TEXT NOT NULL,                            -- Cloudflare R2 object storage key
    size_bytes INTEGER NOT NULL DEFAULT 0,           -- File size in bytes
    content_disposition TEXT DEFAULT 'attachment',  -- 'attachment' or 'inline'
    content_id TEXT,                                 -- Content-ID for inline CID-referenced images
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    
    -- Foreign Key referencing emails table with cascade delete
    CONSTRAINT fk_attachments_email 
        FOREIGN KEY (email_id) 
        REFERENCES emails(id) 
        ON DELETE CASCADE
);

-- Indices for Attachments: Fast lookup by email and R2 storage key
CREATE INDEX IF NOT EXISTS idx_attachments_email_id ON attachments(email_id);
CREATE INDEX IF NOT EXISTS idx_attachments_r2_key ON attachments(r2_key);


-- -----------------------------------------------------------------------------------------
-- 5. AUTOMATED TRIGGERS FOR DATA INTEGRITY & TIMESTAMPS
-- -----------------------------------------------------------------------------------------

-- Trigger A: Automatically update parent thread's `last_message_at` when a new email is created
CREATE TRIGGER IF NOT EXISTS trg_update_thread_last_message
AFTER INSERT ON emails
BEGIN
    UPDATE email_threads
    SET 
        last_message_at = NEW.created_at,
        updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    WHERE id = NEW.thread_id;
END;

-- Trigger B: Automatically update contact's `updated_at` timestamp on record change
CREATE TRIGGER IF NOT EXISTS trg_update_contact_timestamp
AFTER UPDATE ON contacts
BEGIN
    UPDATE contacts 
    SET updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    WHERE id = OLD.id;
END;

-- Trigger C: Automatically update thread's `updated_at` timestamp on record change
CREATE TRIGGER IF NOT EXISTS trg_update_thread_timestamp
AFTER UPDATE ON email_threads
BEGIN
    UPDATE email_threads 
    SET updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    WHERE id = OLD.id;
END;
