-- ============================================================
-- Migration 146: Add 'stalled' to dev_session status CHECK
-- Issue #2193 — Dev Session & Terminal Session Schema Migrations
--
-- Migration 138 added CHECK for: active, paused, completed, errored, abandoned.
-- Symphony needs 'stalled' for orchestrated sessions that stop responding.
-- This migration preserves all existing values and adds 'stalled'.
-- ============================================================

-- Drop existing CHECK constraint from migration 138
ALTER TABLE dev_session DROP CONSTRAINT IF EXISTS chk_dev_session_status;

-- Re-add with 'stalled' included
ALTER TABLE dev_session
  ADD CONSTRAINT chk_dev_session_status
  CHECK (status IN ('active', 'paused', 'completed', 'errored', 'abandoned', 'stalled'));

COMMENT ON CONSTRAINT chk_dev_session_status ON dev_session IS
  'Issue #2193: Valid dev session statuses. Includes stalled for Symphony orchestration.';
