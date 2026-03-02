-- Rollback Migration 132: Dev Prompts
-- Epic #2011, Issue #2012

DROP TRIGGER IF EXISTS dev_prompt_updated_at ON dev_prompt;
DROP FUNCTION IF EXISTS update_dev_prompt_updated_at();
DROP INDEX IF EXISTS idx_dev_prompt_is_system;
DROP INDEX IF EXISTS idx_dev_prompt_category;
DROP INDEX IF EXISTS idx_dev_prompt_namespace;
DROP INDEX IF EXISTS idx_dev_prompt_ns_key;
DROP TABLE IF EXISTS dev_prompt;
