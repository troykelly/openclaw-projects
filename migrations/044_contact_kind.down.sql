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

-- Drop dependent views first (they use SELECT * and include contact_kind)
DROP VIEW IF EXISTS contact_active;
DROP VIEW IF EXISTS contact_trash;

-- Drop the column
ALTER TABLE contact DROP COLUMN IF EXISTS contact_kind;

-- Drop the enum type
DROP TYPE IF EXISTS contact_kind;

-- Recreate the views (from migration 035_soft_delete) without contact_kind
CREATE OR REPLACE VIEW contact_active AS
SELECT *
FROM contact
WHERE deleted_at IS NULL;

CREATE OR REPLACE VIEW contact_trash AS
SELECT *
FROM contact
WHERE deleted_at IS NOT NULL;

-- Backfill search_vector to remove stale contact_kind data
UPDATE contact SET search_vector = to_tsvector('english',
  coalesce(display_name, '') || ' ' || coalesce(notes, '')
);
