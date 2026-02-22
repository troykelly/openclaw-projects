-- ============================================================
-- Down migration 108: Drop contact_address table
-- ============================================================

DROP TRIGGER IF EXISTS contact_address_updated_at ON contact_address;
DROP FUNCTION IF EXISTS update_contact_address_updated_at();
DROP INDEX IF EXISTS idx_contact_address_primary;
DROP INDEX IF EXISTS idx_contact_address_contact;
DROP TABLE IF EXISTS contact_address;
DROP TYPE IF EXISTS contact_address_type;
