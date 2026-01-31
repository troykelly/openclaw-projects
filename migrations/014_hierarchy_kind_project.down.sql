-- Issue #53: rollback hierarchy kind expansion

-- Restore original constraint (initiative/epic/issue only)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'work_item_kind_check'
  ) THEN
    ALTER TABLE work_item DROP CONSTRAINT work_item_kind_check;
  END IF;

  ALTER TABLE work_item
    ADD CONSTRAINT work_item_kind_check
    CHECK (kind IN ('initiative', 'epic', 'issue'));
END;
$$;

-- Restore original hierarchy validation function (initiative/epic/issue)
CREATE OR REPLACE FUNCTION validate_work_item_hierarchy() RETURNS trigger AS $$
DECLARE
  parent_kind text;
  found_cycle boolean;
BEGIN
  IF NEW.kind = 'initiative' AND NEW.parent_id IS NOT NULL THEN
    RAISE EXCEPTION 'initiative cannot have parent';
  END IF;

  IF NEW.kind = 'epic' AND NEW.parent_id IS NULL THEN
    RAISE EXCEPTION 'epic requires initiative parent';
  END IF;

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
