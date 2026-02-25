DROP TABLE IF EXISTS api_source_link;
DROP TRIGGER IF EXISTS audit_api_source_delete ON api_source;
DROP TRIGGER IF EXISTS audit_api_source_update ON api_source;
DROP TRIGGER IF EXISTS audit_api_source_insert ON api_source;
DROP FUNCTION IF EXISTS audit_api_source_change;
DROP TABLE IF EXISTS api_source;
