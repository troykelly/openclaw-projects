-- Migration 091: Drop user_email scoping columns (Epic #1418, Phase 4)
--
-- Removes user_email from entity tables where it was used ONLY for data access
-- scoping. Columns used for attribution/identity (comments, reactions, presence,
-- notifications, note_version, auth/oauth/geo/dev_session) are retained.
--
-- Prerequisites: All entity routes must be using namespace-based scoping (Phase 3).

BEGIN;

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

-- 5. Deprecation comments on sharing tables (replaced by namespace grants)
COMMENT ON TABLE note_share IS 'DEPRECATED: Use namespace_grant for access control (Epic #1418). Retained for backward compatibility.';
COMMENT ON TABLE notebook_share IS 'DEPRECATED: Use namespace_grant for access control (Epic #1418). Retained for backward compatibility.';

COMMIT;
