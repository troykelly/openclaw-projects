-- ============================================================
-- Rollback: Remove 'reconnecting' from terminal_session status
-- Issue #2187 — SSH Session Recovery for Remote Orchestration
-- ============================================================

-- First, update any rows with 'reconnecting' to 'disconnected'
UPDATE terminal_session SET status = 'disconnected' WHERE status = 'reconnecting';

-- Drop the constraint with reconnecting
ALTER TABLE terminal_session
  DROP CONSTRAINT IF EXISTS terminal_session_status_check;

-- Re-add without reconnecting
ALTER TABLE terminal_session
  ADD CONSTRAINT terminal_session_status_check
    CHECK (status IN ('starting', 'active', 'idle', 'disconnected', 'terminated', 'error', 'pending_host_verification'));
