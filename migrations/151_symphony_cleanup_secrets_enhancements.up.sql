-- ============================================================
-- Migration 150: Symphony cleanup & secret lifecycle enhancements
-- Epic #2186 — Issues #2213 (Cleanup Queue), #2214 (Secret Lifecycle)
--
-- Adds columns to symphony_secret_deployment for lifecycle tracking:
--   run_id, last_used_at, staleness, previous_version_id
-- Adds columns to symphony_container for run association:
--   run_id, container_name
-- Adds index for cleanup eligibility queries.
-- ============================================================

-- 1. Add lifecycle columns to symphony_secret_deployment
ALTER TABLE symphony_secret_deployment
  ADD COLUMN IF NOT EXISTS run_id UUID REFERENCES symphony_run(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS staleness TEXT NOT NULL DEFAULT 'current'
    CHECK (staleness IN ('current', 'stale', 'rotating', 'cleaned')),
  ADD COLUMN IF NOT EXISTS previous_version_id UUID REFERENCES symphony_secret_deployment(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS expected_vars TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS validation_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (validation_status IN ('pending', 'valid', 'invalid', 'skipped'));

-- Index for cleanup eligibility: covers both last_used_at and deployed_at for
-- COALESCE(last_used_at, deployed_at) queries used by the cleanup logic.
-- Includes NULL last_used_at rows (never-used secrets) which are a common path.
CREATE INDEX IF NOT EXISTS idx_symphony_secret_cleanup_eligible
  ON symphony_secret_deployment (COALESCE(last_used_at, deployed_at))
  WHERE staleness != 'cleaned';

-- Index for staleness detection
CREATE INDEX IF NOT EXISTS idx_symphony_secret_staleness
  ON symphony_secret_deployment (staleness)
  WHERE staleness = 'stale' OR staleness = 'rotating';

-- Index for run association
CREATE INDEX IF NOT EXISTS idx_symphony_secret_run
  ON symphony_secret_deployment (run_id) WHERE run_id IS NOT NULL;

-- 2. Add run_id and container_name to symphony_container
ALTER TABLE symphony_container
  ADD COLUMN IF NOT EXISTS run_id UUID REFERENCES symphony_run(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS container_name TEXT;

CREATE INDEX IF NOT EXISTS idx_symphony_container_run
  ON symphony_container (run_id) WHERE run_id IS NOT NULL;

-- 3. Add cleanup_scheduled_at to symphony_workspace for deferred GC
ALTER TABLE symphony_workspace
  ADD COLUMN IF NOT EXISTS run_id UUID REFERENCES symphony_run(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cleanup_scheduled_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_symphony_workspace_cleanup
  ON symphony_workspace (cleanup_scheduled_at)
  WHERE cleanup_scheduled_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_symphony_workspace_run
  ON symphony_workspace (run_id) WHERE run_id IS NOT NULL;

-- 4. Add resolved_reason to symphony_cleanup_item for double-check reclaimed tracking
ALTER TABLE symphony_cleanup_item
  ADD COLUMN IF NOT EXISTS resolved_reason TEXT
    CHECK (resolved_reason IS NULL OR resolved_reason IN ('cleaned', 'reclaimed', 'expired', 'manual'));
