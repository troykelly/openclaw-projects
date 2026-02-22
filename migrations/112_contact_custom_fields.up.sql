-- ============================================================
-- Migration 112: custom_fields jsonb on contact
-- Issue #1577 — Epic #1569: Identity Model & Contacts v2
-- Design: docs/plans/2026-02-22-contacts-v2-full-featured.md §3.6
-- ============================================================

ALTER TABLE contact
  ADD COLUMN IF NOT EXISTS custom_fields jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Max 50 custom fields per contact
-- Note: constraint added separately since ADD COLUMN IF NOT EXISTS
-- can't include CHECK inline when column may already exist
DO $$ BEGIN
  ALTER TABLE contact ADD CONSTRAINT contact_custom_fields_max_50
    CHECK (jsonb_array_length(custom_fields) <= 50);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- GIN index for querying by custom field values
CREATE INDEX IF NOT EXISTS idx_contact_custom_fields
  ON contact USING GIN (custom_fields jsonb_path_ops);

COMMENT ON COLUMN contact.custom_fields IS 'User-defined key-value pairs: [{"key": "Loyalty Number", "value": "ABC123"}, ...]. Max 50 entries.';
