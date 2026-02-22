-- ============================================================
-- Down migration 109: Drop contact_date table
-- Note: birthday data is NOT migrated back to contact.birthday
-- because migration 114 (which drops it) is reversed separately.
-- ============================================================

DROP TRIGGER IF EXISTS contact_date_updated_at ON contact_date;
DROP FUNCTION IF EXISTS update_contact_date_updated_at();
DROP INDEX IF EXISTS idx_contact_date_type_date;
DROP INDEX IF EXISTS idx_contact_date_date;
DROP INDEX IF EXISTS idx_contact_date_contact;
DROP TABLE IF EXISTS contact_date;
DROP TYPE IF EXISTS contact_date_type;
