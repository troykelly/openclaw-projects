-- ============================================================
-- Down migration 143: Remove Symphony infrastructure tables
-- Reverse of 143_symphony_infra_tables.up.sql
-- Epic #2186 — Symphony Orchestration, Issue #2192
-- ============================================================

-- Drop triggers and functions
DROP TRIGGER IF EXISTS trg_symphony_circuit_breaker_updated_at ON symphony_circuit_breaker;
DROP FUNCTION IF EXISTS set_symphony_circuit_breaker_updated_at();

DROP TRIGGER IF EXISTS trg_symphony_github_rate_limit_updated_at ON symphony_github_rate_limit;
DROP FUNCTION IF EXISTS set_symphony_github_rate_limit_updated_at();

DROP TRIGGER IF EXISTS trg_symphony_orchestrator_heartbeat_updated_at ON symphony_orchestrator_heartbeat;
DROP FUNCTION IF EXISTS set_symphony_orchestrator_heartbeat_updated_at();

DROP TRIGGER IF EXISTS trg_symphony_secret_deployment_updated_at ON symphony_secret_deployment;
DROP FUNCTION IF EXISTS set_symphony_secret_deployment_updated_at();

DROP TRIGGER IF EXISTS trg_symphony_cleanup_item_updated_at ON symphony_cleanup_item;
DROP FUNCTION IF EXISTS set_symphony_cleanup_item_updated_at();

DROP TRIGGER IF EXISTS trg_symphony_container_updated_at ON symphony_container;
DROP FUNCTION IF EXISTS set_symphony_container_updated_at();

-- Drop tables in reverse order
DROP TABLE IF EXISTS symphony_circuit_breaker CASCADE;
DROP TABLE IF EXISTS symphony_github_rate_limit CASCADE;
DROP TABLE IF EXISTS symphony_orchestrator_heartbeat CASCADE;
DROP TABLE IF EXISTS symphony_secret_deployment CASCADE;
DROP TABLE IF EXISTS symphony_cleanup_item CASCADE;
DROP TABLE IF EXISTS symphony_container CASCADE;
