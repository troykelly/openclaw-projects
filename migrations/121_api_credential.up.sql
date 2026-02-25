-- API Credential: stores auth headers needed to call onboarded APIs.
-- resolve_reference is encrypted at rest via AES-256-GCM (same as OAuth tokens).
-- Audit trigger redacts resolve_reference to prevent secret leakage.

CREATE TABLE api_credential (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  api_source_id     uuid NOT NULL REFERENCES api_source(id) ON DELETE CASCADE,
  purpose           text NOT NULL DEFAULT 'api_call',
  header_name       text NOT NULL,
  header_prefix     text,
  resolve_strategy  text NOT NULL,
  resolve_reference text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT api_credential_purpose_check
    CHECK (purpose IN ('api_call', 'spec_fetch')),
  CONSTRAINT api_credential_strategy_check
    CHECK (resolve_strategy IN ('literal', 'env', 'file', 'command'))
);

CREATE INDEX idx_api_credential_source ON api_credential (api_source_id);
CREATE INDEX idx_api_credential_purpose ON api_credential (api_source_id, purpose);

-- Audit trigger with resolve_reference redaction
CREATE OR REPLACE FUNCTION audit_api_credential_change() RETURNS trigger AS $$
DECLARE
  old_redacted jsonb;
  new_redacted jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    new_redacted := to_jsonb(NEW);
    new_redacted := jsonb_set(new_redacted, '{resolve_reference}', '"[REDACTED]"');
    INSERT INTO audit_log (id, actor_type, action, entity_type, entity_id, changes)
    VALUES (uuidv7(), 'system', 'create', 'api_credential', NEW.id,
            jsonb_build_object('new', new_redacted));
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    old_redacted := to_jsonb(OLD);
    old_redacted := jsonb_set(old_redacted, '{resolve_reference}', '"[REDACTED]"');
    new_redacted := to_jsonb(NEW);
    new_redacted := jsonb_set(new_redacted, '{resolve_reference}', '"[REDACTED]"');
    INSERT INTO audit_log (id, actor_type, action, entity_type, entity_id, changes)
    VALUES (uuidv7(), 'system', 'update', 'api_credential', NEW.id,
            jsonb_build_object('old', old_redacted, 'new', new_redacted));
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    old_redacted := to_jsonb(OLD);
    old_redacted := jsonb_set(old_redacted, '{resolve_reference}', '"[REDACTED]"');
    INSERT INTO audit_log (id, actor_type, action, entity_type, entity_id, changes)
    VALUES (uuidv7(), 'system', 'delete', 'api_credential', OLD.id,
            jsonb_build_object('old', old_redacted));
    RETURN OLD;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_api_credential_insert AFTER INSERT ON api_credential
  FOR EACH ROW EXECUTE FUNCTION audit_api_credential_change();
CREATE TRIGGER audit_api_credential_update AFTER UPDATE ON api_credential
  FOR EACH ROW EXECUTE FUNCTION audit_api_credential_change();
CREATE TRIGGER audit_api_credential_delete AFTER DELETE ON api_credential
  FOR EACH ROW EXECUTE FUNCTION audit_api_credential_change();
