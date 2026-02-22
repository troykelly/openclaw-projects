-- ============================================================
-- Migration 114: Legacy field cleanup — drop birthday column
-- Issue #1579 — Epic #1569: Identity Model & Contacts v2
-- Design: docs/plans/2026-02-22-contacts-v2-full-featured.md §3.3, §3.7
--
-- Birthday data was migrated to contact_date in migration 109.
-- This migration drops the now-redundant column to avoid dual source of truth.
-- Also marks relationship_type and relationship_notes as deprecated.
-- ============================================================

-- Views use SELECT * and depend on the birthday column.
-- Drop and recreate them without birthday.
DROP VIEW IF EXISTS contact_active;
DROP VIEW IF EXISTS contact_trash;

-- Drop the birthday column (data is in contact_date)
ALTER TABLE contact DROP COLUMN IF EXISTS birthday;

-- Recreate the views (SELECT * now excludes birthday)
CREATE OR REPLACE VIEW contact_active AS
SELECT * FROM contact WHERE deleted_at IS NULL;

CREATE OR REPLACE VIEW contact_trash AS
SELECT * FROM contact WHERE deleted_at IS NOT NULL;

-- Mark legacy relationship text fields as deprecated
-- (These are superseded by the relationship table from migration 047)
COMMENT ON COLUMN contact.relationship_type IS 'DEPRECATED: Use relationship table instead. Will be removed in a future migration.';
COMMENT ON COLUMN contact.relationship_notes IS 'DEPRECATED: Use relationship table instead. Will be removed in a future migration.';
