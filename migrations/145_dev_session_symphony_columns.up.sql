-- ============================================================
-- Migration 145: Add Symphony orchestration columns to dev_session
-- Issue #2193 — Dev Session & Terminal Session Schema Migrations
--
-- Adds nullable columns for Symphony integration:
--   - symphony_run_id: links to a symphony run (FK deferred to #2192)
--   - orchestrated: flags sessions created by the orchestrator
--   - agent_type: classifies the agent (orchestrator, worker, etc.)
--
-- Also adds an updated_at trigger (X4 finding) so status changes
-- and other modifications automatically refresh the timestamp.
-- ============================================================

-- Step 1: Add new columns
ALTER TABLE dev_session
  ADD COLUMN IF NOT EXISTS symphony_run_id UUID,
  ADD COLUMN IF NOT EXISTS orchestrated BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS agent_type TEXT;

-- Step 2: Index on symphony_run_id for join performance
CREATE INDEX IF NOT EXISTS idx_dev_session_symphony_run
  ON dev_session(symphony_run_id) WHERE symphony_run_id IS NOT NULL;

-- Step 3: Index on orchestrated for filtering
CREATE INDEX IF NOT EXISTS idx_dev_session_orchestrated
  ON dev_session(orchestrated) WHERE orchestrated = true;

-- Step 4: updated_at trigger (X4 finding — consistent with other tables)
CREATE OR REPLACE FUNCTION update_dev_session_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS dev_session_updated_at ON dev_session;
CREATE TRIGGER dev_session_updated_at
  BEFORE UPDATE ON dev_session
  FOR EACH ROW
  EXECUTE FUNCTION update_dev_session_updated_at();

COMMENT ON COLUMN dev_session.symphony_run_id IS
  'Issue #2193: References symphony_run(id) — FK added when symphony_run table exists (#2192).';
COMMENT ON COLUMN dev_session.orchestrated IS
  'Issue #2193: True for sessions created by Symphony orchestrator.';
COMMENT ON COLUMN dev_session.agent_type IS
  'Issue #2193: Agent classification (orchestrator, worker, etc.).';
