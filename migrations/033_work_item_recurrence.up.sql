-- Issue #217: Add recurrence support to work items

-- Add recurrence columns to work_item table
ALTER TABLE work_item
  ADD COLUMN IF NOT EXISTS recurrence_rule text;  -- RRULE format string

ALTER TABLE work_item
  ADD COLUMN IF NOT EXISTS recurrence_end timestamptz;  -- Optional end date for recurrence

ALTER TABLE work_item
  ADD COLUMN IF NOT EXISTS recurrence_parent_id uuid REFERENCES work_item(id) ON DELETE SET NULL;  -- Template reference

ALTER TABLE work_item
  ADD COLUMN IF NOT EXISTS is_recurrence_template boolean NOT NULL DEFAULT false;

-- Index for finding recurrence templates
CREATE INDEX IF NOT EXISTS work_item_recurrence_template_idx
  ON work_item(is_recurrence_template)
  WHERE is_recurrence_template = true;

-- Index for finding instances of a template
CREATE INDEX IF NOT EXISTS work_item_recurrence_parent_idx
  ON work_item(recurrence_parent_id)
  WHERE recurrence_parent_id IS NOT NULL;

-- Function to validate RRULE format (basic validation)
CREATE OR REPLACE FUNCTION validate_rrule(rule text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  -- Basic validation: must start with RRULE: or be a valid RRULE component
  IF rule IS NULL THEN
    RETURN true;
  END IF;

  -- Allow both RRULE: prefix and without
  IF rule LIKE 'RRULE:%' OR rule LIKE 'FREQ=%' THEN
    -- Check for required FREQ component
    IF rule ~* 'FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)' THEN
      RETURN true;
    END IF;
  END IF;

  RETURN false;
END;
$$;

-- Add constraint for valid RRULE format
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'work_item_valid_rrule_check'
      AND conrelid = 'work_item'::regclass
  ) THEN
    ALTER TABLE work_item
      ADD CONSTRAINT work_item_valid_rrule_check
      CHECK (validate_rrule(recurrence_rule));
  END IF;
END $$;

-- Templates should not have a parent
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'work_item_template_no_parent_check'
      AND conrelid = 'work_item'::regclass
  ) THEN
    ALTER TABLE work_item
      ADD CONSTRAINT work_item_template_no_parent_check
      CHECK (NOT (is_recurrence_template = true AND recurrence_parent_id IS NOT NULL));
  END IF;
END $$;

-- Instances should have a parent if they came from a template
-- (This is a soft rule - we don't enforce it because instances can become standalone after editing)

COMMENT ON COLUMN work_item.recurrence_rule IS 'RRULE format string (RFC 5545) defining the recurrence pattern';
COMMENT ON COLUMN work_item.recurrence_end IS 'Optional end date/time for the recurrence series';
COMMENT ON COLUMN work_item.recurrence_parent_id IS 'Reference to the parent template work item';
COMMENT ON COLUMN work_item.is_recurrence_template IS 'True if this item is a recurrence template (not shown in normal lists)';
