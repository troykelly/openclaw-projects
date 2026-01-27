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

-- Make the migration safely re-runnable (useful for dev/test where a prior run may have
-- applied parts of the migration before failing to record the version).
ALTER TABLE work_item
  ADD COLUMN IF NOT EXISTS priority work_item_priority NOT NULL DEFAULT 'P2';

ALTER TABLE work_item
  ADD COLUMN IF NOT EXISTS task_type work_item_task_type NOT NULL DEFAULT 'general';

ALTER TABLE work_item
  ADD COLUMN IF NOT EXISTS not_before timestamptz;

ALTER TABLE work_item
  ADD COLUMN IF NOT EXISTS not_after timestamptz;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'work_item_schedule_window_check'
      AND conrelid = 'work_item'::regclass
  ) THEN
    ALTER TABLE work_item
      ADD CONSTRAINT work_item_schedule_window_check
      CHECK (not_before IS NULL OR not_after IS NULL OR not_before <= not_after);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS work_item_priority_idx ON work_item(priority);
CREATE INDEX IF NOT EXISTS work_item_not_before_idx ON work_item(not_before);
CREATE INDEX IF NOT EXISTS work_item_not_after_idx ON work_item(not_after);
