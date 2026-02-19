-- Migration 091: Drop user_email scoping columns (Epic #1418, Phase 4)
--
-- Removes user_email from entity tables where it was used ONLY for data access
-- scoping. Columns used for attribution/identity (comments, reactions, presence,
-- notifications, note_version, auth/oauth/geo/dev_session) are retained.
--
-- Prerequisites: All entity routes must be using namespace-based scoping (Phase 3).

-- NOTE: No explicit BEGIN/COMMIT — the migration runner wraps each file in a transaction.

-- 0. Drop views that use SELECT * (they implicitly depend on user_email columns)
DROP VIEW IF EXISTS work_item_active CASCADE;
DROP VIEW IF EXISTS work_item_trash CASCADE;
DROP VIEW IF EXISTS contact_active CASCADE;
DROP VIEW IF EXISTS contact_trash CASCADE;
DROP VIEW IF EXISTS note_active CASCADE;
DROP VIEW IF EXISTS note_trash CASCADE;
DROP VIEW IF EXISTS notebook_active CASCADE;
DROP VIEW IF EXISTS notebook_trash CASCADE;
DROP VIEW IF EXISTS note_with_references CASCADE;

-- 1. Drop user_email indexes (before column drop for clean removal)
DROP INDEX IF EXISTS idx_work_item_user_email;
DROP INDEX IF EXISTS idx_contact_user_email;
DROP INDEX IF EXISTS idx_contact_endpoint_user_email;
DROP INDEX IF EXISTS idx_relationship_user_email;
DROP INDEX IF EXISTS idx_external_thread_user_email;
DROP INDEX IF EXISTS idx_external_message_user_email;
DROP INDEX IF EXISTS idx_notebook_user_email;
DROP INDEX IF EXISTS idx_notebook_user_not_deleted;
DROP INDEX IF EXISTS idx_note_user_email;
DROP INDEX IF EXISTS idx_note_user_not_deleted;
DROP INDEX IF EXISTS idx_note_pinned;
DROP INDEX IF EXISTS idx_recipe_user_email;
DROP INDEX IF EXISTS idx_meal_log_user_email;
DROP INDEX IF EXISTS idx_pantry_item_user_email;
DROP INDEX IF EXISTS idx_entity_link_user_email;
DROP INDEX IF EXISTS idx_skill_store_item_user_email;
DROP INDEX IF EXISTS idx_memory_user_email;

-- 2. Drop user_email columns from entity tables
ALTER TABLE work_item DROP COLUMN IF EXISTS user_email;
ALTER TABLE contact DROP COLUMN IF EXISTS user_email;
ALTER TABLE contact_endpoint DROP COLUMN IF EXISTS user_email;
ALTER TABLE relationship DROP COLUMN IF EXISTS user_email;
ALTER TABLE external_thread DROP COLUMN IF EXISTS user_email;
ALTER TABLE external_message DROP COLUMN IF EXISTS user_email;
ALTER TABLE notebook DROP COLUMN IF EXISTS user_email;
ALTER TABLE note DROP COLUMN IF EXISTS user_email;
ALTER TABLE recipe DROP COLUMN IF EXISTS user_email;
ALTER TABLE meal_log DROP COLUMN IF EXISTS user_email;
ALTER TABLE pantry_item DROP COLUMN IF EXISTS user_email;
ALTER TABLE entity_link DROP COLUMN IF EXISTS user_email;
ALTER TABLE skill_store_item DROP COLUMN IF EXISTS user_email;
ALTER TABLE memory DROP COLUMN IF EXISTS user_email;

-- 3. Recreate views (now without user_email columns)
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

-- 4. Recreate namespace-aware partial indexes to replace user_email-based ones
CREATE INDEX IF NOT EXISTS idx_notebook_namespace_not_deleted ON notebook(namespace) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_note_namespace_not_deleted ON note(namespace) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_note_namespace_pinned ON note(namespace, is_pinned) WHERE is_pinned = true;

-- 5. Update user_can_access_note() to use namespace_grant instead of note.user_email
CREATE OR REPLACE FUNCTION user_can_access_note(
  p_note_id uuid,
  p_user_email text,
  p_required_permission text DEFAULT 'read'
) RETURNS boolean AS $$
DECLARE
  v_note RECORD;
  v_has_access boolean := false;
BEGIN
  SELECT n.namespace, n.visibility, n.notebook_id, n.deleted_at
  INTO v_note
  FROM note n
  WHERE n.id = p_note_id;

  IF v_note IS NULL OR v_note.deleted_at IS NOT NULL THEN
    RETURN false;
  END IF;

  -- Namespace member has full access (replaces user_email ownership check)
  SELECT EXISTS (
    SELECT 1 FROM namespace_grant ng
    WHERE ng.email = p_user_email
      AND ng.namespace = v_note.namespace
  ) INTO v_has_access;

  IF v_has_access THEN
    RETURN true;
  END IF;

  -- Public notes allow read access to everyone
  IF v_note.visibility = 'public' AND p_required_permission = 'read' THEN
    RETURN true;
  END IF;

  -- Check direct note share
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

  -- Check notebook-level share (if note is in a notebook)
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

COMMENT ON FUNCTION user_can_access_note IS 'Check if user has specified permission on note via namespace membership, direct share, or notebook share';

-- 6. Deprecation comments on sharing tables (replaced by namespace grants)
COMMENT ON TABLE note_share IS 'DEPRECATED: Use namespace_grant for access control (Epic #1418). Retained for backward compatibility.';
COMMENT ON TABLE notebook_share IS 'DEPRECATED: Use namespace_grant for access control (Epic #1418). Retained for backward compatibility.';
