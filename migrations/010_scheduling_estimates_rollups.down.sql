-- Issue #28: Scheduling estimates, hierarchy rollups, next-actionable query (rollback)

DROP VIEW IF EXISTS work_item_next_actionable;
DROP FUNCTION IF EXISTS work_item_next_actionable_at(timestamptz);
DROP VIEW IF EXISTS work_item_rollup_issue;
DROP VIEW IF EXISTS work_item_rollup_epic;
DROP VIEW IF EXISTS work_item_rollup_initiative;
DROP VIEW IF EXISTS work_item_rollup_project;
DROP VIEW IF EXISTS work_item_descendants;

ALTER TABLE work_item DROP CONSTRAINT IF EXISTS work_item_parent_not_self_check;
ALTER TABLE work_item DROP CONSTRAINT IF EXISTS work_item_estimate_minutes_check;
ALTER TABLE work_item DROP CONSTRAINT IF EXISTS work_item_actual_minutes_check;

DROP INDEX IF EXISTS work_item_parent_idx;
DROP INDEX IF EXISTS work_item_kind_idx;

ALTER TABLE work_item DROP COLUMN IF EXISTS parent_work_item_id;
ALTER TABLE work_item DROP COLUMN IF EXISTS work_item_kind;
ALTER TABLE work_item DROP COLUMN IF EXISTS estimate_minutes;
ALTER TABLE work_item DROP COLUMN IF EXISTS actual_minutes;

DROP TYPE IF EXISTS work_item_kind;
