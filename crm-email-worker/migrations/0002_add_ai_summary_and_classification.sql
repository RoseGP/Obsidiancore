-- =========================================================================================
-- CLOUDFLARE D1 MIGRATION: ADD AI SUMMARY AND CLASSIFICATION COLUMNS
-- Target Engine: Cloudflare D1 (SQLite)
-- Version: 1.1.0
-- Migration: 0002_add_ai_summary_and_classification.sql
-- =========================================================================================

-- Add ai_summary (concise 2-sentence LLM summary) to emails table
ALTER TABLE emails ADD COLUMN ai_summary TEXT;

-- Add classification ('Important' or 'Spam') to emails table
ALTER TABLE emails ADD COLUMN classification TEXT DEFAULT 'Important';

-- Index for filtering emails by classification tag
CREATE INDEX IF NOT EXISTS idx_emails_classification ON emails(classification);
