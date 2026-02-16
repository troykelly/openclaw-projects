-- Rollback Issue #1275: context entities
DROP TABLE IF EXISTS context_link;
DROP TRIGGER IF EXISTS context_updated_at_trigger ON context;
DROP FUNCTION IF EXISTS update_context_updated_at();
DROP TABLE IF EXISTS context;
