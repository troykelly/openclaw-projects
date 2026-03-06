-- Issue #2190: Dev Session Auth Migration — Status CHECK Constraint
--
-- Constrains dev_session.status to valid values only.
-- Before adding the constraint, we audit and fix any existing rows
-- with unexpected status values.

-- Step 1: Audit — normalize any non-standard status values to 'active'
UPDATE dev_session
  SET status = 'active'
  WHERE status NOT IN ('active', 'paused', 'completed', 'errored', 'abandoned');

-- Step 2: Add CHECK constraint (idempotent — drops first if exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_dev_session_status' AND conrelid = 'dev_session'::regclass
  ) THEN
    ALTER TABLE dev_session DROP CONSTRAINT chk_dev_session_status;
  END IF;
END $$;

ALTER TABLE dev_session
  ADD CONSTRAINT chk_dev_session_status
  CHECK (status IN ('active', 'paused', 'completed', 'errored', 'abandoned'));

COMMENT ON CONSTRAINT chk_dev_session_status ON dev_session IS
  'Issue #2190: Valid dev session statuses. Role hierarchy: readonly < readwrite < admin.';
