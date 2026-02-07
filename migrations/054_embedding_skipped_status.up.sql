-- Migration 054: Add 'skipped' to skill_store_item embedding_status
-- Part of Epic #794, Issue #830
--
-- Fixes: Items with no embeddable content (no title/summary/content) get
-- embedding_status='skipped' to prevent infinite backfill re-enqueue.

-- Drop old CHECK constraint and add new one including 'skipped'
ALTER TABLE skill_store_item
  DROP CONSTRAINT IF EXISTS skill_store_item_embedding_status_check;

ALTER TABLE skill_store_item
  ADD CONSTRAINT skill_store_item_embedding_status_check
  CHECK (embedding_status IN ('complete', 'pending', 'failed', 'skipped'));

COMMENT ON COLUMN skill_store_item.embedding_status
  IS 'Embedding status: complete, pending, failed, or skipped (no embeddable content)';
