-- API Memory: semantically searchable memories generated from OpenAPI specs.
-- Each row is an operation, tag group, or API overview with a pgvector embedding.

CREATE TABLE api_memory (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  api_source_id     uuid NOT NULL REFERENCES api_source(id) ON DELETE CASCADE,
  namespace         text NOT NULL DEFAULT 'default',
  memory_kind       text NOT NULL,
  operation_key     text NOT NULL,
  title             text NOT NULL,
  content           text NOT NULL,
  metadata          jsonb NOT NULL DEFAULT '{}',
  tags              text[] NOT NULL DEFAULT '{}',
  embedding         vector(1024),
  embedding_model   text,
  embedding_provider text,
  embedding_status  text NOT NULL DEFAULT 'pending',
  search_vector     tsvector,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT api_memory_kind_check
    CHECK (memory_kind IN ('overview', 'tag_group', 'operation')),
  CONSTRAINT api_memory_embedding_status_check
    CHECK (embedding_status IN ('pending', 'complete', 'failed')),
  CONSTRAINT api_memory_unique_key
    UNIQUE (api_source_id, operation_key)
);

-- Indexes
CREATE INDEX idx_api_memory_source ON api_memory (api_source_id);
CREATE INDEX idx_api_memory_namespace ON api_memory (namespace);
CREATE INDEX idx_api_memory_kind ON api_memory (memory_kind);
CREATE INDEX idx_api_memory_tags ON api_memory USING gin (tags);
CREATE INDEX idx_api_memory_embedding_status ON api_memory (embedding_status)
  WHERE embedding_status != 'complete';
CREATE INDEX idx_api_memory_search_vector ON api_memory USING gin (search_vector);

-- HNSW vector index for semantic search (cosine distance)
CREATE INDEX idx_api_memory_embedding ON api_memory
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Auto-update search_vector on insert/update (same pattern as memory table)
CREATE OR REPLACE FUNCTION api_memory_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.content, '')), 'B');
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER api_memory_search_vector_trigger
  BEFORE INSERT OR UPDATE OF title, content ON api_memory
  FOR EACH ROW EXECUTE FUNCTION api_memory_search_vector_update();

-- Audit trigger
CREATE OR REPLACE FUNCTION audit_api_memory_change() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO audit_log (id, actor_type, action, entity_type, entity_id, changes)
    VALUES (uuidv7(), 'system', 'create', 'api_memory', NEW.id,
            jsonb_build_object('new', jsonb_build_object(
              'id', NEW.id, 'api_source_id', NEW.api_source_id,
              'memory_kind', NEW.memory_kind, 'operation_key', NEW.operation_key,
              'title', NEW.title)));
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO audit_log (id, actor_type, action, entity_type, entity_id, changes)
    VALUES (uuidv7(), 'system', 'update', 'api_memory', NEW.id,
            jsonb_build_object(
              'old_title', OLD.title, 'new_title', NEW.title,
              'old_kind', OLD.memory_kind, 'new_kind', NEW.memory_kind));
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO audit_log (id, actor_type, action, entity_type, entity_id, changes)
    VALUES (uuidv7(), 'system', 'delete', 'api_memory', OLD.id,
            jsonb_build_object('old', jsonb_build_object(
              'id', OLD.id, 'api_source_id', OLD.api_source_id,
              'operation_key', OLD.operation_key)));
    RETURN OLD;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_api_memory_insert AFTER INSERT ON api_memory
  FOR EACH ROW EXECUTE FUNCTION audit_api_memory_change();
CREATE TRIGGER audit_api_memory_update AFTER UPDATE ON api_memory
  FOR EACH ROW EXECUTE FUNCTION audit_api_memory_change();
CREATE TRIGGER audit_api_memory_delete AFTER DELETE ON api_memory
  FOR EACH ROW EXECUTE FUNCTION audit_api_memory_change();
