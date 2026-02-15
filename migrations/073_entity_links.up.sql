-- Issue #1276: Entity linking for outbound actions
--
-- Generic many-to-many entity link table so outbound actions (sent SMS,
-- emails, calls) can be associated with projects, contacts, and todos.

CREATE TABLE IF NOT EXISTS entity_link (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type     text NOT NULL,
  source_id       uuid NOT NULL,
  target_type     text NOT NULL,
  target_id       uuid NOT NULL,
  link_type       text NOT NULL DEFAULT 'related',
  created_by      text,
  user_email      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_entity_link UNIQUE (source_type, source_id, target_type, target_id, link_type)
);

CREATE INDEX IF NOT EXISTS idx_entity_link_source ON entity_link (source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_entity_link_target ON entity_link (target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_entity_link_user_email ON entity_link (user_email);

COMMENT ON TABLE entity_link IS 'Generic entity-to-entity links for tracking outbound actions and cross-entity relationships';
COMMENT ON COLUMN entity_link.source_type IS 'Source entity type: message, thread, memory, todo, project_event';
COMMENT ON COLUMN entity_link.target_type IS 'Target entity type: project, contact, todo, memory';
COMMENT ON COLUMN entity_link.link_type IS 'Relationship kind: related, caused_by, resulted_in, about';
COMMENT ON COLUMN entity_link.created_by IS 'Creator identifier: auto, agent, or user_email';
