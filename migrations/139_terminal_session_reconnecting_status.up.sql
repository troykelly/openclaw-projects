-- ============================================================
-- Migration 139: Add 'reconnecting' to terminal_session status
-- Issue #2187 — SSH Session Recovery for Remote Orchestration
-- Issue #2188 — Define terminal_session status during reconnection
--
-- During SSH reconnection, sessions transition through:
--   disconnected -> reconnecting -> active (success)
--   disconnected -> reconnecting -> terminated (retries exhausted)
-- ============================================================

-- Drop the existing inline CHECK constraint on status.
-- The constraint name follows PostgreSQL's auto-naming: <table>_<column>_check
ALTER TABLE terminal_session
  DROP CONSTRAINT IF EXISTS terminal_session_status_check;

-- Re-add the CHECK with 'reconnecting' included.
ALTER TABLE terminal_session
  ADD CONSTRAINT terminal_session_status_check
    CHECK (status IN ('starting', 'active', 'idle', 'disconnected', 'reconnecting', 'terminated', 'error', 'pending_host_verification'));
