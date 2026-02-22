-- ============================================================
-- Migration 109: contact_date table + birthday data migration
-- Issue #1574 — Epic #1569: Identity Model & Contacts v2
-- Design: docs/plans/2026-02-22-contacts-v2-full-featured.md §3.3
-- ============================================================

DO $$ BEGIN
  CREATE TYPE contact_date_type AS ENUM ('birthday', 'anniversary', 'other');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS contact_date (
  id uuid PRIMARY KEY DEFAULT new_uuid(),
  contact_id uuid NOT NULL REFERENCES contact(id) ON DELETE CASCADE,
  date_type contact_date_type NOT NULL DEFAULT 'other',
  label text,
  date_value date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contact_date_contact
  ON contact_date(contact_id);
CREATE INDEX IF NOT EXISTS idx_contact_date_date
  ON contact_date(date_value);
CREATE INDEX IF NOT EXISTS idx_contact_date_type_date
  ON contact_date(date_type, date_value);

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_contact_date_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER contact_date_updated_at
  BEFORE UPDATE ON contact_date
  FOR EACH ROW
  EXECUTE FUNCTION update_contact_date_updated_at();

-- Migrate existing birthday data from contact.birthday column
INSERT INTO contact_date (contact_id, date_type, date_value)
SELECT id, 'birthday', birthday
FROM contact
WHERE birthday IS NOT NULL
ON CONFLICT DO NOTHING;

COMMENT ON TABLE contact_date IS 'Typed dates for contacts (birthday, anniversary, custom)';
COMMENT ON COLUMN contact_date.label IS 'Custom label (e.g., "Wedding anniversary")';
