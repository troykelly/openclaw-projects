-- ============================================================
-- Migration 148: Symphony run state machine — 22-state lifecycle
-- Epic #2186 — Symphony Orchestration, Issue #2196
--
-- Updates symphony_run.status CHECK constraint from the initial
-- schema (22 pipeline-stage statuses) to the 22-state orchestrator
-- lifecycle per the design doc §3.
--
-- Also updates symphony_run.stage to use advisory-only stages.
--
-- Per review finding X1: snake_case in DB, PascalCase enum keys
-- in TypeScript mapping to these snake_case values.
-- ============================================================

-- 1. Drop existing CHECK constraint on status
ALTER TABLE symphony_run DROP CONSTRAINT IF EXISTS symphony_run_status_check;

-- 1b. Transform existing rows with old status values to new equivalents
-- This ensures the new CHECK constraint won't fail on existing data.
UPDATE symphony_run SET status = 'unclaimed' WHERE status = 'queued';
UPDATE symphony_run SET status = 'claimed' WHERE status = 'claiming';
UPDATE symphony_run SET status = 'provisioning' WHERE status IN ('provisioned', 'cloning', 'cloned', 'installing', 'installed', 'branching', 'branched');
UPDATE symphony_run SET status = 'running' WHERE status IN ('executing', 'resuming');
UPDATE symphony_run SET status = 'verifying_result' WHERE status = 'reviewing';
UPDATE symphony_run SET status = 'merge_pending' WHERE status IN ('pushing', 'pr_created', 'merging');
UPDATE symphony_run SET status = 'failed' WHERE status = 'timed_out';

-- 2. Add new 22-state CHECK constraint
ALTER TABLE symphony_run ADD CONSTRAINT symphony_run_status_check
  CHECK (status IN (
    'unclaimed',
    'claimed',
    'provisioning',
    'prompting',
    'running',
    'awaiting_approval',
    'verifying_result',
    'merge_pending',
    'post_merge_verify',
    'issue_closing',
    'continuation_wait',
    'succeeded',
    'failed',
    'stalled',
    'cancelled',
    'terminated',
    'terminating',
    'paused',
    'orphaned',
    'cleanup_failed',
    'retry_queued',
    'released'
  ));

-- 3. Update default status to 'unclaimed' (was 'queued')
ALTER TABLE symphony_run ALTER COLUMN status SET DEFAULT 'unclaimed';

-- 4. Drop existing CHECK constraint on stage
ALTER TABLE symphony_run DROP CONSTRAINT IF EXISTS symphony_run_stage_check;

-- 5. Add advisory stage CHECK constraint (nullable)
ALTER TABLE symphony_run ALTER COLUMN stage DROP NOT NULL;
ALTER TABLE symphony_run ALTER COLUMN stage DROP DEFAULT;
ALTER TABLE symphony_run ADD CONSTRAINT symphony_run_stage_check
  CHECK (stage IS NULL OR stage IN (
    'reading_issue',
    'planning',
    'coding',
    'testing',
    'creating_pr',
    'reviewing',
    'waiting_review'
  ));

-- 6. Add claim_epoch column to symphony_run for fencing
ALTER TABLE symphony_run ADD COLUMN IF NOT EXISTS claim_epoch INTEGER;

-- 7. Add failure_class column for retry taxonomy
ALTER TABLE symphony_run ADD COLUMN IF NOT EXISTS failure_class TEXT
  CHECK (failure_class IS NULL OR failure_class IN (
    'ssh_lost',
    'docker_unavailable',
    'host_reboot',
    'credentials_unavailable',
    'rate_limited',
    'disk_full',
    'token_exhaustion',
    'context_overflow',
    'budget_exceeded',
    'agent_loop',
    'diverged_base'
  ));

-- 8. Add retry_count column
ALTER TABLE symphony_run ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0
  CHECK (retry_count >= 0);

-- 9. Update indexes for the new status values
-- Drop and recreate the idempotent run index with new terminal states
-- Terminal states for indexing: succeeded, cancelled, terminated, released, cleanup_failed
-- Note: 'failed' is NOT terminal — it can transition to retry_queued or continuation_wait
DROP INDEX IF EXISTS idx_symphony_run_idempotent;
CREATE UNIQUE INDEX idx_symphony_run_idempotent
  ON symphony_run (work_item_id, attempt)
  WHERE status NOT IN ('succeeded', 'cancelled', 'terminated', 'released', 'cleanup_failed');

-- Drop and recreate the project active index
DROP INDEX IF EXISTS idx_symphony_run_project_active;
CREATE INDEX idx_symphony_run_project_active
  ON symphony_run (project_id, status)
  WHERE project_id IS NOT NULL
    AND status NOT IN ('succeeded', 'cancelled', 'terminated', 'released', 'cleanup_failed');

-- 10. Add idempotency_key to symphony_claim for retry safety (#2197 Codex finding)
ALTER TABLE symphony_claim ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
CREATE INDEX IF NOT EXISTS idx_symphony_claim_idempotency
  ON symphony_claim (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- 11. Add index for watchdog sweep (status + updated_at for timeout detection)
CREATE INDEX IF NOT EXISTS idx_symphony_run_watchdog
  ON symphony_run (status, updated_at)
  WHERE status IN (
    'claimed', 'provisioning', 'prompting', 'running',
    'verifying_result', 'merge_pending', 'post_merge_verify',
    'issue_closing', 'awaiting_approval', 'terminating'
  )
  AND completed_at IS NULL;
