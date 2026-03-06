-- ============================================================
-- Rollback Migration 147: Remove purpose column from terminal_session
-- Issue #2193 — Dev Session & Terminal Session Schema Migrations
-- ============================================================

DROP INDEX IF EXISTS idx_terminal_session_purpose;

ALTER TABLE terminal_session DROP CONSTRAINT IF EXISTS chk_terminal_session_purpose;

ALTER TABLE terminal_session DROP COLUMN IF EXISTS purpose;
