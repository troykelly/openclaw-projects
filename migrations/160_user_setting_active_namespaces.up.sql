-- Migration 160: Add active_namespaces column to user_setting
-- Issue #2348 — Epic #2345: User Namespace Selection in UI
--
-- Stores the user's selected namespace filter for the UI.
-- Defaults to the user's home namespace (or 'default' if none).

ALTER TABLE user_setting
  ADD COLUMN IF NOT EXISTS active_namespaces TEXT[] NOT NULL DEFAULT ARRAY['default'::TEXT];

-- Seed existing rows: set active_namespaces to the user's home namespace
UPDATE user_setting us
SET active_namespaces = ARRAY[COALESCE(
  (SELECT ng.namespace FROM namespace_grant ng WHERE ng.email = us.email AND ng.is_home = true LIMIT 1),
  'default'
)]
WHERE active_namespaces = ARRAY['default'::TEXT];

-- Index for queries filtering by active namespace membership
CREATE INDEX IF NOT EXISTS idx_user_setting_active_namespaces
  ON user_setting USING GIN (active_namespaces);

COMMENT ON COLUMN user_setting.active_namespaces
  IS 'User-selected namespace filter for UI. Validated against namespace_grant on write.';
