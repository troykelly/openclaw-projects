-- ============================================================
-- Down migration 107: Remove structured name fields
-- ============================================================

-- Drop the display_name compute trigger
DROP TRIGGER IF EXISTS contact_compute_display_name_trigger ON contact;
DROP FUNCTION IF EXISTS contact_compute_display_name();

-- Restore the search trigger to previous version (from migration 044)
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

DROP TRIGGER IF EXISTS contact_search_trigger ON contact;
CREATE TRIGGER contact_search_trigger
BEFORE INSERT OR UPDATE OF display_name, notes, contact_kind ON contact
FOR EACH ROW EXECUTE FUNCTION contact_search_update();

-- Backfill search vectors
UPDATE contact SET search_vector = to_tsvector('english',
  coalesce(display_name, '') || ' ' || coalesce(notes, '') || ' ' || coalesce(contact_kind::text, '')
);

-- Drop indexes
DROP INDEX IF EXISTS idx_contact_family_name;
DROP INDEX IF EXISTS idx_contact_given_name;

-- Drop columns
ALTER TABLE contact
  DROP COLUMN IF EXISTS given_name,
  DROP COLUMN IF EXISTS family_name,
  DROP COLUMN IF EXISTS middle_name,
  DROP COLUMN IF EXISTS name_prefix,
  DROP COLUMN IF EXISTS name_suffix,
  DROP COLUMN IF EXISTS nickname,
  DROP COLUMN IF EXISTS phonetic_given_name,
  DROP COLUMN IF EXISTS phonetic_family_name,
  DROP COLUMN IF EXISTS file_as,
  DROP COLUMN IF EXISTS display_name_locked;
