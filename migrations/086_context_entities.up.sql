-- Issue #1275: Generic context entities with many-to-many entity linking
-- Context stores reusable prompt/context snippets; context_link is a
-- polymorphic M2M junction linking contexts to arbitrary entity types.

CREATE TABLE IF NOT EXISTS context (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label           text NOT NULL CHECK (length(trim(label)) > 0),
  content         text NOT NULL,
  content_type    text NOT NULL DEFAULT 'text',
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_context_is_active ON context(is_active);
CREATE INDEX IF NOT EXISTS idx_context_created_at ON context(created_at);

CREATE OR REPLACE FUNCTION update_context_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS context_updated_at_trigger ON context;
CREATE TRIGGER context_updated_at_trigger
  BEFORE UPDATE ON context
  FOR EACH ROW EXECUTE FUNCTION update_context_updated_at();

CREATE TABLE IF NOT EXISTS context_link (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  context_id      uuid NOT NULL REFERENCES context(id) ON DELETE CASCADE,
  target_type     text NOT NULL,
  target_id       uuid NOT NULL,
  priority        integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_context_link UNIQUE (context_id, target_type, target_id)
);

CREATE INDEX IF NOT EXISTS idx_context_link_context ON context_link(context_id);
CREATE INDEX IF NOT EXISTS idx_context_link_target ON context_link(target_type, target_id);
