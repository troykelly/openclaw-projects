-- Issue #2289: List kind constraints, indexes, embedding skip
-- Issue #2305: Migrate work_item.sort_order from INTEGER to BIGINT

-- ============================================================
-- STEP 1: CHECK constraint for lists must be top-level
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'work_item_list_no_parent'
  ) THEN
    ALTER TABLE work_item ADD CONSTRAINT work_item_list_no_parent
      CHECK (work_item_kind <> 'list' OR parent_work_item_id IS NULL);
  END IF;
END;
$$;

-- ============================================================
-- STEP 2: Partial indexes for list and triage queries
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_work_item_list
  ON work_item(namespace, deleted_at)
  WHERE work_item_kind = 'list';

CREATE INDEX IF NOT EXISTS idx_work_item_triage
  ON work_item(namespace, deleted_at)
  WHERE parent_work_item_id IS NULL AND work_item_kind = 'issue';

-- ============================================================
-- STEP 3: Migrate sort_order from INTEGER to BIGINT (#2305)
-- Must drop and recreate views that reference sort_order
-- ============================================================
DROP VIEW IF EXISTS work_item_active;
DROP VIEW IF EXISTS work_item_trash;

ALTER TABLE work_item ALTER COLUMN sort_order TYPE bigint;
ALTER TABLE work_item ALTER COLUMN sort_order SET DEFAULT EXTRACT(EPOCH FROM now())::bigint;

-- Recreate the views (simple SELECT * filters)
CREATE OR REPLACE VIEW work_item_active AS
  SELECT * FROM work_item WHERE deleted_at IS NULL;

CREATE OR REPLACE VIEW work_item_trash AS
  SELECT * FROM work_item WHERE deleted_at IS NOT NULL;

-- ============================================================
-- STEP 4: Set embedding_status = 'skipped' for list items via trigger
-- ============================================================
CREATE OR REPLACE FUNCTION skip_list_embedding()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.work_item_kind = 'list' THEN
    NEW.embedding_status := 'skipped';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_skip_list_embedding ON work_item;
CREATE TRIGGER trg_skip_list_embedding
  BEFORE INSERT OR UPDATE OF work_item_kind ON work_item
  FOR EACH ROW
  EXECUTE FUNCTION skip_list_embedding();

-- Set existing lists (if any) to skipped
UPDATE work_item SET embedding_status = 'skipped' WHERE work_item_kind = 'list';
