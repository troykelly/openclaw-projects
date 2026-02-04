-- Migration 044 down: Remove tags from memory table
-- Reverses Issue #492 changes

-- Drop the GIN index
DROP INDEX IF EXISTS idx_memory_tags;

-- Remove tags column
ALTER TABLE memory DROP COLUMN IF EXISTS tags;

-- Restore original search_vector trigger (without tags)
CREATE OR REPLACE FUNCTION memory_search_vector_update()
RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.content, '')), 'B');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Rebuild search vectors to remove tag content
UPDATE memory SET updated_at = updated_at;
