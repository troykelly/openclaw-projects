-- Migration 091 DOWN: Restore user_email scoping columns (Epic #1418, Phase 4 rollback)
-- NOTE: No explicit BEGIN/COMMIT — the migration runner wraps each file in a transaction.

-- Drop replacement indexes
DROP INDEX IF EXISTS idx_notebook_namespace_not_deleted;
DROP INDEX IF EXISTS idx_note_namespace_not_deleted;
DROP INDEX IF EXISTS idx_note_namespace_pinned;

-- Drop views before modifying tables
DROP VIEW IF EXISTS work_item_active CASCADE;
DROP VIEW IF EXISTS work_item_trash CASCADE;
DROP VIEW IF EXISTS contact_active CASCADE;
DROP VIEW IF EXISTS contact_trash CASCADE;
DROP VIEW IF EXISTS note_active CASCADE;
DROP VIEW IF EXISTS note_trash CASCADE;
DROP VIEW IF EXISTS notebook_active CASCADE;
DROP VIEW IF EXISTS notebook_trash CASCADE;
DROP VIEW IF EXISTS note_with_references CASCADE;

-- Restore user_email columns (nullable, since data is lost on drop)
ALTER TABLE work_item ADD COLUMN IF NOT EXISTS user_email text;
ALTER TABLE contact ADD COLUMN IF NOT EXISTS user_email text;
ALTER TABLE contact_endpoint ADD COLUMN IF NOT EXISTS user_email text;
ALTER TABLE relationship ADD COLUMN IF NOT EXISTS user_email text;
ALTER TABLE external_thread ADD COLUMN IF NOT EXISTS user_email text;
ALTER TABLE external_message ADD COLUMN IF NOT EXISTS user_email text;
ALTER TABLE notebook ADD COLUMN IF NOT EXISTS user_email text;
ALTER TABLE note ADD COLUMN IF NOT EXISTS user_email text;
ALTER TABLE recipe ADD COLUMN IF NOT EXISTS user_email text;
ALTER TABLE meal_log ADD COLUMN IF NOT EXISTS user_email text;
ALTER TABLE pantry_item ADD COLUMN IF NOT EXISTS user_email text;
ALTER TABLE entity_link ADD COLUMN IF NOT EXISTS user_email text;
ALTER TABLE skill_store_item ADD COLUMN IF NOT EXISTS user_email text;
ALTER TABLE memory ADD COLUMN IF NOT EXISTS user_email text;

-- Restore indexes
CREATE INDEX IF NOT EXISTS idx_work_item_user_email ON work_item(user_email);
CREATE INDEX IF NOT EXISTS idx_contact_user_email ON contact(user_email);
CREATE INDEX IF NOT EXISTS idx_contact_endpoint_user_email ON contact_endpoint(user_email);
CREATE INDEX IF NOT EXISTS idx_relationship_user_email ON relationship(user_email);
CREATE INDEX IF NOT EXISTS idx_external_thread_user_email ON external_thread(user_email);
CREATE INDEX IF NOT EXISTS idx_external_message_user_email ON external_message(user_email);
CREATE INDEX IF NOT EXISTS idx_notebook_user_email ON notebook(user_email);
CREATE INDEX IF NOT EXISTS idx_notebook_user_not_deleted ON notebook(user_email) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_note_user_email ON note(user_email);
CREATE INDEX IF NOT EXISTS idx_note_user_not_deleted ON note(user_email) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_note_pinned ON note(user_email, is_pinned) WHERE is_pinned = true;
CREATE INDEX IF NOT EXISTS idx_recipe_user_email ON recipe(user_email);
CREATE INDEX IF NOT EXISTS idx_meal_log_user_email ON meal_log(user_email);
CREATE INDEX IF NOT EXISTS idx_pantry_item_user_email ON pantry_item(user_email);
CREATE INDEX IF NOT EXISTS idx_entity_link_user_email ON entity_link(user_email);
CREATE INDEX IF NOT EXISTS idx_skill_store_item_user_email ON skill_store_item(user_email);
CREATE INDEX IF NOT EXISTS idx_memory_user_email ON memory(user_email);

-- Recreate views (now with user_email columns restored)
CREATE OR REPLACE VIEW work_item_active AS
SELECT * FROM work_item WHERE deleted_at IS NULL;

CREATE OR REPLACE VIEW work_item_trash AS
SELECT * FROM work_item WHERE deleted_at IS NOT NULL;

CREATE OR REPLACE VIEW contact_active AS
SELECT * FROM contact WHERE deleted_at IS NULL;

CREATE OR REPLACE VIEW contact_trash AS
SELECT * FROM contact WHERE deleted_at IS NOT NULL;

CREATE OR REPLACE VIEW note_active AS
SELECT * FROM note WHERE deleted_at IS NULL;

CREATE OR REPLACE VIEW note_trash AS
SELECT * FROM note WHERE deleted_at IS NOT NULL;

CREATE OR REPLACE VIEW notebook_active AS
SELECT * FROM notebook WHERE deleted_at IS NULL;

CREATE OR REPLACE VIEW notebook_trash AS
SELECT * FROM notebook WHERE deleted_at IS NOT NULL;

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

-- Restore original user_can_access_note() that uses note.user_email
CREATE OR REPLACE FUNCTION user_can_access_note(
  p_note_id uuid,
  p_user_email text,
  p_required_permission text DEFAULT 'read'
) RETURNS boolean AS $$
DECLARE
  v_note RECORD;
  v_has_access boolean := false;
BEGIN
  SELECT n.user_email, n.visibility, n.notebook_id, n.deleted_at
  INTO v_note
  FROM note n
  WHERE n.id = p_note_id;

  IF v_note IS NULL OR v_note.deleted_at IS NOT NULL THEN
    RETURN false;
  END IF;

  IF v_note.user_email = p_user_email THEN
    RETURN true;
  END IF;

  IF v_note.visibility = 'public' AND p_required_permission = 'read' THEN
    RETURN true;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM note_share ns
    WHERE ns.note_id = p_note_id
      AND ns.shared_with_email = p_user_email
      AND (ns.expires_at IS NULL OR ns.expires_at > NOW())
      AND (
        p_required_permission = 'read'
        OR ns.permission = 'read_write'
      )
  ) INTO v_has_access;

  IF v_has_access THEN
    RETURN true;
  END IF;

  IF v_note.notebook_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM notebook_share nbs
      WHERE nbs.notebook_id = v_note.notebook_id
        AND nbs.shared_with_email = p_user_email
        AND (nbs.expires_at IS NULL OR nbs.expires_at > NOW())
        AND (
          p_required_permission = 'read'
          OR nbs.permission = 'read_write'
        )
    ) INTO v_has_access;
  END IF;

  RETURN v_has_access;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION user_can_access_note IS 'Check if user has specified permission on note via ownership, direct share, or notebook share';

-- Remove deprecation comments
COMMENT ON TABLE note_share IS NULL;
COMMENT ON TABLE notebook_share IS NULL;
