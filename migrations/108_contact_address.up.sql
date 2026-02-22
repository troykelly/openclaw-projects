-- ============================================================
-- Migration 108: contact_address table
-- Issue #1573 — Epic #1569: Identity Model & Contacts v2
-- Design: docs/plans/2026-02-22-contacts-v2-full-featured.md §3.2
-- ============================================================

-- Note: No namespace column on child tables. Namespace is inherited
-- from the parent contact via JOIN (see design doc §3.5 note).

DO $$ BEGIN
  CREATE TYPE contact_address_type AS ENUM ('home', 'work', 'other');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS contact_address (
  id uuid PRIMARY KEY DEFAULT new_uuid(),
  contact_id uuid NOT NULL REFERENCES contact(id) ON DELETE CASCADE,
  address_type contact_address_type NOT NULL DEFAULT 'home',
  label text,
  street_address text,
  extended_address text,
  city text,
  region text,
  postal_code text,
  country text,
  country_code text
    CHECK (country_code IS NULL OR length(country_code) = 2),
  formatted_address text,
  latitude double precision,
  longitude double precision,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contact_address_contact
  ON contact_address(contact_id);

-- Ensure at most one primary address per contact
CREATE UNIQUE INDEX IF NOT EXISTS idx_contact_address_primary
  ON contact_address(contact_id) WHERE is_primary = true;

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_contact_address_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER contact_address_updated_at
  BEFORE UPDATE ON contact_address
  FOR EACH ROW
  EXECUTE FUNCTION update_contact_address_updated_at();

COMMENT ON TABLE contact_address IS 'Structured postal addresses for contacts (home, work, other)';
COMMENT ON COLUMN contact_address.country_code IS 'ISO 3166-1 alpha-2 country code';
COMMENT ON COLUMN contact_address.formatted_address IS 'Auto-computed or manually overridden formatted address string';
