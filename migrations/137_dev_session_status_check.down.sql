-- Issue #2190: Rollback dev session status CHECK constraint

ALTER TABLE dev_session DROP CONSTRAINT IF EXISTS chk_dev_session_status;
