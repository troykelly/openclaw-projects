-- ============================================================
-- Rollback Migration 146: Remove 'stalled' from dev_session status CHECK
-- Issue #2193 — Dev Session & Terminal Session Schema Migrations
-- ============================================================

-- First, update any rows with 'stalled' to 'active'
UPDATE dev_session SET status = 'active' WHERE status = 'stalled';

-- Drop the constraint with stalled
ALTER TABLE dev_session DROP CONSTRAINT IF EXISTS chk_dev_session_status;

-- Re-add without stalled (matches migration 138)
ALTER TABLE dev_session
  ADD CONSTRAINT chk_dev_session_status
  CHECK (status IN ('active', 'paused', 'completed', 'errored', 'abandoned'));
