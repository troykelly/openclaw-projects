-- Migration 040: Notes and Notebooks Schema
-- Part of Epic #337, Issue #340
-- Creates foundation for full-featured note-taking system

-- ============================================================================
-- NOTEBOOK TABLE
-- ============================================================================
-- Hierarchical containers for organizing notes

CREATE TABLE IF NOT EXISTS notebook (
  id uuid PRIMARY KEY DEFAULT new_uuid(),
  user_email text NOT NULL,

  -- Content
  name text NOT NULL,
  description text,
  icon text,  -- emoji or icon identifier (e.g., "📓", "work")
  color text, -- hex color for UI (e.g., "#3b82f6")

  -- Organization
  parent_notebook_id uuid REFERENCES notebook(id) ON DELETE SET NULL,
  sort_order integer DEFAULT 0,

  -- Settings
  is_archived boolean DEFAULT false,

  -- Soft delete
  deleted_at timestamptz,

  -- Timestamps
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE notebook IS 'Hierarchical containers for organizing notes';
COMMENT ON COLUMN notebook.icon IS 'Emoji or icon identifier for visual display';
COMMENT ON COLUMN notebook.color IS 'Hex color code (e.g., #3b82f6) for UI theming';
COMMENT ON COLUMN notebook.parent_notebook_id IS 'Self-referential FK for nested notebooks';

-- ============================================================================
-- NOTE TABLE
-- ============================================================================
-- Rich markdown notes with privacy controls and search integration

CREATE TABLE IF NOT EXISTS note (
  id uuid PRIMARY KEY DEFAULT new_uuid(),
  notebook_id uuid REFERENCES notebook(id) ON DELETE SET NULL,
  user_email text NOT NULL,

  -- Content
  title text NOT NULL,
  content text NOT NULL DEFAULT '', -- markdown content
  summary text,          -- AI-generated or manual summary for previews

  -- Metadata
  tags text[] DEFAULT '{}',
  is_pinned boolean DEFAULT false,
  sort_order integer DEFAULT 0,

  -- Privacy (critical for agent access control)
  visibility text NOT NULL DEFAULT 'private'
    CHECK (visibility IN ('private', 'shared', 'public')),
  hide_from_agents boolean DEFAULT false, -- explicit agent exclusion even if shared/public

  -- Search - pgvector for semantic, tsvector for full-text
  embedding vector(1024),
  embedding_model text,
  embedding_provider text,
  embedding_status text DEFAULT 'pending'
    CHECK (embedding_status IN ('complete', 'pending', 'failed', 'skipped')),
  search_vector tsvector,

  -- Soft delete
  deleted_at timestamptz,

  -- Timestamps
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE note IS 'Rich markdown notes with privacy controls and search integration';
COMMENT ON COLUMN note.visibility IS 'private=owner only, shared=explicit shares, public=anyone';
COMMENT ON COLUMN note.hide_from_agents IS 'When true, note excluded from agent searches even if shared/public';
COMMENT ON COLUMN note.embedding_status IS 'skipped means privacy settings prevent embedding';

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Notebook indexes
CREATE INDEX IF NOT EXISTS idx_notebook_user_email ON notebook(user_email);
CREATE INDEX IF NOT EXISTS idx_notebook_parent ON notebook(parent_notebook_id) WHERE parent_notebook_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notebook_user_not_deleted ON notebook(user_email) WHERE deleted_at IS NULL;

-- Note indexes for common queries
CREATE INDEX IF NOT EXISTS idx_note_notebook_id ON note(notebook_id) WHERE notebook_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_note_user_email ON note(user_email);
CREATE INDEX IF NOT EXISTS idx_note_visibility ON note(visibility);
CREATE INDEX IF NOT EXISTS idx_note_user_not_deleted ON note(user_email) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_note_created_at ON note(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_note_updated_at ON note(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_note_pinned ON note(user_email, is_pinned) WHERE is_pinned = true;

-- Tag search (GIN for array containment)
CREATE INDEX IF NOT EXISTS idx_note_tags ON note USING GIN(tags);

-- Full-text search
CREATE INDEX IF NOT EXISTS idx_note_search_vector ON note USING GIN(search_vector);

-- Semantic search (HNSW for fast approximate nearest neighbor)
CREATE INDEX IF NOT EXISTS idx_note_embedding ON note USING hnsw (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL;

-- Embedding backfill query optimization
CREATE INDEX IF NOT EXISTS idx_note_embedding_pending ON note(embedding_status)
  WHERE embedding_status = 'pending';

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Auto-update notebook updated_at timestamp
CREATE OR REPLACE FUNCTION update_notebook_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS notebook_updated_at_trigger ON notebook;
CREATE TRIGGER notebook_updated_at_trigger
  BEFORE UPDATE ON notebook
  FOR EACH ROW EXECUTE FUNCTION update_notebook_updated_at();

-- Auto-update note updated_at timestamp
CREATE OR REPLACE FUNCTION update_note_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS note_updated_at_trigger ON note;
CREATE TRIGGER note_updated_at_trigger
  BEFORE UPDATE ON note
  FOR EACH ROW EXECUTE FUNCTION update_note_updated_at();

-- Auto-update search_vector for full-text search
CREATE OR REPLACE FUNCTION note_search_vector_update()
RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', COALESCE(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(NEW.summary, '')), 'B') ||
    setweight(to_tsvector('english', COALESCE(NEW.content, '')), 'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS note_search_vector_trigger ON note;
CREATE TRIGGER note_search_vector_trigger
  BEFORE INSERT OR UPDATE OF title, summary, content ON note
  FOR EACH ROW EXECUTE FUNCTION note_search_vector_update();

-- Mark embedding as pending when content changes
CREATE OR REPLACE FUNCTION note_embedding_pending_on_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.title IS DISTINCT FROM NEW.title
     OR OLD.content IS DISTINCT FROM NEW.content THEN
    NEW.embedding_status = 'pending';
    NEW.embedding = NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS note_embedding_pending_trigger ON note;
CREATE TRIGGER note_embedding_pending_trigger
  BEFORE UPDATE OF title, content ON note
  FOR EACH ROW EXECUTE FUNCTION note_embedding_pending_on_change();

-- ============================================================================
-- VIEWS
-- ============================================================================

-- Active views (exclude soft-deleted)
CREATE OR REPLACE VIEW note_active AS
SELECT * FROM note WHERE deleted_at IS NULL;

CREATE OR REPLACE VIEW notebook_active AS
SELECT * FROM notebook WHERE deleted_at IS NULL;

-- Trash views (soft-deleted items)
CREATE OR REPLACE VIEW note_trash AS
SELECT * FROM note WHERE deleted_at IS NOT NULL;

CREATE OR REPLACE VIEW notebook_trash AS
SELECT * FROM notebook WHERE deleted_at IS NOT NULL;
