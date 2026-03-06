-- ============================================================
-- Down migration 141: Remove Symphony run lifecycle tables
-- Reverse of 141_symphony_run_tables.up.sql
-- Epic #2186 — Symphony Orchestration, Issue #2192
-- ============================================================

-- Drop tables in reverse dependency order
DROP TABLE IF EXISTS symphony_run_terminal CASCADE;

DROP TRIGGER IF EXISTS trg_symphony_provisioning_step_updated_at ON symphony_provisioning_step;
DROP FUNCTION IF EXISTS set_symphony_provisioning_step_updated_at();
DROP TABLE IF EXISTS symphony_provisioning_step CASCADE;

DROP TRIGGER IF EXISTS trg_symphony_run_updated_at ON symphony_run;
DROP FUNCTION IF EXISTS set_symphony_run_updated_at();
DROP TABLE IF EXISTS symphony_run CASCADE;

DROP TRIGGER IF EXISTS trg_symphony_workspace_updated_at ON symphony_workspace;
DROP FUNCTION IF EXISTS set_symphony_workspace_updated_at();
DROP TABLE IF EXISTS symphony_workspace CASCADE;

DROP TRIGGER IF EXISTS trg_symphony_claim_updated_at ON symphony_claim;
DROP FUNCTION IF EXISTS set_symphony_claim_updated_at();
DROP TABLE IF EXISTS symphony_claim CASCADE;
