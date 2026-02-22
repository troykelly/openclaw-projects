-- ============================================================
-- Down migration 114: Restore birthday column + views
-- ============================================================

-- Drop views before adding the column back
DROP VIEW IF EXISTS contact_active;
DROP VIEW IF EXISTS contact_trash;

-- Restore the birthday column
ALTER TABLE contact ADD COLUMN IF NOT EXISTS birthday date;

-- Recreate views (now including birthday again)
CREATE OR REPLACE VIEW contact_active AS
SELECT * FROM contact WHERE deleted_at IS NULL;

CREATE OR REPLACE VIEW contact_trash AS
SELECT * FROM contact WHERE deleted_at IS NOT NULL;

-- Backfill from contact_date if data exists
UPDATE contact c
SET birthday = cd.date_value
FROM contact_date cd
WHERE cd.contact_id = c.id
  AND cd.date_type = 'birthday'
  AND c.birthday IS NULL;

-- Remove deprecation comments
COMMENT ON COLUMN contact.relationship_type IS 'How user knows this contact (friend, family, colleague, client, vendor)';
COMMENT ON COLUMN contact.relationship_notes IS NULL;
