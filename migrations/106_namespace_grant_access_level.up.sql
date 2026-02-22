-- ============================================================
-- Migration 106: namespace_grant role -> access, is_default -> is_home
-- Issue #1571 — Epic #1569: Identity Model & Contacts v2
-- Design: docs/plans/2026-02-22-identity-model-namespace-permissions.md §3.2
-- ============================================================

-- STEP 1: Add the new access column with data mapped from role
-- Mapping: owner/admin/member -> readwrite, observer -> read
ALTER TABLE namespace_grant
  ADD COLUMN IF NOT EXISTS access text;

UPDATE namespace_grant
SET access = CASE
  WHEN role IN ('owner', 'admin', 'member') THEN 'readwrite'
  WHEN role = 'observer' THEN 'read'
  ELSE 'readwrite'
END
WHERE access IS NULL;

-- Now make it NOT NULL with default and CHECK
ALTER TABLE namespace_grant
  ALTER COLUMN access SET NOT NULL,
  ALTER COLUMN access SET DEFAULT 'readwrite',
  ADD CONSTRAINT namespace_grant_access_check CHECK (access IN ('read', 'readwrite'));

-- STEP 2: Drop the old role column
ALTER TABLE namespace_grant DROP COLUMN IF EXISTS role;

-- STEP 3: Rename is_default to is_home
ALTER TABLE namespace_grant RENAME COLUMN is_default TO is_home;

-- STEP 4: Rename the unique partial index
-- Drop and recreate since ALTER INDEX RENAME may not work across all PG versions
DROP INDEX IF EXISTS idx_namespace_grant_default;
CREATE UNIQUE INDEX IF NOT EXISTS idx_namespace_grant_home
  ON namespace_grant(email) WHERE is_home = true;

COMMENT ON COLUMN namespace_grant.access IS 'Access level: read (view only) or readwrite (full CRUD)';
COMMENT ON COLUMN namespace_grant.is_home IS 'When true, this is the human''s home/default namespace for new data';
