-- Migration 043: Note Work Item References
-- Part of Epic #337, Issue #343
-- Creates bidirectional linking between notes and work items

-- ============================================================================
-- NOTE_WORK_ITEM_REFERENCE TABLE
-- ============================================================================
-- Many-to-many relationship between notes and work items

CREATE TABLE IF NOT EXISTS note_work_item_reference (
  id uuid PRIMARY KEY DEFAULT new_uuid(),

  -- The relationship
  note_id uuid NOT NULL REFERENCES note(id) ON DELETE CASCADE,
  work_item_id uuid NOT NULL REFERENCES work_item(id) ON DELETE CASCADE,

  -- Reference metadata
  reference_type text NOT NULL DEFAULT 'related'
    CHECK (reference_type IN ('related', 'documented_by', 'spawned_from', 'meeting_notes')),
  description text,  -- Optional context for the link

  -- Who created the link
  created_by_email text NOT NULL,

  -- Timestamps
  created_at timestamptz NOT NULL DEFAULT now(),

  -- Prevent duplicate references
  UNIQUE(note_id, work_item_id)
);

COMMENT ON TABLE note_work_item_reference IS 'Many-to-many linking between notes and work items';
COMMENT ON COLUMN note_work_item_reference.reference_type IS 'related=general, documented_by=note documents the work, spawned_from=note created from work, meeting_notes=notes from a meeting about work';

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_note_work_item_ref_note ON note_work_item_reference(note_id);
CREATE INDEX IF NOT EXISTS idx_note_work_item_ref_work_item ON note_work_item_reference(work_item_id);
CREATE INDEX IF NOT EXISTS idx_note_work_item_ref_type ON note_work_item_reference(reference_type);

-- ============================================================================
-- VIEWS FOR EASY QUERYING
-- ============================================================================

-- Notes with their referenced work items (forward direction)
CREATE OR REPLACE VIEW note_with_references AS
SELECT
  n.*,
  COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', w.id,
        'title', w.title,
        'kind', w.work_item_kind,
        'status', w.status,
        'referenceType', r.reference_type,
        'createdAt', r.created_at
      ) ORDER BY r.created_at DESC
    ) FILTER (WHERE w.id IS NOT NULL AND w.deleted_at IS NULL),
    '[]'::jsonb
  ) as referenced_work_items
FROM note n
LEFT JOIN note_work_item_reference r ON n.id = r.note_id
LEFT JOIN work_item w ON r.work_item_id = w.id
WHERE n.deleted_at IS NULL
GROUP BY n.id;

COMMENT ON VIEW note_with_references IS 'Notes with aggregated JSONB array of referenced work items';

-- Work items with their referencing notes (backlinks)
CREATE OR REPLACE VIEW work_item_note_backlinks AS
SELECT
  w.id as work_item_id,
  w.title as work_item_title,
  COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', n.id,
        'title', n.title,
        'referenceType', r.reference_type,
        'visibility', n.visibility,
        'createdAt', r.created_at
      ) ORDER BY r.created_at DESC
    ) FILTER (WHERE n.id IS NOT NULL AND n.deleted_at IS NULL),
    '[]'::jsonb
  ) as referencing_notes,
  COUNT(n.id) FILTER (WHERE n.id IS NOT NULL AND n.deleted_at IS NULL)::integer as note_count
FROM work_item w
LEFT JOIN note_work_item_reference r ON w.id = r.work_item_id
LEFT JOIN note n ON r.note_id = n.id
WHERE w.deleted_at IS NULL
GROUP BY w.id, w.title;

COMMENT ON VIEW work_item_note_backlinks IS 'Work items with aggregated JSONB array of referencing notes (backlinks)';
