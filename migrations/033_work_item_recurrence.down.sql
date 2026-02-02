-- Issue #217: Rollback recurrence support

-- Drop constraints
ALTER TABLE work_item DROP CONSTRAINT IF EXISTS work_item_template_no_parent_check;
ALTER TABLE work_item DROP CONSTRAINT IF EXISTS work_item_valid_rrule_check;

-- Drop function
DROP FUNCTION IF EXISTS validate_rrule(text);

-- Drop indexes
DROP INDEX IF EXISTS work_item_recurrence_parent_idx;
DROP INDEX IF EXISTS work_item_recurrence_template_idx;

-- Drop columns
ALTER TABLE work_item DROP COLUMN IF EXISTS is_recurrence_template;
ALTER TABLE work_item DROP COLUMN IF EXISTS recurrence_parent_id;
ALTER TABLE work_item DROP COLUMN IF EXISTS recurrence_end;
ALTER TABLE work_item DROP COLUMN IF EXISTS recurrence_rule;
