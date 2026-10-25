-- =========================================================================================
-- SENIOR DATABASE ARCHITECT - POSTGRESQL PRODUCTION-READY SCHEMA & INDEXING MIGRATION
-- Target Platform: PostgreSQL (version 12+)
-- Scope: Multi-tenant Omnichannel Marketing CRM
-- Features: 
--   1. Full-Text search GIN index on communication logs (natural language vocabulary parsing-english)
--   2. pg_trgm substring search GIN index for fuzzy/fractional text matches
--   3. JSONB custom fields GIN index for dynamic contact properties
--   4. Optimized composite scheduler index for automated worker tasks
-- =========================================================================================

-- Enable Extension: pg_trgm for ultra-fast fuzzy and substring searches
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Enable Extension: pgcrypto/uuid-ossp for secure random UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =========================================================================================
-- 1. TEAM USERS TABLE (Team management and relationship mapping)
-- =========================================================================================
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    role VARCHAR(50) DEFAULT 'agent' NOT NULL, -- e.g. 'administrator', 'manager', 'agent'
    timezone VARCHAR(100) DEFAULT 'UTC' NOT NULL,
    is_active BOOLEAN DEFAULT TRUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Indices for user queries
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role) WHERE is_active = TRUE;

-- =========================================================================================
-- 2. CONTACTS TABLE (Dynamic client records)
-- =========================================================================================
CREATE TABLE IF NOT EXISTS contacts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(50),
    company_name VARCHAR(255),
    lifecycle_status VARCHAR(50) DEFAULT 'lead' NOT NULL, -- e.g. 'lead', 'mql', 'sql', 'customer', 'churned'
    
    -- GIN-Indexed JSONB for custom fields (unstructured schema parameters)
    custom_fields JSONB DEFAULT '{}'::jsonb NOT NULL,
    
    -- Client relationship manager
    owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
    
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    
    -- Enforce lifecycle state safety using check constraints
    CONSTRAINT chk_lifecycle_status CHECK (lifecycle_status IN ('lead', 'mql', 'sql', 'customer', 'churned', 'inactive'))
);

-- B-Tree Indexes for exact search lookups
CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email);
CREATE INDEX IF NOT EXISTS idx_contacts_phone_exact ON contacts(phone);

-- Normalized phone index to resolve dial differences (strips non-numeric characters)
CREATE INDEX IF NOT EXISTS idx_contacts_phone_normalized 
ON contacts(regexp_replace(phone, '\D', '', 'g'));

-- GIN Index on CRM JSONB Custom Fields
-- Optimizes containment inquiries: WHERE custom_fields @> '{"industry": "FinTech"}'
CREATE INDEX IF NOT EXISTS idx_contacts_custom_fields_gin ON contacts USING gin(custom_fields);

-- =========================================================================================
-- 3. COMMUNICATIONS TABLE (Unified Omnichannel Messaging Inbox)
-- =========================================================================================
CREATE TABLE IF NOT EXISTS communications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    channel VARCHAR(50) NOT NULL,    -- e.g., 'email', 'sms', 'whatsapp', 'google_business'
    direction VARCHAR(20) NOT NULL,  -- e.g., 'inbound', 'outbound'
    subject VARCHAR(255),            -- Optional (applicable for Emails)
    body TEXT NOT NULL,              -- Full message payload/content
    status VARCHAR(50) DEFAULT 'sent' NOT NULL, -- 'queued', 'sent', 'delivered', 'read', 'failed'
    media_urls TEXT[] DEFAULT '{}'::TEXT[] NOT NULL, -- Array of media attachment links
    error_message TEXT,               -- Remote API delivery failures log
    
    contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    sender_id UUID REFERENCES users(id) ON DELETE SET NULL, -- Author of message if outbound
    
    sent_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    
    -- Enforce values sanity via postgres check constraints
    CONSTRAINT chk_comm_channel CHECK (channel IN ('email', 'sms', 'whatsapp', 'google_business')),
    CONSTRAINT chk_comm_direction CHECK (direction IN ('inbound', 'outbound')),
    CONSTRAINT chk_comm_status CHECK (status IN ('queued', 'sent', 'delivered', 'read', 'failed'))
);

-- Core Relational Foreign-Key B-Tree indexes
CREATE INDEX IF NOT EXISTS idx_communications_contact_id ON communications(contact_id);
CREATE INDEX IF NOT EXISTS idx_communications_sender_id ON communications(sender_id);
CREATE INDEX IF NOT EXISTS idx_communications_channel_status ON communications(channel, status);
CREATE INDEX IF NOT EXISTS idx_communications_sent_at ON communications(sent_at DESC);

-- -----------------------------------------------------------------------------------------
-- TEXT SEARCH OPTIMIZATIONS (The Architecture's Heart)
-- -----------------------------------------------------------------------------------------

-- A. Standard Full-Text Search GIN Index
-- Uses Postgres lexical stemmers for natural language searches: "searching for cats matches cat/catting"
CREATE INDEX IF NOT EXISTS idx_communications_body_fts 
ON communications USING gin(to_tsvector('english', coalesce(subject, '') || ' ' || body));

-- B. Trigram GIN index for partial, substring, pattern matching, and wildcard queries
-- Accelerates "LIKE '%part_number%'" or unstructured text fragments queries
CREATE INDEX IF NOT EXISTS idx_communications_body_trgm 
ON communications USING gin(body gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_communications_subject_trgm 
ON communications USING gin(subject gin_trgm_ops);

-- =========================================================================================
-- 4. SOCIAL POSTS TABLE (Social Media Content Scheduling & Automation Engine)
-- =========================================================================================
CREATE TABLE IF NOT EXISTS social_posts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    body TEXT NOT NULL,               -- Post body copy / caption
    media_urls TEXT[] DEFAULT '{}'::text[] NOT NULL, -- Post attachment strings
    scheduled_at TIMESTAMPTZ,         -- Intended future timestamp (NULL if publish immediately)
    status VARCHAR(50) DEFAULT 'draft' NOT NULL, -- 'draft', 'scheduled', 'published', 'failed'
    
    -- Targets (e.g. ARRAY['LINKEDIN', 'INSTAGRAM', 'GOOGLE_BUSINESS'])
    platforms VARCHAR(100)[] NOT NULL, 
    error_log TEXT,                   -- API error logs
    
    creator_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    
    CONSTRAINT chk_social_status CHECK (status IN ('draft', 'scheduled', 'published', 'failed'))
);

-- Composite Index optimizing polling actions by Scheduler Workers (e.g. BullMQ, Pg-boss)
-- Allows checking: WHERE status = 'scheduled' AND scheduled_at <= NOW()
CREATE INDEX IF NOT EXISTS idx_social_posts_scheduler 
ON social_posts(status, scheduled_at) 
WHERE status = 'scheduled';

CREATE INDEX IF NOT EXISTS idx_social_posts_creator_id ON social_posts(creator_id);

-- =========================================================================================
-- AUTOMATED TRIGGERS (Auto-Updating 'updated_at' columns on change)
-- =========================================================================================
CREATE OR REPLACE FUNCTION update_timestamp_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_update_at
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION update_timestamp_column();

CREATE TRIGGER trg_contacts_update_at
BEFORE UPDATE ON contacts
FOR EACH ROW EXECUTE FUNCTION update_timestamp_column();

CREATE TRIGGER trg_social_posts_update_at
BEFORE UPDATE ON social_posts
FOR EACH ROW EXECUTE FUNCTION update_timestamp_column();
