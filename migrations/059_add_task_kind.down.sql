-- Issue #1135: Rollback - Remove 'task' as a valid work_item kind

-- NOTE: Removing an enum value from PostgreSQL is complex and requires recreating the type.
-- For safety, we'll only update the constraint and leave the enum value.
-- If work_items with kind='task' exist, they will remain valid but cannot be created after rollback.

-- Restore original constraint (project/initiative/epic/issue only)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'work_item_kind_check'
  ) THEN
    ALTER TABLE work_item DROP CONSTRAINT work_item_kind_check;
  END IF;

  ALTER TABLE work_item
    ADD CONSTRAINT work_item_kind_check
    CHECK (kind IN ('project', 'initiative', 'epic', 'issue'));
END;
$$;

-- To fully remove 'task' from work_item_kind enum (if needed):
-- 1. Update all work_items with kind='task' to 'issue' (or another valid value)
-- 2. Create new enum without 'task': CREATE TYPE work_item_kind_new AS ENUM (...)
-- 3. ALTER TABLE work_item ALTER COLUMN work_item_kind TYPE work_item_kind_new USING work_item_kind::text::work_item_kind_new
-- 4. DROP TYPE work_item_kind CASCADE
-- 5. ALTER TYPE work_item_kind_new RENAME TO work_item_kind
-- This is complex and risky, so we skip it for now.

-- Restore original hierarchy validation function (project/initiative/epic/issue)
CREATE OR REPLACE FUNCTION validate_work_item_hierarchy() RETURNS trigger AS $$
DECLARE
  parent_kind text;
  found_cycle boolean;
BEGIN
  -- Project must not have a parent.
  IF NEW.kind = 'project' AND NEW.parent_id IS NOT NULL THEN
    RAISE EXCEPTION 'project cannot have parent';
  END IF;

  -- Initiative may be top-level or under a project.
  IF NEW.kind = 'initiative' AND NEW.parent_id IS NOT NULL THEN
    SELECT kind INTO parent_kind FROM work_item WHERE id = NEW.parent_id;
    IF parent_kind IS NULL THEN
      RAISE EXCEPTION 'parent does not exist';
    END IF;
    IF parent_kind <> 'project' THEN
      RAISE EXCEPTION 'initiative parent must be project';
    END IF;
  END IF;

  -- Epics must have an initiative parent.
  IF NEW.kind = 'epic' AND NEW.parent_id IS NULL THEN
    RAISE EXCEPTION 'epic requires initiative parent';
  END IF;

  -- Validate parent kind when specified.
  IF NEW.parent_id IS NOT NULL THEN
    SELECT kind INTO parent_kind FROM work_item WHERE id = NEW.parent_id;

    IF parent_kind IS NULL THEN
      RAISE EXCEPTION 'parent does not exist';
    END IF;

    IF NEW.kind = 'epic' AND parent_kind <> 'initiative' THEN
      RAISE EXCEPTION 'epic parent must be initiative';
    END IF;

    IF NEW.kind = 'issue' AND parent_kind <> 'epic' THEN
      RAISE EXCEPTION 'issue parent must be epic';
    END IF;

    -- Cycle detection: ensure NEW.id is not reachable from NEW.parent_id.
    IF NEW.id IS NOT NULL THEN
      WITH RECURSIVE ancestors AS (
        SELECT id, parent_id FROM work_item WHERE id = NEW.parent_id
        UNION ALL
        SELECT w.id, w.parent_id
          FROM work_item w
          JOIN ancestors a ON a.parent_id = w.id
      )
      SELECT EXISTS(SELECT 1 FROM ancestors WHERE id = NEW.id) INTO found_cycle;

      IF found_cycle THEN
        RAISE EXCEPTION 'cycle detected in work_item hierarchy';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
