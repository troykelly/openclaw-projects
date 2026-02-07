-- Migration 054: Remove 'skipped' from skill_store_item embedding_status (Rollback)
-- Part of Epic #794, Issue #830

-- Revert any skipped items back to pending before restoring the constraint
UPDATE skill_store_item SET embedding_status = 'pending' WHERE embedding_status = 'skipped';

-- Restore original CHECK constraint
ALTER TABLE skill_store_item
  DROP CONSTRAINT IF EXISTS skill_store_item_embedding_status_check;

ALTER TABLE skill_store_item
  ADD CONSTRAINT skill_store_item_embedding_status_check
  CHECK (embedding_status IN ('complete', 'pending', 'failed'));
