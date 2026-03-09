-- Rollback: Issue #2289, #2305

-- Remove list embedding trigger
DROP TRIGGER IF EXISTS trg_skip_list_embedding ON work_item;
DROP FUNCTION IF EXISTS skip_list_embedding();

-- Revert sort_order back to integer
ALTER TABLE work_item ALTER COLUMN sort_order TYPE integer;
ALTER TABLE work_item ALTER COLUMN sort_order SET DEFAULT EXTRACT(EPOCH FROM now())::integer;

-- Drop partial indexes
DROP INDEX IF EXISTS idx_work_item_triage;
DROP INDEX IF EXISTS idx_work_item_list;

-- Drop list CHECK constraint
ALTER TABLE work_item DROP CONSTRAINT IF EXISTS work_item_list_no_parent;
