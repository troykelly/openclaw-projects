-- ============================================================
-- Down migration 106: Restore role column, rename is_home back
-- ============================================================

-- STEP 1: Rename is_home back to is_default
ALTER TABLE namespace_grant RENAME COLUMN is_home TO is_default;

-- Restore the index name
DROP INDEX IF EXISTS idx_namespace_grant_home;
CREATE UNIQUE INDEX IF NOT EXISTS idx_namespace_grant_default
  ON namespace_grant(email) WHERE is_default = true;

-- STEP 2: Restore role column from access
ALTER TABLE namespace_grant
  ADD COLUMN IF NOT EXISTS role text;

UPDATE namespace_grant
SET role = CASE
  WHEN access = 'readwrite' THEN 'member'
  WHEN access = 'read' THEN 'observer'
  ELSE 'member'
END;

ALTER TABLE namespace_grant
  ALTER COLUMN role SET NOT NULL,
  ALTER COLUMN role SET DEFAULT 'member',
  ADD CONSTRAINT namespace_grant_role_check CHECK (role IN ('owner', 'admin', 'member', 'observer'));

-- STEP 3: Drop the access column
ALTER TABLE namespace_grant DROP CONSTRAINT IF EXISTS namespace_grant_access_check;
ALTER TABLE namespace_grant DROP COLUMN IF EXISTS access;
