-- Issue #489: Rollback contact_kind column and enum

-- Restore the original search_vector trigger (from migration 027)
CREATE OR REPLACE FUNCTION contact_search_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector := to_tsvector('english',
    coalesce(NEW.display_name, '') || ' ' || coalesce(NEW.notes, '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Recreate trigger without contact_kind column reference
DROP TRIGGER IF EXISTS contact_search_trigger ON contact;
CREATE TRIGGER contact_search_trigger
BEFORE INSERT OR UPDATE OF display_name, notes ON contact
FOR EACH ROW EXECUTE FUNCTION contact_search_update();

-- Drop the index
DROP INDEX IF EXISTS idx_contact_kind;

-- Drop the column
ALTER TABLE contact DROP COLUMN IF EXISTS contact_kind;

-- Drop the enum type
DROP TYPE IF EXISTS contact_kind;

-- Backfill search_vector to remove stale contact_kind data
UPDATE contact SET search_vector = to_tsvector('english',
  coalesce(display_name, '') || ' ' || coalesce(notes, '')
);
