-- ============================================================
-- Down migration 112: Remove custom_fields from contact
-- ============================================================

DROP INDEX IF EXISTS idx_contact_custom_fields;
ALTER TABLE contact DROP CONSTRAINT IF EXISTS contact_custom_fields_max_50;
ALTER TABLE contact DROP COLUMN IF EXISTS custom_fields;
