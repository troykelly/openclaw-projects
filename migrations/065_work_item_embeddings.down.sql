-- Rollback: Remove embedding support from work_item
-- Part of Issue #1216

DROP INDEX IF EXISTS idx_work_item_embedding_status;
DROP INDEX IF EXISTS idx_work_item_embedding;

ALTER TABLE work_item
  DROP COLUMN IF EXISTS embedding_status,
  DROP COLUMN IF EXISTS embedding_provider,
  DROP COLUMN IF EXISTS embedding_model,
  DROP COLUMN IF EXISTS embedding;
