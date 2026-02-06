-- Migration 050: Skill Store Item Schema
-- Part of Epic #794, Issue #795
-- Creates persistent state storage for OpenClaw skills

-- ============================================================================
-- ENUM TYPE
-- ============================================================================

CREATE TYPE skill_store_item_status AS ENUM ('active', 'archived', 'processing');

-- ============================================================================
-- SKILL_STORE_ITEM TABLE
-- ============================================================================
-- Namespaced, searchable, embeddable key-value-plus-document store for skills.
-- Scoped by (skill_id, collection, key) — different from the memory table which
-- is scoped by (user_email, work_item_id, contact_id).

CREATE TABLE IF NOT EXISTS skill_store_item (
  id uuid PRIMARY KEY DEFAULT new_uuid(),

  -- Namespacing: skill_id + collection + optional key
  skill_id text NOT NULL,
  collection text NOT NULL DEFAULT '_default',
  key text,  -- nullable; when set, enables upsert on (skill_id, collection, key)

  -- Content
  title text,
  summary text,
  content text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Media
  media_url text,
  media_type text,
  source_url text,

  -- Classification
  status skill_store_item_status NOT NULL DEFAULT 'active',
  tags text[] NOT NULL DEFAULT '{}',
  priority integer DEFAULT 0,

  -- Lifecycle
  expires_at timestamptz,
  pinned boolean NOT NULL DEFAULT false,

  -- Embeddings (1024 dimensions, same as memory table)
  embedding vector(1024),
  embedding_model text,
  embedding_provider text,
  embedding_status text DEFAULT 'pending' CHECK (embedding_status IN ('complete', 'pending', 'failed')),

  -- Full-text search
  search_vector tsvector,

  -- Multi-user isolation: when set, items are scoped to a specific user
  user_email text,

  -- Attribution
  created_by text,

  -- Soft delete (consistent with work_item/notes pattern from migration 035)
  deleted_at timestamptz,

  -- Timestamps
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- Constraints
  CONSTRAINT skill_store_item_data_size CHECK (octet_length(data::text) <= 1048576)
);

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Partial unique index for key-based upsert (excludes soft-deleted items)
CREATE UNIQUE INDEX idx_skill_store_item_skill_collection_key
  ON skill_store_item (skill_id, collection, key)
  WHERE key IS NOT NULL AND deleted_at IS NULL;

-- Primary lookup patterns
CREATE INDEX idx_skill_store_item_skill_collection
  ON skill_store_item (skill_id, collection);

CREATE INDEX idx_skill_store_item_skill_key
  ON skill_store_item (skill_id, key)
  WHERE key IS NOT NULL;

-- Status filtering
CREATE INDEX idx_skill_store_item_status
  ON skill_store_item (status);

-- TTL cleanup (find expired items efficiently)
CREATE INDEX idx_skill_store_item_expires
  ON skill_store_item (expires_at)
  WHERE expires_at IS NOT NULL AND pinned = false AND deleted_at IS NULL;

-- Tag filtering (GIN for array containment queries)
CREATE INDEX idx_skill_store_item_tags
  ON skill_store_item USING gin (tags);

-- JSONB queries (GIN with jsonb_path_ops for containment queries)
CREATE INDEX idx_skill_store_item_data
  ON skill_store_item USING gin (data jsonb_path_ops);

-- Chronological listing
CREATE INDEX idx_skill_store_item_created_at
  ON skill_store_item (created_at DESC);

-- Priority ordering
CREATE INDEX idx_skill_store_item_priority
  ON skill_store_item (priority DESC)
  WHERE deleted_at IS NULL;

-- Full-text search
CREATE INDEX idx_skill_store_item_search_vector
  ON skill_store_item USING gin (search_vector);

-- Semantic search (HNSW cosine similarity, same params as memory table)
CREATE INDEX idx_skill_store_item_embedding
  ON skill_store_item USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Embedding backfill (find items needing embedding)
CREATE INDEX idx_skill_store_item_embedding_status
  ON skill_store_item (embedding_status)
  WHERE embedding_status != 'complete';

-- Multi-user isolation
CREATE INDEX idx_skill_store_item_user_email
  ON skill_store_item (user_email)
  WHERE user_email IS NOT NULL;

