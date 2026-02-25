DROP TRIGGER IF EXISTS audit_api_credential_delete ON api_credential;
DROP TRIGGER IF EXISTS audit_api_credential_update ON api_credential;
DROP TRIGGER IF EXISTS audit_api_credential_insert ON api_credential;
DROP FUNCTION IF EXISTS audit_api_credential_change;
DROP TABLE IF EXISTS api_credential;
