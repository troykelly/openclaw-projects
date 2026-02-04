-- Migration 044: Add tags to memory table
-- Part of Epic #486, Issue #492
-- Enables structured tag-based filtering alongside semantic search

-- Add tags column (nullable, defaults to empty array)
ALTER TABLE memory ADD COLUMN tags text[] DEFAULT '{}';

-- GIN index for efficient array containment queries (e.g., tags @> ARRAY['music'])
CREATE INDEX idx_memory_tags ON memory USING gin (tags);

-- Update search_vector trigger to include tags in full-text search
CREATE OR REPLACE FUNCTION memory_search_vector_update()
RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.content, '')), 'B') ||
    setweight(to_tsvector('english', array_to_string(coalesce(NEW.tags, '{}'), ' ')), 'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Rebuild search vectors for existing rows to pick up the trigger change
-- (tags will be empty for existing rows, but ensures consistency)
UPDATE memory SET updated_at = updated_at;

COMMENT ON COLUMN memory.tags IS 'Freeform text tags for categorical filtering (e.g., music, work, food)';
