-- Issue #53: Canonical hierarchy semantics (Initiative/Epic/Issue)

DROP TRIGGER IF EXISTS trg_validate_work_item_hierarchy ON work_item;
DROP FUNCTION IF EXISTS validate_work_item_hierarchy();

ALTER TABLE work_item DROP CONSTRAINT IF EXISTS work_item_kind_check;
ALTER TABLE work_item DROP COLUMN IF EXISTS parent_id;
ALTER TABLE work_item DROP COLUMN IF EXISTS kind;
