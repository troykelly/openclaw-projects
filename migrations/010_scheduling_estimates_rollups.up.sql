-- Issue #28: Scheduling estimates, hierarchy rollups, next-actionable query

DO $$ BEGIN
  CREATE TYPE work_item_kind AS ENUM ('project', 'initiative', 'epic', 'issue');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE work_item
  ADD COLUMN IF NOT EXISTS work_item_kind work_item_kind NOT NULL DEFAULT 'issue';

ALTER TABLE work_item
  ADD COLUMN IF NOT EXISTS parent_work_item_id uuid REFERENCES work_item(id) ON DELETE SET NULL;

ALTER TABLE work_item
  ADD COLUMN IF NOT EXISTS estimate_minutes integer;

ALTER TABLE work_item
  ADD COLUMN IF NOT EXISTS actual_minutes integer;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'work_item_parent_not_self_check'
      AND conrelid = 'work_item'::regclass
  ) THEN
    ALTER TABLE work_item
      ADD CONSTRAINT work_item_parent_not_self_check
      CHECK (parent_work_item_id IS NULL OR parent_work_item_id <> id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'work_item_estimate_minutes_check'
      AND conrelid = 'work_item'::regclass
  ) THEN
    ALTER TABLE work_item
      ADD CONSTRAINT work_item_estimate_minutes_check
      CHECK (estimate_minutes IS NULL OR (estimate_minutes >= 0 AND estimate_minutes <= 525600));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'work_item_actual_minutes_check'
      AND conrelid = 'work_item'::regclass
  ) THEN
    ALTER TABLE work_item
      ADD CONSTRAINT work_item_actual_minutes_check
      CHECK (actual_minutes IS NULL OR (actual_minutes >= 0 AND actual_minutes <= 525600));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS work_item_parent_idx ON work_item(parent_work_item_id);
CREATE INDEX IF NOT EXISTS work_item_kind_idx ON work_item(work_item_kind);

CREATE OR REPLACE VIEW work_item_descendants AS
WITH RECURSIVE tree AS (
  SELECT wi.id as root_id, wi.id as descendant_id
    FROM work_item wi
  UNION ALL
  SELECT t.root_id, child.id as descendant_id
    FROM tree t
    JOIN work_item child ON child.parent_work_item_id = t.descendant_id
)
SELECT root_id, descendant_id
  FROM tree;

CREATE OR REPLACE VIEW work_item_rollup_project AS
SELECT root.id as work_item_id,
       root.title as title,
       SUM(COALESCE(wi.estimate_minutes, 0))::int as total_estimate_minutes,
       SUM(COALESCE(wi.actual_minutes, 0))::int as total_actual_minutes
  FROM work_item_descendants d
  JOIN work_item root ON root.id = d.root_id
  JOIN work_item wi ON wi.id = d.descendant_id
 WHERE root.work_item_kind = 'project'
 GROUP BY root.id, root.title;

CREATE OR REPLACE VIEW work_item_rollup_initiative AS
SELECT root.id as work_item_id,
       root.title as title,
       SUM(COALESCE(wi.estimate_minutes, 0))::int as total_estimate_minutes,
       SUM(COALESCE(wi.actual_minutes, 0))::int as total_actual_minutes
  FROM work_item_descendants d
  JOIN work_item root ON root.id = d.root_id
  JOIN work_item wi ON wi.id = d.descendant_id
 WHERE root.work_item_kind = 'initiative'
 GROUP BY root.id, root.title;

CREATE OR REPLACE VIEW work_item_rollup_epic AS
SELECT root.id as work_item_id,
       root.title as title,
       SUM(COALESCE(wi.estimate_minutes, 0))::int as total_estimate_minutes,
       SUM(COALESCE(wi.actual_minutes, 0))::int as total_actual_minutes
  FROM work_item_descendants d
  JOIN work_item root ON root.id = d.root_id
  JOIN work_item wi ON wi.id = d.descendant_id
 WHERE root.work_item_kind = 'epic'
 GROUP BY root.id, root.title;

CREATE OR REPLACE VIEW work_item_rollup_issue AS
SELECT root.id as work_item_id,
       root.title as title,
       SUM(COALESCE(wi.estimate_minutes, 0))::int as total_estimate_minutes,
       SUM(COALESCE(wi.actual_minutes, 0))::int as total_actual_minutes
  FROM work_item_descendants d
  JOIN work_item root ON root.id = d.root_id
  JOIN work_item wi ON wi.id = d.descendant_id
 WHERE root.work_item_kind = 'issue'
 GROUP BY root.id, root.title;

CREATE OR REPLACE FUNCTION work_item_next_actionable_at(as_of timestamptz DEFAULT now())
RETURNS TABLE (
  id uuid,
  title text,
  status text,
  priority work_item_priority,
  task_type work_item_task_type,
  not_before timestamptz,
  not_after timestamptz,
  estimate_minutes integer,
  actual_minutes integer
)
LANGUAGE sql
STABLE
AS $$
  SELECT wi.id,
         wi.title,
         wi.status,
         wi.priority,
         wi.task_type,
         wi.not_before,
         wi.not_after,
         wi.estimate_minutes,
         wi.actual_minutes
    FROM work_item wi
   WHERE lower(wi.status) NOT IN ('done', 'completed', 'closed')
     AND (wi.not_before IS NULL OR wi.not_before <= as_of)
     AND (wi.not_after IS NULL OR wi.not_after >= as_of)
     AND NOT EXISTS (
       SELECT 1
         FROM work_item_dependency dep
         JOIN work_item blocker ON blocker.id = dep.depends_on_work_item_id
        WHERE dep.work_item_id = wi.id
          AND lower(blocker.status) NOT IN ('done', 'completed', 'closed')
     )
   ORDER BY wi.priority ASC,
            COALESCE(wi.not_after, 'infinity'::timestamptz) ASC,
            COALESCE(wi.not_before, 'infinity'::timestamptz) ASC,
            wi.created_at ASC;
$$;

CREATE OR REPLACE VIEW work_item_next_actionable AS
SELECT *
  FROM work_item_next_actionable_at(now());
