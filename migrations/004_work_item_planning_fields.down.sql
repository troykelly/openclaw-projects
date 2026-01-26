-- Issue #4 rollback

DROP INDEX IF EXISTS work_item_not_after_idx;
DROP INDEX IF EXISTS work_item_not_before_idx;
DROP INDEX IF EXISTS work_item_priority_idx;

ALTER TABLE work_item DROP CONSTRAINT IF EXISTS work_item_schedule_window_check;

ALTER TABLE work_item
  DROP COLUMN IF EXISTS not_after,
  DROP COLUMN IF EXISTS not_before,
  DROP COLUMN IF EXISTS task_type,
  DROP COLUMN IF EXISTS priority;

DROP TYPE IF EXISTS work_item_task_type;
DROP TYPE IF EXISTS work_item_priority;
