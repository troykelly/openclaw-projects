-- Issue #221: Restore label name constraint (if needed)
-- Note: This adds back a constraint that may cause issues
ALTER TABLE label ADD CONSTRAINT label_name_key UNIQUE (name);
