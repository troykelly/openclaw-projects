-- Issue #4: Priority + task types + scheduling constraints

DO $$ BEGIN
  CREATE TYPE work_item_priority AS ENUM ('P0', 'P1', 'P2', 'P3', 'P4');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE work_item_task_type AS ENUM (
    'general',
    'coding',
    'admin',
    'ops',
    'research',
    'meeting'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE work_item
  ADD COLUMN priority work_item_priority NOT NULL DEFAULT 'P2',
  ADD COLUMN task_type work_item_task_type NOT NULL DEFAULT 'general',
  ADD COLUMN not_before timestamptz,
  ADD COLUMN not_after timestamptz;

ALTER TABLE work_item
  ADD CONSTRAINT work_item_schedule_window_check
  CHECK (not_before IS NULL OR not_after IS NULL OR not_before <= not_after);

CREATE INDEX work_item_priority_idx ON work_item(priority);
CREATE INDEX work_item_not_before_idx ON work_item(not_before);
CREATE INDEX work_item_not_after_idx ON work_item(not_after);
