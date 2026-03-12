-- Rollback for Issue #2462
-- Restores superseded_by FK without ON DELETE clause (no explicit behavior = restrict by default).

ALTER TABLE memory
  DROP CONSTRAINT IF EXISTS memory_superseded_by_fkey,
  ADD CONSTRAINT memory_superseded_by_fkey
    FOREIGN KEY (superseded_by)
    REFERENCES memory(id);
