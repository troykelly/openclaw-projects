-- ============================================================
-- Down migration 110: Remove label, is_primary from contact_endpoint
-- Note: Cannot remove enum values in PostgreSQL. The added types
-- (whatsapp, signal, etc.) remain in the enum but are harmless.
-- ============================================================

-- Restore the original normalization function
CREATE OR REPLACE FUNCTION normalize_contact_endpoint_value(p_type contact_endpoint_type, p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_type::text
    WHEN 'email' THEN lower(trim(p_value))
    WHEN 'telegram' THEN lower(regexp_replace(trim(p_value), '^@', ''))
    WHEN 'phone' THEN regexp_replace(trim(p_value), '[^0-9+]', '', 'g')
    ELSE lower(trim(p_value))
  END;
$$;

DROP INDEX IF EXISTS idx_contact_endpoint_primary;
ALTER TABLE contact_endpoint DROP COLUMN IF EXISTS is_primary;
ALTER TABLE contact_endpoint DROP COLUMN IF EXISTS label;
