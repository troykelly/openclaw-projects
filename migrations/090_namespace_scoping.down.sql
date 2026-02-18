-- ============================================================
-- Down migration 090: Reverse namespace scoping
-- Drops namespace columns, indexes, and namespace_grant table
-- ============================================================

-- STEP 1: Drop indexes on namespace columns
DROP INDEX IF EXISTS idx_work_item_namespace;
DROP INDEX IF EXISTS idx_memory_namespace;
DROP INDEX IF EXISTS idx_contact_namespace;
DROP INDEX IF EXISTS idx_contact_endpoint_namespace;
DROP INDEX IF EXISTS idx_relationship_namespace;
DROP INDEX IF EXISTS idx_external_thread_namespace;
DROP INDEX IF EXISTS idx_external_message_namespace;
DROP INDEX IF EXISTS idx_notebook_namespace;
DROP INDEX IF EXISTS idx_note_namespace;
DROP INDEX IF EXISTS idx_notification_namespace;
DROP INDEX IF EXISTS idx_list_namespace;
DROP INDEX IF EXISTS idx_recipe_namespace;
DROP INDEX IF EXISTS idx_meal_log_namespace;
DROP INDEX IF EXISTS idx_pantry_item_namespace;
DROP INDEX IF EXISTS idx_entity_link_namespace;
DROP INDEX IF EXISTS idx_context_namespace;
DROP INDEX IF EXISTS idx_file_attachment_namespace;
DROP INDEX IF EXISTS idx_file_share_namespace;
DROP INDEX IF EXISTS idx_skill_store_item_namespace;

-- STEP 2: Drop namespace columns from entity tables
ALTER TABLE work_item DROP COLUMN IF EXISTS namespace;
ALTER TABLE memory DROP COLUMN IF EXISTS namespace;
ALTER TABLE contact DROP COLUMN IF EXISTS namespace;
ALTER TABLE contact_endpoint DROP COLUMN IF EXISTS namespace;
ALTER TABLE relationship DROP COLUMN IF EXISTS namespace;
ALTER TABLE external_thread DROP COLUMN IF EXISTS namespace;
ALTER TABLE external_message DROP COLUMN IF EXISTS namespace;
ALTER TABLE notebook DROP COLUMN IF EXISTS namespace;
ALTER TABLE note DROP COLUMN IF EXISTS namespace;
ALTER TABLE notification DROP COLUMN IF EXISTS namespace;
ALTER TABLE list DROP COLUMN IF EXISTS namespace;
ALTER TABLE recipe DROP COLUMN IF EXISTS namespace;
ALTER TABLE meal_log DROP COLUMN IF EXISTS namespace;
ALTER TABLE pantry_item DROP COLUMN IF EXISTS namespace;
ALTER TABLE entity_link DROP COLUMN IF EXISTS namespace;
ALTER TABLE context DROP COLUMN IF EXISTS namespace;
ALTER TABLE file_attachment DROP COLUMN IF EXISTS namespace;
ALTER TABLE file_share DROP COLUMN IF EXISTS namespace;
ALTER TABLE skill_store_item DROP COLUMN IF EXISTS namespace;

-- STEP 3: Drop namespace_grant table and trigger
DROP TRIGGER IF EXISTS namespace_grant_updated_at ON namespace_grant;
DROP FUNCTION IF EXISTS update_namespace_grant_updated_at();
DROP INDEX IF EXISTS idx_namespace_grant_default;
DROP INDEX IF EXISTS idx_namespace_grant_namespace;
DROP INDEX IF EXISTS idx_namespace_grant_email;
DROP TABLE IF EXISTS namespace_grant;
