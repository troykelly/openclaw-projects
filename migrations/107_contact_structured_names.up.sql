-- ============================================================
-- Migration 107: Structured name fields on contact + display_name auto-compute
-- Issue #1572 — Epic #1569: Identity Model & Contacts v2
-- Design: docs/plans/2026-02-22-contacts-v2-full-featured.md §3.1
-- ============================================================

-- STEP 1: Add structured name columns
ALTER TABLE contact
  ADD COLUMN IF NOT EXISTS given_name text,
  ADD COLUMN IF NOT EXISTS family_name text,
  ADD COLUMN IF NOT EXISTS middle_name text,
  ADD COLUMN IF NOT EXISTS name_prefix text,
  ADD COLUMN IF NOT EXISTS name_suffix text,
  ADD COLUMN IF NOT EXISTS nickname text,
  ADD COLUMN IF NOT EXISTS phonetic_given_name text,
  ADD COLUMN IF NOT EXISTS phonetic_family_name text,
  ADD COLUMN IF NOT EXISTS file_as text,
  ADD COLUMN IF NOT EXISTS display_name_locked boolean NOT NULL DEFAULT false;

-- STEP 2: Indexes for name lookups
CREATE INDEX IF NOT EXISTS idx_contact_family_name
  ON contact(family_name) WHERE family_name IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contact_given_name
  ON contact(given_name) WHERE given_name IS NOT NULL;

-- STEP 3: display_name auto-compute trigger
-- When display_name_locked is false and structured name fields are provided,
-- auto-compute display_name based on the contact's language/locale.
CREATE OR REPLACE FUNCTION contact_compute_display_name()
RETURNS trigger AS $$
DECLARE
  computed text;
  lang text;
BEGIN
  -- If display_name is locked, don't auto-compute
  IF NEW.display_name_locked THEN
    RETURN NEW;
  END IF;

  -- Only compute if we have at least given_name or family_name
  IF NEW.given_name IS NULL AND NEW.family_name IS NULL THEN
    RETURN NEW;
  END IF;

  lang := coalesce(NEW.language, 'en');

  -- Locale-aware name ordering
  IF lang IN ('ja', 'zh', 'ko') THEN
    -- CJK: family given (no space for ja/zh, space for ko)
    IF lang = 'ko' THEN
      computed := trim(coalesce(NEW.family_name, '') || ' ' || coalesce(NEW.given_name, ''));
    ELSE
      computed := trim(coalesce(NEW.family_name, '') || coalesce(NEW.given_name, ''));
    END IF;
  ELSIF lang = 'hu' THEN
    -- Hungarian: family given
    computed := trim(coalesce(NEW.family_name, '') || ' ' || coalesce(NEW.given_name, ''));
  ELSE
    -- Western default: given family
    computed := trim(coalesce(NEW.given_name, '') || ' ' || coalesce(NEW.family_name, ''));
  END IF;

  -- Add middle name if present (Western-style only)
  IF NEW.middle_name IS NOT NULL AND lang NOT IN ('ja', 'zh', 'ko', 'hu') THEN
    computed := trim(coalesce(NEW.given_name, '') || ' ' || NEW.middle_name || ' ' || coalesce(NEW.family_name, ''));
  END IF;

  -- Add prefix/suffix
  IF NEW.name_prefix IS NOT NULL THEN
    computed := NEW.name_prefix || ' ' || computed;
  END IF;
  IF NEW.name_suffix IS NOT NULL THEN
    computed := computed || ', ' || NEW.name_suffix;
  END IF;

  -- Collapse multiple spaces
  computed := regexp_replace(trim(computed), '\s+', ' ', 'g');

  -- Only set if we computed something meaningful
  IF length(trim(computed)) > 0 THEN
    NEW.display_name := computed;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS contact_compute_display_name_trigger ON contact;
CREATE TRIGGER contact_compute_display_name_trigger
BEFORE INSERT OR UPDATE OF given_name, family_name, middle_name, name_prefix, name_suffix, language, display_name_locked
ON contact
FOR EACH ROW EXECUTE FUNCTION contact_compute_display_name();

-- STEP 4: Update search trigger to index structured name fields
CREATE OR REPLACE FUNCTION contact_search_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector := to_tsvector('english',
    coalesce(NEW.display_name, '') || ' ' ||
    coalesce(NEW.given_name, '') || ' ' ||
    coalesce(NEW.family_name, '') || ' ' ||
    coalesce(NEW.middle_name, '') || ' ' ||
    coalesce(NEW.nickname, '') || ' ' ||
    coalesce(NEW.phonetic_given_name, '') || ' ' ||
    coalesce(NEW.phonetic_family_name, '') || ' ' ||
    coalesce(NEW.organization, '') || ' ' ||
    coalesce(NEW.notes, '') || ' ' ||
    coalesce(NEW.contact_kind::text, '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Recreate search trigger to fire on new name fields too
DROP TRIGGER IF EXISTS contact_search_trigger ON contact;
CREATE TRIGGER contact_search_trigger
BEFORE INSERT OR UPDATE OF display_name, given_name, family_name, middle_name, nickname,
  phonetic_given_name, phonetic_family_name, organization, notes, contact_kind
ON contact
FOR EACH ROW EXECUTE FUNCTION contact_search_update();

-- Backfill search vectors for existing contacts
UPDATE contact SET search_vector = to_tsvector('english',
  coalesce(display_name, '') || ' ' ||
  coalesce(given_name, '') || ' ' ||
  coalesce(family_name, '') || ' ' ||
  coalesce(middle_name, '') || ' ' ||
  coalesce(nickname, '') || ' ' ||
  coalesce(phonetic_given_name, '') || ' ' ||
  coalesce(phonetic_family_name, '') || ' ' ||
  coalesce(organization, '') || ' ' ||
  coalesce(notes, '') || ' ' ||
  coalesce(contact_kind::text, '')
);

COMMENT ON COLUMN contact.given_name IS 'First/given name';
COMMENT ON COLUMN contact.family_name IS 'Last/family/surname';
COMMENT ON COLUMN contact.middle_name IS 'Middle name(s)';
COMMENT ON COLUMN contact.name_prefix IS 'Honorific prefix (Mr, Ms, Dr, etc.)';
COMMENT ON COLUMN contact.name_suffix IS 'Honorific suffix (Jr, Sr, III, PhD, etc.)';
COMMENT ON COLUMN contact.nickname IS 'Preferred informal name';
COMMENT ON COLUMN contact.phonetic_given_name IS 'Phonetic rendering of given name (for CJK/complex names)';
COMMENT ON COLUMN contact.phonetic_family_name IS 'Phonetic rendering of family name';
COMMENT ON COLUMN contact.file_as IS 'Custom sort/file-as override (e.g., "Kelly, Troy")';
COMMENT ON COLUMN contact.display_name_locked IS 'When true, display_name was manually set and auto-compute trigger is skipped';
