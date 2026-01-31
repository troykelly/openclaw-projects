-- Issue #53: Canonical hierarchy semantics (Initiative/Epic/Issue)

ALTER TABLE work_item
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'issue',
  ADD COLUMN IF NOT EXISTS parent_id uuid NULL REFERENCES work_item(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'work_item_kind_check'
  ) THEN
    ALTER TABLE work_item
      ADD CONSTRAINT work_item_kind_check
      CHECK (kind IN ('initiative', 'epic', 'issue'));
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS work_item_parent_id_idx ON work_item(parent_id);

-- Validate hierarchy on write:
-- - initiative: parent_id must be NULL
-- - epic: parent must be initiative
-- - issue: parent may be epic OR NULL (to allow existing standalone tasks)
-- - no cycles
CREATE OR REPLACE FUNCTION validate_work_item_hierarchy() RETURNS trigger AS $$
DECLARE
  parent_kind text;
  found_cycle boolean;
BEGIN
  -- Initiative must not have a parent.
  IF NEW.kind = 'initiative' AND NEW.parent_id IS NOT NULL THEN
    RAISE EXCEPTION 'initiative cannot have parent';
  END IF;

  -- Epics must have an initiative parent.
  -- Note: parent_id is ON DELETE SET NULL, so deleting an initiative with epics will be rejected
  -- until epics are reparented or deleted.
  IF NEW.kind = 'epic' AND NEW.parent_id IS NULL THEN
    RAISE EXCEPTION 'epic requires initiative parent';
  END IF;

  -- If parent is specified, validate parent kind.
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
    -- If inserting and NEW.id is NULL, skip (will be set by default).
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
