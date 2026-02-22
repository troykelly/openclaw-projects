-- ============================================================
-- Down migration 112: Remove custom_fields from contact
-- ============================================================

DROP INDEX IF EXISTS idx_contact_custom_fields;
ALTER TABLE contact DROP CONSTRAINT IF EXISTS contact_custom_fields_max_50;
-- CASCADE needed because contact_active / contact_trash views (created by
-- migration 114 using SELECT *) may depend on this column during rollback.
ALTER TABLE contact DROP COLUMN IF EXISTS custom_fields CASCADE;
