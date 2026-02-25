-- API Source: tracks onboarded OpenAPI-documented APIs.
-- Part of API Onboarding feature.

CREATE TABLE api_source (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  namespace   text NOT NULL DEFAULT 'default',
  name        text NOT NULL,
  description text,
  spec_url    text,
  servers     jsonb NOT NULL DEFAULT '[]',
  spec_version text,
  spec_hash   text,
  tags        text[] NOT NULL DEFAULT '{}',
  refresh_interval_seconds integer,
  last_fetched_at timestamptz,
  status      text NOT NULL DEFAULT 'active',
  error_message text,
  created_by_agent text,
  deleted_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_api_source_namespace ON api_source (namespace);
CREATE INDEX idx_api_source_status ON api_source (status) WHERE deleted_at IS NULL;
CREATE INDEX idx_api_source_deleted_at ON api_source (deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX idx_api_source_spec_url ON api_source (spec_url) WHERE spec_url IS NOT NULL;
CREATE INDEX idx_api_source_tags ON api_source USING gin (tags);

-- Audit trigger (same pattern as work_item/contact/memory)
CREATE OR REPLACE FUNCTION audit_api_source_change() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO audit_log (id, actor_type, action, entity_type, entity_id, changes)
    VALUES (uuidv7(), 'system', 'create', 'api_source', NEW.id,
            jsonb_build_object('new', to_jsonb(NEW)));
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO audit_log (id, actor_type, action, entity_type, entity_id, changes)
    VALUES (uuidv7(), 'system', 'update', 'api_source', NEW.id,
            jsonb_build_object('old', to_jsonb(OLD), 'new', to_jsonb(NEW)));
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO audit_log (id, actor_type, action, entity_type, entity_id, changes)
    VALUES (uuidv7(), 'system', 'delete', 'api_source', OLD.id,
            jsonb_build_object('old', to_jsonb(OLD)));
    RETURN OLD;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_api_source_insert AFTER INSERT ON api_source
  FOR EACH ROW EXECUTE FUNCTION audit_api_source_change();
CREATE TRIGGER audit_api_source_update AFTER UPDATE ON api_source
  FOR EACH ROW EXECUTE FUNCTION audit_api_source_change();
CREATE TRIGGER audit_api_source_delete AFTER DELETE ON api_source
  FOR EACH ROW EXECUTE FUNCTION audit_api_source_change();

-- Junction table: link API sources to work items
CREATE TABLE api_source_link (
  api_source_id uuid NOT NULL REFERENCES api_source(id) ON DELETE CASCADE,
  work_item_id  uuid NOT NULL REFERENCES work_item(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (api_source_id, work_item_id)
);
