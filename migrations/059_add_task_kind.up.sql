-- Issue #1135: Add 'task' as a valid work_item kind

-- Add 'task' to the work_item_kind enum (idempotent via exception handling)
-- Pattern matches migration 028 for enum extension
DO $$ BEGIN
  ALTER TYPE work_item_kind ADD VALUE 'task';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Expand kind constraint to include 'task'
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'work_item_kind_check'
  ) THEN
    ALTER TABLE work_item DROP CONSTRAINT work_item_kind_check;
  END IF;

  ALTER TABLE work_item
    ADD CONSTRAINT work_item_kind_check
    CHECK (kind IN ('project', 'initiative', 'epic', 'issue', 'task'));
END;
$$;

-- Update hierarchy validation to allow tasks
-- Tasks can be top-level or have any parent (flexible)
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

    -- Tasks can have any parent - no restriction

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
