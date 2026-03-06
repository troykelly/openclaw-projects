-- ============================================================
-- Migration 148 DOWN: Revert GitHub Issue Sync schema extensions
-- Epic #2186 — Symphony Orchestration, Issue #2202
-- ============================================================

-- Drop trigger and function
DROP TRIGGER IF EXISTS trg_github_issue_sync_updated_at ON github_issue_sync;
DROP FUNCTION IF EXISTS set_github_issue_sync_updated_at();

-- Drop github_issue_sync table
DROP TABLE IF EXISTS github_issue_sync;

-- Remove new columns from project_repository
DROP INDEX IF EXISTS idx_project_repository_sync_initiative;
ALTER TABLE project_repository DROP COLUMN IF EXISTS sync_initiative_id;
ALTER TABLE project_repository DROP COLUMN IF EXISTS sync_hash;
ALTER TABLE project_repository DROP COLUMN IF EXISTS last_synced_at;

-- Map new sync_strategy values back to old values before reverting constraint
UPDATE project_repository SET sync_strategy = 'mirror' WHERE sync_strategy = 'github_authoritative';
UPDATE project_repository SET sync_strategy = 'selective' WHERE sync_strategy = 'bidirectional';
-- 'manual' stays as 'manual' (exists in both old and new)

-- Revert sync_strategy CHECK constraint to original values
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'project_repository_sync_strategy_check'
  ) THEN
    ALTER TABLE project_repository DROP CONSTRAINT project_repository_sync_strategy_check;
  END IF;

  ALTER TABLE project_repository
    ADD CONSTRAINT project_repository_sync_strategy_check
    CHECK (sync_strategy IS NULL OR sync_strategy IN ('mirror', 'selective', 'manual'));
END;
$$;
