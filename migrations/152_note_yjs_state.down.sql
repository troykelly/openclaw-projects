-- Migration 152 DOWN: Remove Yjs CRDT state columns
-- Part of Issue #2256

ALTER TABLE note DROP COLUMN IF EXISTS yjs_state;
ALTER TABLE note DROP COLUMN IF EXISTS last_content_changed_at;
ALTER TABLE note_version DROP COLUMN IF EXISTS is_coalesced;

-- Restore original CHECK constraint
ALTER TABLE note_version DROP CONSTRAINT IF EXISTS note_version_change_type_check;
ALTER TABLE note_version ADD CONSTRAINT note_version_change_type_check
  CHECK (change_type IN ('create', 'edit', 'restore', 'auto_save'));

-- Restore original embedding trigger
CREATE OR REPLACE FUNCTION note_embedding_pending_on_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.title IS DISTINCT FROM NEW.title
     OR OLD.content IS DISTINCT FROM NEW.content THEN
    NEW.embedding_status = 'pending';
    NEW.embedding = NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
