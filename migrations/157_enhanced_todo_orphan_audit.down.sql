-- Rollback: Issue #2290, #2291

-- Remove orphan audit trigger
DROP TRIGGER IF EXISTS work_item_orphan_audit ON work_item;
DROP FUNCTION IF EXISTS log_orphan_to_triage();

-- Note: Cannot remove enum value 'parent_removed' from work_item_activity_type

-- Remove updated_at trigger
DROP TRIGGER IF EXISTS work_item_todo_updated_at ON work_item_todo;
DROP FUNCTION IF EXISTS update_todo_updated_at();

-- Remove namespace sync trigger
DROP TRIGGER IF EXISTS work_item_todo_namespace_sync ON work_item_todo;
DROP FUNCTION IF EXISTS sync_todo_namespace();

-- Drop indexes
DROP INDEX IF EXISTS idx_work_item_todo_sort;
DROP INDEX IF EXISTS idx_work_item_todo_namespace;

-- Drop constraints
ALTER TABLE work_item_todo DROP CONSTRAINT IF EXISTS work_item_todo_namespace_check;
ALTER TABLE work_item_todo DROP CONSTRAINT IF EXISTS work_item_todo_text_not_empty;
ALTER TABLE work_item_todo DROP CONSTRAINT IF EXISTS work_item_todo_date_order;

-- Drop new columns
ALTER TABLE work_item_todo
  DROP COLUMN IF EXISTS updated_at,
  DROP COLUMN IF EXISTS namespace,
  DROP COLUMN IF EXISTS priority,
  DROP COLUMN IF EXISTS not_after,
  DROP COLUMN IF EXISTS not_before,
  DROP COLUMN IF EXISTS sort_order;
