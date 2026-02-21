-- ============================================================
-- Migration 103: Add priority column to namespace_grant
-- Issue #1535 — Epic #1533: Namespace priority for recall scoring
-- ============================================================

-- Add priority column (0-100, default 50)
-- Higher values = more important for recall ranking
ALTER TABLE namespace_grant
  ADD COLUMN IF NOT EXISTS priority integer NOT NULL DEFAULT 50
  CHECK (priority BETWEEN 0 AND 100);

COMMENT ON COLUMN namespace_grant.priority IS
  'Priority for recall ordering. Higher = more important. Default 50. Personal namespace should be ~90, legacy/default ~10.';

-- Backfill sensible defaults for existing grants
-- is_default=true (personal namespace) gets high priority
UPDATE namespace_grant SET priority = 90 WHERE is_default = true AND priority = 50;
-- 'default' namespace (legacy catch-all) gets low priority
UPDATE namespace_grant SET priority = 10 WHERE namespace = 'default' AND is_default = false AND priority = 50;
