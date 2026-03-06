-- ============================================================
-- Migration 148 DOWN: Revert symphony run state machine changes
-- Epic #2186 — Symphony Orchestration, Issue #2196
-- ============================================================

-- Drop watchdog index
DROP INDEX IF EXISTS idx_symphony_run_watchdog;

-- Drop and restore original indexes
DROP INDEX IF EXISTS idx_symphony_run_idempotent;
CREATE UNIQUE INDEX idx_symphony_run_idempotent
  ON symphony_run (work_item_id, attempt)
  WHERE status NOT IN ('succeeded', 'failed', 'cancelled', 'timed_out');

DROP INDEX IF EXISTS idx_symphony_run_project_active;
CREATE INDEX idx_symphony_run_project_active
  ON symphony_run (project_id, status)
  WHERE project_id IS NOT NULL
    AND status NOT IN ('succeeded', 'failed', 'cancelled', 'timed_out');

-- Remove new columns
ALTER TABLE symphony_run DROP COLUMN IF EXISTS retry_count;
ALTER TABLE symphony_run DROP COLUMN IF EXISTS failure_class;
ALTER TABLE symphony_run DROP COLUMN IF EXISTS claim_epoch;

-- Restore original stage constraint
ALTER TABLE symphony_run DROP CONSTRAINT IF EXISTS symphony_run_stage_check;
ALTER TABLE symphony_run ALTER COLUMN stage SET NOT NULL;
ALTER TABLE symphony_run ALTER COLUMN stage SET DEFAULT 'queued';
ALTER TABLE symphony_run ADD CONSTRAINT symphony_run_stage_check
  CHECK (stage IN ('queued', 'setup', 'execution', 'review', 'delivery', 'teardown', 'terminal'));

-- Restore original status constraint
ALTER TABLE symphony_run DROP CONSTRAINT IF EXISTS symphony_run_status_check;
ALTER TABLE symphony_run ALTER COLUMN status SET DEFAULT 'queued';
ALTER TABLE symphony_run ADD CONSTRAINT symphony_run_status_check
  CHECK (status IN (
    'queued', 'claiming', 'claimed', 'provisioning', 'provisioned',
    'cloning', 'cloned', 'installing', 'installed', 'branching',
    'branched', 'executing', 'paused', 'resuming', 'reviewing',
    'pushing', 'pr_created', 'merging', 'succeeded', 'failed',
    'cancelled', 'timed_out'
  ));
