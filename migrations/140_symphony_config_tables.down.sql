-- ============================================================
-- Down migration 140: Remove Symphony core configuration tables
-- Reverse of 140_symphony_config_tables.up.sql
-- Epic #2186 — Symphony Orchestration, Issue #2192
-- ============================================================

-- Drop triggers first
DROP TRIGGER IF EXISTS trg_symphony_notification_rule_updated_at ON symphony_notification_rule;
DROP FUNCTION IF EXISTS set_symphony_notification_rule_updated_at();

DROP TRIGGER IF EXISTS trg_symphony_orchestrator_config_updated_at ON symphony_orchestrator_config;
DROP FUNCTION IF EXISTS set_symphony_orchestrator_config_updated_at();

DROP TRIGGER IF EXISTS trg_symphony_tool_config_updated_at ON symphony_tool_config;
DROP FUNCTION IF EXISTS set_symphony_tool_config_updated_at();

DROP TRIGGER IF EXISTS trg_project_host_updated_at ON project_host;
DROP FUNCTION IF EXISTS set_project_host_updated_at();

DROP TRIGGER IF EXISTS trg_project_repository_updated_at ON project_repository;
DROP FUNCTION IF EXISTS set_project_repository_updated_at();

-- Drop tables in reverse order (children before parents)
DROP TABLE IF EXISTS symphony_notification_rule CASCADE;
DROP TABLE IF EXISTS symphony_orchestrator_config CASCADE;
DROP TABLE IF EXISTS symphony_tool_config CASCADE;
DROP TABLE IF EXISTS project_host CASCADE;
DROP TABLE IF EXISTS project_repository CASCADE;
