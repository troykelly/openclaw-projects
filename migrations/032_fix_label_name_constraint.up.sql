-- Issue #221: Fix label name constraint
-- Removes the UNIQUE constraint on label.name (should only be on normalized_name)

DO $$ BEGIN
  ALTER TABLE label DROP CONSTRAINT IF EXISTS label_name_key;
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;
