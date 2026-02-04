-- Migration 046: Add relationship_id scope to memory table
-- Part of Epic #486, Issue #493
-- Allows memories to be scoped to specific relationships (e.g., "Troy and Alex's anniversary is March 15").

-- ============================================================================
-- ADD COLUMN
-- ============================================================================

ALTER TABLE memory ADD COLUMN IF NOT EXISTS relationship_id uuid REFERENCES relationship(id) ON DELETE SET NULL;

COMMENT ON COLUMN memory.relationship_id IS 'Optional relationship scope. Memories about interpersonal links: anniversaries, communication preferences between people, relationship milestones.';

-- ============================================================================
-- INDEX
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_memory_relationship_id ON memory (relationship_id) WHERE relationship_id IS NOT NULL;
