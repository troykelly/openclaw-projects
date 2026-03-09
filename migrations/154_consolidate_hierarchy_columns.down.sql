-- Rollback: Issue #2285, #2286 consolidation + namespace guard

-- Remove sync trigger
DROP TRIGGER IF EXISTS trg_a_sync_work_item_columns ON work_item;
DROP FUNCTION IF EXISTS sync_work_item_columns();

-- Restore original hierarchy trigger from migration 059
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

    -- Cycle detection
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

DROP TRIGGER IF EXISTS trg_validate_work_item_hierarchy ON work_item;
CREATE TRIGGER trg_validate_work_item_hierarchy
  BEFORE INSERT OR UPDATE OF kind, parent_id
  ON work_item
  FOR EACH ROW
  EXECUTE FUNCTION validate_work_item_hierarchy();

-- Restore original kind constraint
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