-- Soft delete filtering
CREATE INDEX idx_skill_store_item_deleted_at
  ON skill_store_item (deleted_at)
  WHERE deleted_at IS NOT NULL;

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Auto-update search_vector from title + summary + content
CREATE OR REPLACE FUNCTION skill_store_item_search_vector_update()
RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.summary, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW.content, '')), 'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER skill_store_item_search_vector_trigger
  BEFORE INSERT OR UPDATE ON skill_store_item
  FOR EACH ROW EXECUTE FUNCTION skill_store_item_search_vector_update();

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_skill_store_item_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER skill_store_item_updated_at_trigger
  BEFORE UPDATE ON skill_store_item
  FOR EACH ROW EXECUTE FUNCTION update_skill_store_item_updated_at();

-- ============================================================================
-- TTL CLEANUP (pgcron)
-- ============================================================================

-- Batched cleanup of expired items (runs every 15 minutes)
-- Deletes up to 5000 expired, non-pinned items per invocation to avoid long locks
CREATE OR REPLACE FUNCTION skill_store_cleanup_expired()
RETURNS integer AS $$
DECLARE
  v_total_deleted integer := 0;
  v_batch_deleted integer;
BEGIN
  LOOP
    DELETE FROM skill_store_item
    WHERE id IN (
      SELECT id FROM skill_store_item
      WHERE expires_at IS NOT NULL
        AND expires_at < now()
        AND pinned = false
        AND deleted_at IS NULL
      LIMIT 1000
    );
    GET DIAGNOSTICS v_batch_deleted = ROW_COUNT;
    v_total_deleted := v_total_deleted + v_batch_deleted;

    -- Stop after 5000 rows or when no more expired items
    EXIT WHEN v_batch_deleted = 0 OR v_total_deleted >= 5000;
  END LOOP;

  RETURN v_total_deleted;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION skill_store_cleanup_expired IS 'Batched cleanup of expired skill store items (max 5000 per invocation)';

-- Purge soft-deleted items older than 30 days (runs daily)
CREATE OR REPLACE FUNCTION skill_store_purge_soft_deleted()
RETURNS integer AS $$
DECLARE
  v_total_deleted integer := 0;
  v_batch_deleted integer;
BEGIN
  LOOP
    DELETE FROM skill_store_item
    WHERE id IN (
      SELECT id FROM skill_store_item
      WHERE deleted_at IS NOT NULL
        AND deleted_at < now() - interval '30 days'
      LIMIT 1000
    );
    GET DIAGNOSTICS v_batch_deleted = ROW_COUNT;
    v_total_deleted := v_total_deleted + v_batch_deleted;

    EXIT WHEN v_batch_deleted = 0 OR v_total_deleted >= 5000;
  END LOOP;

  RETURN v_total_deleted;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION skill_store_purge_soft_deleted IS 'Permanently removes soft-deleted skill store items older than 30 days';

-- Register pgcron jobs (idempotent)
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'skill_store_cleanup_expired') THEN
    PERFORM cron.schedule(
      'skill_store_cleanup_expired',
      '*/15 * * * *',
      $cmd$SELECT skill_store_cleanup_expired();$cmd$
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'skill_store_purge_soft_deleted') THEN
    PERFORM cron.schedule(
      'skill_store_purge_soft_deleted',
      '0 3 * * *',
      $cmd$SELECT skill_store_purge_soft_deleted();$cmd$
    );
  END IF;
END $do$;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE skill_store_item IS 'Persistent state storage for OpenClaw skills — namespaced key-value-plus-document store';
COMMENT ON COLUMN skill_store_item.skill_id IS 'Self-declared skill identifier (alphanumeric, hyphens, underscores)';
COMMENT ON COLUMN skill_store_item.collection IS 'Logical grouping within a skill (e.g., "articles", "config")';
COMMENT ON COLUMN skill_store_item.key IS 'Optional unique key for upsert semantics within (skill_id, collection)';
COMMENT ON COLUMN skill_store_item.data IS 'Structured JSONB payload (max 1MB). Schema varies by skill.';
COMMENT ON COLUMN skill_store_item.user_email IS 'Optional user scope for multi-user skills. NULL = shared across all users.';
COMMENT ON COLUMN skill_store_item.expires_at IS 'TTL expiration — auto-cleaned by pgcron job every 15 minutes';
COMMENT ON COLUMN skill_store_item.pinned IS 'Pinned items survive TTL cleanup';
COMMENT ON COLUMN skill_store_item.deleted_at IS 'Soft delete timestamp. NULL = active. Purged after 30 days.';
