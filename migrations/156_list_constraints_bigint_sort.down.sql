-- Rollback: Issue #2289, #2305

-- Remove list embedding trigger
DROP TRIGGER IF EXISTS trg_skip_list_embedding ON work_item;
DROP FUNCTION IF EXISTS skip_list_embedding();

-- Revert sort_order back to integer
-- WARNING: This will fail if any sort_order values exceed INT4_MAX (2,147,483,647).
-- In that case, first UPDATE rows with sort_order > 2147483647 to bring them in range.
-- Must drop and recreate views that reference sort_order (same as up migration)
DROP VIEW IF EXISTS work_item_active;
DROP VIEW IF EXISTS work_item_trash;

ALTER TABLE work_item ALTER COLUMN sort_order TYPE integer;
ALTER TABLE work_item ALTER COLUMN sort_order SET DEFAULT EXTRACT(EPOCH FROM now())::integer;

CREATE OR REPLACE VIEW work_item_active AS
  SELECT * FROM work_item WHERE deleted_at IS NULL;

CREATE OR REPLACE VIEW work_item_trash AS
  SELECT * FROM work_item WHERE deleted_at IS NOT NULL;

-- Drop partial indexes
DROP INDEX IF EXISTS idx_work_item_triage;
DROP INDEX IF EXISTS idx_work_item_list;

-- Drop list CHECK constraint
ALTER TABLE work_item DROP CONSTRAINT IF EXISTS work_item_list_no_parent;
