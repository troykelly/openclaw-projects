-- Issue #2462: Define ON DELETE behavior for superseded_by FK
-- Part of Epic #2426 PR2 Core API
--
-- The superseded_by FK previously had no ON DELETE clause (migration 028 created
-- fk_memory_superseded_by without ON DELETE, which defaults to RESTRICT/NO ACTION).
-- ON DELETE SET NULL: hard-deleting a consolidation memory "un-supersedes" its sources,
-- making them active again rather than leaving orphaned/blocked records.
--
-- Migration 028 named the constraint fk_memory_superseded_by; we drop both that name
-- and the legacy name memory_superseded_by_fkey (in case either exists) before adding
-- the canonical memory_superseded_by_fkey with ON DELETE SET NULL.

ALTER TABLE memory
  DROP CONSTRAINT IF EXISTS fk_memory_superseded_by,
  DROP CONSTRAINT IF EXISTS memory_superseded_by_fkey,
  ADD CONSTRAINT memory_superseded_by_fkey
    FOREIGN KEY (superseded_by)
    REFERENCES memory(id)
    ON DELETE SET NULL;

COMMENT ON CONSTRAINT memory_superseded_by_fkey ON memory IS
  'ON DELETE SET NULL: if the target (consolidation) memory is hard-deleted, sources have superseded_by reset to NULL and may become active again.';
