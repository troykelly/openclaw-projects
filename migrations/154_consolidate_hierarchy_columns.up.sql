-- Issue #2285: Consolidate dual hierarchy columns (kind/parent_id vs work_item_kind/parent_work_item_id)
-- Issue #2286: Fix cross-namespace parent linking
-- Issue #2288: Add 'list' to kind CHECK constraint (prep for Phase 1)
--
-- Canonical columns: work_item_kind, parent_work_item_id
-- Legacy columns: kind, parent_id (kept in sync via trigger)

-- ============================================================
-- STEP 1: Ensure existing data is consistent between column pairs
-- ============================================================
UPDATE work_item
SET kind = work_item_kind::text
WHERE kind IS DISTINCT FROM work_item_kind::text;

UPDATE work_item
SET parent_id = parent_work_item_id
WHERE parent_id IS DISTINCT FROM parent_work_item_id;

-- ============================================================
-- STEP 2: Create sync trigger — keeps legacy columns in sync with canonical
-- This fires BEFORE INSERT OR UPDATE so the hierarchy trigger sees consistent data.
-- ============================================================
CREATE OR REPLACE FUNCTION sync_work_item_columns()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- On INSERT: detect which column was explicitly set via defaults
    IF NEW.kind IS DISTINCT FROM NEW.work_item_kind::text THEN
      IF NEW.work_item_kind::text = 'issue' AND NEW.kind <> 'issue' THEN
        NEW.work_item_kind := NEW.kind::work_item_kind;
      ELSE
        NEW.kind := NEW.work_item_kind::text;
      END IF;
    END IF;

    IF NEW.parent_id IS DISTINCT FROM NEW.parent_work_item_id THEN
      IF NEW.parent_work_item_id IS NULL AND NEW.parent_id IS NOT NULL THEN
        NEW.parent_work_item_id := NEW.parent_id;
      ELSE
        NEW.parent_id := NEW.parent_work_item_id;
      END IF;
    END IF;

  ELSE  -- UPDATE
    -- On UPDATE: detect which column actually changed using OLD vs NEW
    IF NEW.kind IS DISTINCT FROM NEW.work_item_kind::text THEN
      IF OLD.kind IS DISTINCT FROM NEW.kind AND OLD.work_item_kind::text IS NOT DISTINCT FROM NEW.work_item_kind::text THEN
        -- Only kind changed
        NEW.work_item_kind := NEW.kind::work_item_kind;
      ELSE
        -- work_item_kind changed (or both changed — prefer canonical)
        NEW.kind := NEW.work_item_kind::text;
      END IF;
    END IF;

    IF NEW.parent_id IS DISTINCT FROM NEW.parent_work_item_id THEN
      IF OLD.parent_id IS DISTINCT FROM NEW.parent_id AND OLD.parent_work_item_id IS NOT DISTINCT FROM NEW.parent_work_item_id THEN
        -- Only parent_id changed
        NEW.parent_work_item_id := NEW.parent_id;
      ELSE
        -- parent_work_item_id changed (or both changed — prefer canonical)
        NEW.parent_id := NEW.parent_work_item_id;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop any existing sync trigger to avoid conflicts
DROP TRIGGER IF EXISTS trg_sync_work_item_columns ON work_item;

-- Fire BEFORE the hierarchy validation trigger (alphabetical ordering of trigger names)
-- trg_a_sync runs before trg_validate_work_item_hierarchy
CREATE TRIGGER trg_a_sync_work_item_columns
  BEFORE INSERT OR UPDATE ON work_item
  FOR EACH ROW
  EXECUTE FUNCTION sync_work_item_columns();

