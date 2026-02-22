-- ============================================================
-- Down migration 111: Drop contact_tag table
-- ============================================================

DROP INDEX IF EXISTS idx_contact_tag_tag;
DROP TABLE IF EXISTS contact_tag;
