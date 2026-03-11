-- Down migration 161: Remove pinned column from memory table
-- Issue #2380

DROP INDEX IF EXISTS idx_memory_pinned;
ALTER TABLE memory DROP COLUMN IF EXISTS pinned;
