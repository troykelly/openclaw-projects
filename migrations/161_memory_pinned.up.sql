-- Migration 161: Add pinned column to memory table
-- Issue #2380 — Support pinned/priority memories for automatic context injection
--
-- Allows agents to mark memories as "pinned" so they are always surfaced during
-- session startup, replacing the old MEMORY.md file-based pattern.

ALTER TABLE memory ADD COLUMN IF NOT EXISTS pinned boolean NOT NULL DEFAULT false;

-- Index for efficient retrieval of pinned memories per namespace
CREATE INDEX IF NOT EXISTS idx_memory_pinned
  ON memory (namespace, pinned) WHERE pinned = true;

COMMENT ON COLUMN memory.pinned
  IS 'When true, this memory is always included in context injection regardless of semantic similarity.';
