-- ============================================================
-- Rollback Migration 145: Remove Symphony columns from dev_session
-- Issue #2193 — Dev Session & Terminal Session Schema Migrations
-- ============================================================

-- Remove trigger
DROP TRIGGER IF EXISTS dev_session_updated_at ON dev_session;
DROP FUNCTION IF EXISTS update_dev_session_updated_at();

-- Remove indexes
DROP INDEX IF EXISTS idx_dev_session_symphony_run;
DROP INDEX IF EXISTS idx_dev_session_orchestrated;

-- Remove columns
ALTER TABLE dev_session
  DROP COLUMN IF EXISTS symphony_run_id,
  DROP COLUMN IF EXISTS orchestrated,
  DROP COLUMN IF EXISTS agent_type;
