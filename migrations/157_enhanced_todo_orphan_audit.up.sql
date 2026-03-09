-- Issue #2290: Enhance work_item_todo with sort_order, dates, priority, namespace, updated_at
-- Issue #2291: Add orphan-to-triage audit trail trigger

-- ============================================================
-- STEP 1: Enhance work_item_todo table
-- ============================================================
ALTER TABLE work_item_todo
  ADD COLUMN IF NOT EXISTS sort_order BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM now())::bigint,
  ADD COLUMN IF NOT EXISTS not_before TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS not_after TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS priority work_item_priority DEFAULT 'P2',
  ADD COLUMN IF NOT EXISTS namespace TEXT NOT NULL DEFAULT 'default',
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- ============================================================
-- STEP 2: Constraints on work_item_todo
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'work_item_todo_date_order'
  ) THEN
    ALTER TABLE work_item_todo
      ADD CONSTRAINT work_item_todo_date_order
      CHECK (not_before IS NULL OR not_after IS NULL OR not_before <= not_after);
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'work_item_todo_text_not_empty'
  ) THEN
    ALTER TABLE work_item_todo
      ADD CONSTRAINT work_item_todo_text_not_empty
      CHECK (length(trim(text)) > 0);
  END IF;
END;
$$;

-- Add namespace CHECK constraint matching the pattern from migration 090
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'work_item_todo'::regclass
      AND conname = 'work_item_todo_namespace_check'
  ) THEN
    ALTER TABLE work_item_todo
      ADD CONSTRAINT work_item_todo_namespace_check
      CHECK (namespace ~ '^[a-z0-9][a-z0-9._-]*$' AND length(namespace) <= 63);
  END IF;
END;
$$;

-- ============================================================
-- STEP 3: Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_work_item_todo_namespace ON work_item_todo(namespace);
CREATE INDEX IF NOT EXISTS idx_work_item_todo_sort ON work_item_todo(work_item_id, sort_order);

-- ============================================================
-- STEP 4: Namespace sync trigger — auto-set namespace from parent work_item
-- ============================================================
CREATE OR REPLACE FUNCTION sync_todo_namespace()
RETURNS TRIGGER AS $$
BEGIN
  SELECT namespace INTO NEW.namespace
  FROM work_item WHERE id = NEW.work_item_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS work_item_todo_namespace_sync ON work_item_todo;
CREATE TRIGGER work_item_todo_namespace_sync
  BEFORE INSERT OR UPDATE OF work_item_id ON work_item_todo
  FOR EACH ROW
  EXECUTE FUNCTION sync_todo_namespace();

-- ============================================================
-- STEP 4b: Cascade namespace changes from work_item to work_item_todo
-- When a work_item's namespace changes, propagate to all its todos
-- ============================================================
CREATE OR REPLACE FUNCTION cascade_work_item_namespace_to_todos()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.namespace IS DISTINCT FROM NEW.namespace THEN
    UPDATE work_item_todo
    SET namespace = NEW.namespace
    WHERE work_item_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS work_item_namespace_cascade_todos ON work_item;
CREATE TRIGGER work_item_namespace_cascade_todos
  AFTER UPDATE OF namespace ON work_item
  FOR EACH ROW
  EXECUTE FUNCTION cascade_work_item_namespace_to_todos();

-- ============================================================
-- STEP 5: updated_at auto-update trigger
-- Reuses existing update_updated_at_column() if available, else creates it
-- ============================================================
CREATE OR REPLACE FUNCTION update_todo_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS work_item_todo_updated_at ON work_item_todo;
CREATE TRIGGER work_item_todo_updated_at
  BEFORE UPDATE ON work_item_todo
  FOR EACH ROW
  EXECUTE FUNCTION update_todo_updated_at();

-- ============================================================
-- STEP 6: Backfill namespace for existing todos
-- ============================================================
UPDATE work_item_todo t
SET namespace = w.namespace
FROM work_item w
WHERE t.work_item_id = w.id
  AND t.namespace = 'default'
  AND w.namespace <> 'default';

-- ============================================================
-- STEP 7: Add 'parent_removed' to work_item_activity_type enum (#2291)
-- ============================================================
ALTER TYPE work_item_activity_type ADD VALUE IF NOT EXISTS 'parent_removed';

-- ============================================================
-- STEP 8: Orphan-to-triage audit trail trigger (#2291)
-- Fires when parent_work_item_id changes from non-null to null
-- ============================================================
CREATE OR REPLACE FUNCTION log_orphan_to_triage()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO work_item_activity (
    work_item_id, activity_type, description, actor_email, created_at
  ) VALUES (
    NEW.id,
    'parent_removed',
    format('Parent work item removed — item moved to triage (was under %s)', OLD.parent_work_item_id),
    'system',
    now()
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS work_item_orphan_audit ON work_item;
CREATE TRIGGER work_item_orphan_audit
  AFTER UPDATE OF parent_work_item_id ON work_item
  FOR EACH ROW
  WHEN (OLD.parent_work_item_id IS NOT NULL AND NEW.parent_work_item_id IS NULL)
  EXECUTE FUNCTION log_orphan_to_triage();
