-- Issue #489: Add contact_kind to contacts table
-- Part of Epic #486 — Relationship-Aware Preferences and Memory Auto-Surfacing

-- Create the contact_kind enum type
DO $$ BEGIN
  CREATE TYPE contact_kind AS ENUM ('person', 'organisation', 'group', 'agent');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Add contact_kind column with default 'person' (backward compatible)
ALTER TABLE contact ADD COLUMN IF NOT EXISTS contact_kind contact_kind NOT NULL DEFAULT 'person';

-- Create index for filtering by contact_kind
CREATE INDEX IF NOT EXISTS idx_contact_kind ON contact (contact_kind);

-- Update the search_vector trigger to include contact_kind in full-text search.
-- This replaces the trigger function from migration 027.
CREATE OR REPLACE FUNCTION contact_search_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector := to_tsvector('english',
    coalesce(NEW.display_name, '') || ' ' ||
    coalesce(NEW.notes, '') || ' ' ||
    coalesce(NEW.contact_kind::text, '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Recreate the trigger to fire on contact_kind changes too
DROP TRIGGER IF EXISTS contact_search_trigger ON contact;
CREATE TRIGGER contact_search_trigger
BEFORE INSERT OR UPDATE OF display_name, notes, contact_kind ON contact
FOR EACH ROW EXECUTE FUNCTION contact_search_update();

-- Backfill search_vector for existing contacts to include contact_kind
UPDATE contact SET search_vector = to_tsvector('english',
  coalesce(display_name, '') || ' ' || coalesce(notes, '') || ' ' || coalesce(contact_kind::text, '')
);

-- Comments
COMMENT ON COLUMN contact.contact_kind IS 'Entity type: person, organisation, group, or agent';
