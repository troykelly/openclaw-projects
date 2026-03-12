-- Issue #2462: Define ON DELETE behavior for superseded_by FK
-- Part of Epic #2426 PR2 Core API
--
-- The superseded_by FK previously had no ON DELETE clause.
-- When the consolidation memory is hard-deleted, the FK becomes a dangling reference.
-- ON DELETE SET NULL: hard-deleting a consolidation memory "un-supersedes" its sources,
-- making them active again rather than leaving orphaned/blocked records.

ALTER TABLE memory
  DROP CONSTRAINT IF EXISTS memory_superseded_by_fkey,
  ADD CONSTRAINT memory_superseded_by_fkey
    FOREIGN KEY (superseded_by)
    REFERENCES memory(id)
    ON DELETE SET NULL;

COMMENT ON CONSTRAINT memory_superseded_by_fkey ON memory IS
  'ON DELETE SET NULL: if the target (consolidation) memory is hard-deleted, sources have superseded_by reset to NULL and may become active again.';
