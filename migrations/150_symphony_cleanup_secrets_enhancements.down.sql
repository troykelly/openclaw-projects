-- ============================================================
-- Rollback Migration 150: Symphony cleanup & secret lifecycle enhancements
-- ============================================================

-- Remove resolved_reason from symphony_cleanup_item
ALTER TABLE symphony_cleanup_item DROP COLUMN IF EXISTS resolved_reason;

-- Remove cleanup columns from symphony_workspace
DROP INDEX IF EXISTS idx_symphony_workspace_run;
DROP INDEX IF EXISTS idx_symphony_workspace_cleanup;
ALTER TABLE symphony_workspace DROP COLUMN IF EXISTS cleanup_scheduled_at;
ALTER TABLE symphony_workspace DROP COLUMN IF EXISTS run_id;

-- Remove run_id and container_name from symphony_container
DROP INDEX IF EXISTS idx_symphony_container_run;
ALTER TABLE symphony_container DROP COLUMN IF EXISTS container_name;
ALTER TABLE symphony_container DROP COLUMN IF EXISTS run_id;

-- Remove lifecycle columns from symphony_secret_deployment
DROP INDEX IF EXISTS idx_symphony_secret_run;
DROP INDEX IF EXISTS idx_symphony_secret_staleness;
DROP INDEX IF EXISTS idx_symphony_secret_cleanup_eligible;
ALTER TABLE symphony_secret_deployment DROP COLUMN IF EXISTS validation_status;
ALTER TABLE symphony_secret_deployment DROP COLUMN IF EXISTS expected_vars;
ALTER TABLE symphony_secret_deployment DROP COLUMN IF EXISTS previous_version_id;
ALTER TABLE symphony_secret_deployment DROP COLUMN IF EXISTS staleness;
ALTER TABLE symphony_secret_deployment DROP COLUMN IF EXISTS last_used_at;
ALTER TABLE symphony_secret_deployment DROP COLUMN IF EXISTS run_id;
