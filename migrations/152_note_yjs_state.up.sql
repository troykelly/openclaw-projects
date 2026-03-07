-- Migration 152: Add Yjs CRDT state and supporting columns for collaborative editing
-- Part of Issue #2256

-- Add Yjs CRDT state column
ALTER TABLE note ADD COLUMN IF NOT EXISTS yjs_state bytea;

COMMENT ON COLUMN note.yjs_state IS 'Serialized Yjs CRDT document state (compact snapshot). Source of truth for collaborative editing; content column is a derived markdown projection.';

-- Add embedding debounce timestamp
ALTER TABLE note ADD COLUMN IF NOT EXISTS last_content_changed_at timestamptz;

COMMENT ON COLUMN note.last_content_changed_at IS 'Timestamp of last content change, used to debounce embedding regeneration during active editing';

-- Extend note_version change_type CHECK constraint to include yjs_sync
ALTER TABLE note_version DROP CONSTRAINT IF EXISTS note_version_change_type_check;
ALTER TABLE note_version ADD CONSTRAINT note_version_change_type_check
  CHECK (change_type IN ('create', 'edit', 'restore', 'auto_save', 'yjs_sync'));

-- Add version coalescing column (hide intermediate yjs_sync snapshots from UI)
ALTER TABLE note_version ADD COLUMN IF NOT EXISTS is_coalesced boolean DEFAULT false;
COMMENT ON COLUMN note_version.is_coalesced IS 'When true, version is hidden from history UI (intermediate yjs_sync snapshots)';

-- Update embedding trigger to respect skip flag for Yjs persistence writes
CREATE OR REPLACE FUNCTION note_embedding_pending_on_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.title IS DISTINCT FROM NEW.title
     OR OLD.content IS DISTINCT FROM NEW.content THEN
    -- Allow Yjs persistence to skip embedding invalidation via session variable
    IF COALESCE(NULLIF(current_setting('app.skip_embedding_pending', true), ''), 'false') = 'true' THEN
      NEW.last_content_changed_at = NOW();
    ELSE
      NEW.embedding_status = 'pending';
      NEW.embedding = NULL;
      NEW.last_content_changed_at = NOW();
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
