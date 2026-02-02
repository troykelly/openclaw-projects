-- Rollback embedding settings tables
-- Part of Issue #231

DROP FUNCTION IF EXISTS increment_embedding_usage CASCADE;
DROP FUNCTION IF EXISTS update_embedding_settings_timestamp CASCADE;
DROP TABLE IF EXISTS embedding_usage;
DROP TABLE IF EXISTS embedding_settings;
