DROP TRIGGER IF EXISTS audit_api_memory_delete ON api_memory;
DROP TRIGGER IF EXISTS audit_api_memory_update ON api_memory;
DROP TRIGGER IF EXISTS audit_api_memory_insert ON api_memory;
DROP FUNCTION IF EXISTS audit_api_memory_change;
DROP TRIGGER IF EXISTS api_memory_search_vector_trigger ON api_memory;
DROP FUNCTION IF EXISTS api_memory_search_vector_update;
DROP TABLE IF EXISTS api_memory;