-- ============================================================
-- STEP 3: Update the hierarchy trigger to read from CANONICAL columns
-- Also adds namespace cross-link validation (#2286)
-- Also adds 'list' kind support (#2289 prep — the enum value is added in migration 155)
-- ============================================================
CREATE OR REPLACE FUNCTION validate_work_item_hierarchy() RETURNS trigger AS $$
DECLARE
  parent_kind text;
  parent_namespace text;
  found_cycle boolean;
BEGIN
  -- Project must not have a parent.
  IF NEW.work_item_kind::text = 'project' AND NEW.parent_work_item_id IS NOT NULL THEN
    RAISE EXCEPTION 'project cannot have parent';
  END IF;

  -- List must not have a parent (top-level only).
  IF NEW.work_item_kind::text = 'list' AND NEW.parent_work_item_id IS NOT NULL THEN
    RAISE EXCEPTION 'list cannot have parent';
  END IF;

  -- Initiative may be top-level or under a project.
  IF NEW.work_item_kind::text = 'initiative' AND NEW.parent_work_item_id IS NOT NULL THEN
    SELECT work_item_kind::text INTO parent_kind FROM work_item WHERE id = NEW.parent_work_item_id;
    IF parent_kind IS NULL THEN
      RAISE EXCEPTION 'parent does not exist';
    END IF;
    IF parent_kind <> 'project' THEN
      RAISE EXCEPTION 'initiative parent must be project';
    END IF;
  END IF;

  -- Epics must have an initiative parent.
  IF NEW.work_item_kind::text = 'epic' AND NEW.parent_work_item_id IS NULL THEN
    RAISE EXCEPTION 'epic requires initiative parent';
  END IF;

  -- Validate parent kind when specified.
  IF NEW.parent_work_item_id IS NOT NULL THEN
    SELECT work_item_kind::text, namespace
    INTO parent_kind, parent_namespace
    FROM work_item WHERE id = NEW.parent_work_item_id;

    IF parent_kind IS NULL THEN
      RAISE EXCEPTION 'parent does not exist';
    END IF;

    -- #2286: Cross-namespace parent linking prevention
    IF parent_namespace IS DISTINCT FROM NEW.namespace THEN
      RAISE EXCEPTION 'Parent work item must be in the same namespace (parent: %, child: %)', parent_namespace, NEW.namespace;
    END IF;

    -- No work_item can have a list as parent
    IF parent_kind = 'list' THEN
      RAISE EXCEPTION 'cannot create child under a list';
    END IF;

    IF NEW.work_item_kind::text = 'epic' AND parent_kind <> 'initiative' THEN
      RAISE EXCEPTION 'epic parent must be initiative';
    END IF;

    IF NEW.work_item_kind::text = 'issue' AND parent_kind <> 'epic' THEN
      RAISE EXCEPTION 'issue parent must be epic';
    END IF;

    -- Tasks can have any parent (except list, handled above) - no restriction

    -- Cycle detection: ensure NEW.id is not reachable from NEW.parent_work_item_id.
    IF NEW.id IS NOT NULL THEN
      WITH RECURSIVE ancestors AS (
        SELECT id, parent_work_item_id FROM work_item WHERE id = NEW.parent_work_item_id
        UNION ALL
        SELECT w.id, w.parent_work_item_id
          FROM work_item w
          JOIN ancestors a ON a.parent_work_item_id = w.id
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

-- Recreate the trigger to fire on canonical columns
DROP TRIGGER IF EXISTS trg_validate_work_item_hierarchy ON work_item;
CREATE TRIGGER trg_validate_work_item_hierarchy
  BEFORE INSERT OR UPDATE OF work_item_kind, parent_work_item_id, namespace
  ON work_item
  FOR EACH ROW
  EXECUTE FUNCTION validate_work_item_hierarchy();

-- ============================================================
-- STEP 4: Update kind CHECK constraint to include 'task' and 'list'
-- ============================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'work_item_kind_check'
  ) THEN
    ALTER TABLE work_item DROP CONSTRAINT work_item_kind_check;
  END IF;

  ALTER TABLE work_item
    ADD CONSTRAINT work_item_kind_check
    CHECK (kind IN ('project', 'initiative', 'epic', 'issue', 'task', 'list'));
END;
$$;
