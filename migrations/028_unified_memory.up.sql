-- Migration 028: Unified Memory System
-- Part of Epic #199, Issue #209
-- Redesigns memory system for flexible scoping and agent attribution

-- Extend memory_type enum with new types
DO $$ BEGIN
  ALTER TYPE memory_type ADD VALUE 'preference' BEFORE 'note';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE memory_type ADD VALUE 'fact' BEFORE 'note';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Create new unified memory table with flexible scoping
CREATE TABLE IF NOT EXISTS memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Flexible scoping (all nullable - at least one scope should be set)
  user_email text,           -- User this memory belongs to (global scope)
  work_item_id uuid REFERENCES work_item(id) ON DELETE SET NULL,
  contact_id uuid REFERENCES contact(id) ON DELETE SET NULL,

  -- Content
  title text NOT NULL,
  content text NOT NULL,
  memory_type memory_type NOT NULL DEFAULT 'note',

  -- Embeddings for semantic search (1024 dimensions to match work_item_memory)
  embedding vector(1024),
  embedding_model text,
  embedding_provider text,
  embedding_status text DEFAULT 'pending' CHECK (embedding_status IN ('complete', 'pending', 'failed')),

  -- Attribution
  created_by_agent text,     -- Which agent created this? (e.g., "openclaw-pi")
  created_by_human boolean DEFAULT false,
  source_url text,           -- External reference if applicable

  -- Importance and validity
  importance integer DEFAULT 5 CHECK (importance BETWEEN 1 AND 10),
  confidence float DEFAULT 1.0 CHECK (confidence BETWEEN 0 AND 1),
  expires_at timestamptz,    -- For temporary context
  superseded_by uuid,        -- Points to newer memory that replaces this

  -- Full-text search
  search_vector tsvector,

  -- Timestamps
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Add foreign key for superseded_by after table creation
ALTER TABLE memory
  ADD CONSTRAINT fk_memory_superseded_by
  FOREIGN KEY (superseded_by) REFERENCES memory(id) ON DELETE SET NULL;

-- Indexes for flexible scoping
CREATE INDEX idx_memory_user_email ON memory(user_email) WHERE user_email IS NOT NULL;
CREATE INDEX idx_memory_work_item_id ON memory(work_item_id) WHERE work_item_id IS NOT NULL;
CREATE INDEX idx_memory_contact_id ON memory(contact_id) WHERE contact_id IS NOT NULL;
CREATE INDEX idx_memory_type ON memory(memory_type);
CREATE INDEX idx_memory_created_by_agent ON memory(created_by_agent) WHERE created_by_agent IS NOT NULL;
CREATE INDEX idx_memory_expires_at ON memory(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX idx_memory_superseded_by ON memory(superseded_by) WHERE superseded_by IS NOT NULL;
CREATE INDEX idx_memory_created_at ON memory(created_at DESC);

-- Index for semantic search (using different name to avoid conflict with work_item_memory index)
CREATE INDEX idx_unified_memory_embedding ON memory USING hnsw (embedding vector_cosine_ops) WHERE embedding IS NOT NULL;

-- Index for finding memories by embedding status (for backfill operations)
CREATE INDEX idx_unified_memory_embedding_status ON memory(embedding_status) WHERE embedding_status != 'complete';

-- Index for full-text search
CREATE INDEX idx_memory_search_vector ON memory USING gin(search_vector);

-- Trigger to update search_vector
CREATE OR REPLACE FUNCTION memory_search_vector_update()
RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.content, '')), 'B');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER memory_search_vector_trigger
  BEFORE INSERT OR UPDATE ON memory
  FOR EACH ROW EXECUTE FUNCTION memory_search_vector_update();

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_memory_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER memory_updated_at_trigger
  BEFORE UPDATE ON memory
  FOR EACH ROW EXECUTE FUNCTION update_memory_updated_at();

-- Migrate data from work_item_memory to memory
INSERT INTO memory (
  id,
  work_item_id,
  title,
  content,
  memory_type,
  embedding,
  embedding_model,
  embedding_provider,
  embedding_status,
  created_at,
  updated_at
)
SELECT
  id,
  work_item_id,
  title,
  content,
  memory_type,
  embedding,
  embedding_model,
  embedding_provider,
  embedding_status,
  created_at,
  updated_at
FROM work_item_memory
ON CONFLICT (id) DO NOTHING;

-- Update memory_relationship to reference new memory table
-- First drop existing constraints
ALTER TABLE memory_relationship DROP CONSTRAINT IF EXISTS memory_relationship_memory_id_fkey;
ALTER TABLE memory_relationship DROP CONSTRAINT IF EXISTS memory_relationship_related_memory_id_fkey;

-- Add new constraints referencing memory table
ALTER TABLE memory_relationship
  ADD CONSTRAINT memory_relationship_memory_id_fkey
  FOREIGN KEY (memory_id) REFERENCES memory(id) ON DELETE CASCADE;
ALTER TABLE memory_relationship
  ADD CONSTRAINT memory_relationship_related_memory_id_fkey
  FOREIGN KEY (related_memory_id) REFERENCES memory(id) ON DELETE CASCADE;

-- Update memory_contact to reference new memory table
ALTER TABLE memory_contact DROP CONSTRAINT IF EXISTS memory_contact_memory_id_fkey;
ALTER TABLE memory_contact
  ADD CONSTRAINT memory_contact_memory_id_fkey
  FOREIGN KEY (memory_id) REFERENCES memory(id) ON DELETE CASCADE;

-- Add comments for documentation
COMMENT ON TABLE memory IS 'Unified memory store with flexible scoping (global, work_item, contact, or combinations)';
COMMENT ON COLUMN memory.user_email IS 'Owner of this memory. When set alone, memory is global scope.';
COMMENT ON COLUMN memory.work_item_id IS 'Optional work item scope. Can be combined with user_email.';
COMMENT ON COLUMN memory.contact_id IS 'Optional contact scope. Can be combined with user_email and/or work_item_id.';
COMMENT ON COLUMN memory.created_by_agent IS 'Agent ID that created this memory (e.g., openclaw-pi)';
COMMENT ON COLUMN memory.importance IS 'Importance score 1-10, higher = more important for retrieval';
COMMENT ON COLUMN memory.confidence IS 'Confidence score 0-1, lower = uncertain/unverified';
COMMENT ON COLUMN memory.expires_at IS 'When set, memory auto-expires and should be cleaned up';
COMMENT ON COLUMN memory.superseded_by IS 'When set, points to newer memory that replaces this one';
