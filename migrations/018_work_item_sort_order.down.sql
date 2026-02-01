-- Rollback for sort_order column
-- Issue #104

DROP INDEX IF EXISTS idx_work_item_parent_sort_order;
ALTER TABLE work_item DROP COLUMN IF EXISTS sort_order;
