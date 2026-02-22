-- ============================================================
-- Migration 110: Endpoint type expansion + label + is_primary
-- Issue #1575 — Epic #1569: Identity Model & Contacts v2
-- Design: docs/plans/2026-02-22-contacts-v2-full-featured.md §3.4
-- ============================================================

-- STEP 1: Add new endpoint types to the enum
-- ALTER TYPE ADD VALUE is not transactional, so each must be separate.
-- IF NOT EXISTS prevents errors if re-run.
ALTER TYPE contact_endpoint_type ADD VALUE IF NOT EXISTS 'whatsapp';
ALTER TYPE contact_endpoint_type ADD VALUE IF NOT EXISTS 'signal';
ALTER TYPE contact_endpoint_type ADD VALUE IF NOT EXISTS 'discord';
ALTER TYPE contact_endpoint_type ADD VALUE IF NOT EXISTS 'linkedin';
ALTER TYPE contact_endpoint_type ADD VALUE IF NOT EXISTS 'twitter';
ALTER TYPE contact_endpoint_type ADD VALUE IF NOT EXISTS 'mastodon';
ALTER TYPE contact_endpoint_type ADD VALUE IF NOT EXISTS 'instagram';
ALTER TYPE contact_endpoint_type ADD VALUE IF NOT EXISTS 'facebook';
ALTER TYPE contact_endpoint_type ADD VALUE IF NOT EXISTS 'website';
ALTER TYPE contact_endpoint_type ADD VALUE IF NOT EXISTS 'sip';

-- STEP 2: Add label and is_primary columns
ALTER TABLE contact_endpoint
  ADD COLUMN IF NOT EXISTS label text,
  ADD COLUMN IF NOT EXISTS is_primary boolean NOT NULL DEFAULT false;

-- Ensure at most one primary endpoint per contact per type
CREATE UNIQUE INDEX IF NOT EXISTS idx_contact_endpoint_primary
  ON contact_endpoint(contact_id, endpoint_type) WHERE is_primary = true;

-- STEP 3: Update normalization function to handle new types
CREATE OR REPLACE FUNCTION normalize_contact_endpoint_value(p_type contact_endpoint_type, p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_type
    WHEN 'email' THEN lower(trim(p_value))
    WHEN 'telegram' THEN lower(regexp_replace(trim(p_value), '^@', ''))
    WHEN 'phone' THEN regexp_replace(trim(p_value), '[^0-9+]', '', 'g')
    WHEN 'whatsapp' THEN regexp_replace(trim(p_value), '[^0-9+]', '', 'g')
    WHEN 'sip' THEN lower(trim(p_value))
    WHEN 'website' THEN lower(trim(p_value))
    WHEN 'mastodon' THEN lower(trim(p_value))
    ELSE lower(trim(p_value))
  END;
$$;

COMMENT ON COLUMN contact_endpoint.label IS 'Sub-type label (e.g., Home, Work, Mobile)';
COMMENT ON COLUMN contact_endpoint.is_primary IS 'When true, this is the primary endpoint of its type for the contact';
