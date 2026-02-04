-- Migration 046 Down: Remove relationship_id scope from memory table
-- Part of Epic #486, Issue #493

DROP INDEX IF EXISTS idx_memory_relationship_id;
ALTER TABLE memory DROP COLUMN IF EXISTS relationship_id;
