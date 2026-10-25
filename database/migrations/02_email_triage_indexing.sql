-- =========================================================================================
-- PRINCIPAL DATABASE ENGINEER - PRODUCTION-READY INDEXING & SCHEMA MODIFICATIONS
-- Target Platform: PostgreSQL (version 12+)
-- Scope: Ultra-low latency email triage and folder tab shifting optimization
-- =========================================================================================

-- 1. Ensure the emails table contains the triage columns (with safe defaults)
-- We use a single ALTER TABLE block to minimize lock duration on production tables.
ALTER TABLE IF EXISTS emails 
    ADD COLUMN IF NOT EXISTS is_trash BOOLEAN DEFAULT FALSE NOT NULL,
    ADD COLUMN IF NOT EXISTS is_spam BOOLEAN DEFAULT FALSE NOT NULL,
    ADD COLUMN IF NOT EXISTS recipient_id UUID;

-- 2. CREATE CRITICAL INDEXES FOR FOLDER SHIFTING LATENCY OPTIMIZATION

-- Index 1: B-Tree index on recipient_id for rapid filter by user inbox
CREATE INDEX IF NOT EXISTS idx_emails_recipient_id 
ON emails (recipient_id);

-- Index 2: Composite B-Tree index on recipient_id and boolean triage flags
-- Essential for queries of form: WHERE recipient_id = $1 AND is_trash = FALSE AND is_spam = FALSE
CREATE INDEX IF NOT EXISTS idx_emails_recipient_triage_flags 
ON emails (recipient_id, is_trash, is_spam);

-- Index 3: Partial index specifically for the Active INBOX tab
-- Restricts index size to active records, saving disk space and speeding up memory reads
CREATE INDEX IF NOT EXISTS idx_emails_active_inbox_partial
ON emails (recipient_id) 
WHERE is_trash = FALSE AND is_spam = FALSE;

-- Index 4: Partial index specifically for the SPAM tab
CREATE INDEX IF NOT EXISTS idx_emails_spam_partial
ON emails (recipient_id) 
WHERE is_spam = TRUE AND is_trash = FALSE;

-- Index 5: Partial index specifically for the TRASH tab
CREATE INDEX IF NOT EXISTS idx_emails_trash_partial
ON emails (recipient_id) 
WHERE is_trash = TRUE;

-- 3. ANALYZE to update PostgreSQL optimizer statistics immediately
ANALYZE emails;
