-- =========================================================================================
-- CLOUDFLARE D1 (SQLITE) DATABASE ARCHITECTURE: CRM INBOUND/OUTBOUND EMAIL SYSTEM
-- Target Engine: Cloudflare D1 (SQLite 3.x with Foreign Keys & FTS5)
-- Version: 1.0.0
-- File: schema.sql (Run with: wrangler d1 execute your-db-name --file=schema.sql)
-- =========================================================================================

PRAGMA foreign_keys = ON;

-- 1. CONTACTS TABLE
CREATE TABLE IF NOT EXISTS contacts (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL COLLATE NOCASE,
    name TEXT,
    crm_account_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CONSTRAINT uq_contact_tenant_email UNIQUE (crm_account_id, email)
);

CREATE INDEX IF NOT EXISTS idx_contacts_crm_account ON contacts(crm_account_id);
CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email);
CREATE INDEX IF NOT EXISTS idx_contacts_tenant_email ON contacts(crm_account_id, email);
CREATE INDEX IF NOT EXISTS idx_contacts_created_at ON contacts(created_at DESC);

-- 2. EMAIL THREADS TABLE
CREATE TABLE IF NOT EXISTS email_threads (
    id TEXT PRIMARY KEY,
    contact_id TEXT NOT NULL,
    subject TEXT NOT NULL DEFAULT '(No Subject)',
    last_message_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    status TEXT NOT NULL DEFAULT 'open',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CONSTRAINT fk_threads_contact FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE,
    CONSTRAINT chk_threads_status CHECK (status IN ('open', 'pending', 'resolved', 'closed', 'archived', 'spam'))
);

CREATE INDEX IF NOT EXISTS idx_threads_contact_id ON email_threads(contact_id);
CREATE INDEX IF NOT EXISTS idx_threads_last_message_at ON email_threads(last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_threads_status ON email_threads(status);
CREATE INDEX IF NOT EXISTS idx_threads_contact_last_msg ON email_threads(contact_id, last_message_at DESC);

-- 3. EMAILS TABLE
CREATE TABLE IF NOT EXISTS emails (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL,
    direction TEXT NOT NULL,
    sender TEXT NOT NULL COLLATE NOCASE,
    recipient TEXT NOT NULL COLLATE NOCASE,
    subject TEXT NOT NULL DEFAULT '(No Subject)',
    body_text TEXT,
    body_html TEXT,
    message_id TEXT,
    in_reply_to TEXT,
    raw_eml_key TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CONSTRAINT fk_emails_thread FOREIGN KEY (thread_id) REFERENCES email_threads(id) ON DELETE CASCADE,
    CONSTRAINT chk_emails_direction CHECK (direction IN ('inbound', 'outbound'))
);

CREATE INDEX IF NOT EXISTS idx_emails_thread_created ON emails(thread_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_emails_thread_id ON emails(thread_id);
CREATE INDEX IF NOT EXISTS idx_emails_direction ON emails(direction);
CREATE INDEX IF NOT EXISTS idx_emails_message_id ON emails(message_id);
CREATE INDEX IF NOT EXISTS idx_emails_in_reply_to ON emails(in_reply_to);
CREATE INDEX IF NOT EXISTS idx_emails_sender ON emails(sender);
CREATE INDEX IF NOT EXISTS idx_emails_recipient ON emails(recipient);

-- 4. ATTACHMENTS TABLE
CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY,
    email_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
    size_bytes INTEGER NOT NULL DEFAULT 0,
    r2_key TEXT NOT NULL,
    checksum_sha256 TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CONSTRAINT fk_attachments_email FOREIGN KEY (email_id) REFERENCES emails(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_attachments_email_id ON attachments(email_id);
CREATE INDEX IF NOT EXISTS idx_attachments_r2_key ON attachments(r2_key);

-- 5. USERS & USER_EMAILS TABLE
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS user_emails (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    email_id TEXT NOT NULL,
    folder TEXT NOT NULL DEFAULT 'inbox',
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CONSTRAINT fk_user_emails_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_user_emails_email FOREIGN KEY (email_id) REFERENCES emails(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_emails_user_folder ON user_emails(user_id, folder);
CREATE INDEX IF NOT EXISTS idx_user_emails_email_id ON user_emails(email_id);

-- =========================================================================================
-- 6. POSTIZ CONNECTIONS & SOCIAL SCHEDULING TABLES
-- =========================================================================================

CREATE TABLE IF NOT EXISTS postiz_connections (
    id TEXT PRIMARY KEY,
    crm_user_id TEXT NOT NULL,
    crm_account_id TEXT,
    postiz_organization_id TEXT,
    encrypted_access_token TEXT NOT NULL,
    refresh_token_encrypted TEXT,
    expires_at INTEGER,
    scope TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CONSTRAINT uq_postiz_user UNIQUE (crm_user_id)
);

CREATE INDEX IF NOT EXISTS idx_postiz_connections_user ON postiz_connections(crm_user_id);
CREATE INDEX IF NOT EXISTS idx_postiz_connections_account ON postiz_connections(crm_account_id);
CREATE INDEX IF NOT EXISTS idx_postiz_connections_org ON postiz_connections(postiz_organization_id);

CREATE TABLE IF NOT EXISTS social_scheduled_posts (
    id TEXT PRIMARY KEY,
    crm_user_id TEXT NOT NULL,
    crm_account_id TEXT,
    postiz_post_id TEXT,
    status TEXT NOT NULL DEFAULT 'scheduled',
    scheduled_at TEXT NOT NULL,
    timezone TEXT NOT NULL DEFAULT 'UTC',
    prompt TEXT,
    original_content TEXT NOT NULL,
    media_json TEXT,
    settings_json TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CONSTRAINT chk_scheduled_status CHECK (status IN ('draft', 'scheduled', 'publishing', 'published', 'failed', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_social_posts_user ON social_scheduled_posts(crm_user_id);
CREATE INDEX IF NOT EXISTS idx_social_posts_status ON social_scheduled_posts(status);
CREATE INDEX IF NOT EXISTS idx_social_posts_scheduled_at ON social_scheduled_posts(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_social_posts_postiz_id ON social_scheduled_posts(postiz_post_id);

CREATE TABLE IF NOT EXISTS social_post_destinations (
    id TEXT PRIMARY KEY,
    scheduled_post_id TEXT NOT NULL,
    postiz_integration_id TEXT NOT NULL,
    platform TEXT NOT NULL,
    account_name TEXT,
    generated_content TEXT,
    status TEXT NOT NULL DEFAULT 'scheduled',
    external_post_id TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CONSTRAINT fk_destination_post FOREIGN KEY (scheduled_post_id) REFERENCES social_scheduled_posts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_destinations_post ON social_post_destinations(scheduled_post_id);
CREATE INDEX IF NOT EXISTS idx_destinations_platform ON social_post_destinations(platform);
CREATE INDEX IF NOT EXISTS idx_destinations_integration ON social_post_destinations(postiz_integration_id);

