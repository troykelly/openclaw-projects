-- ============================================================
-- Migration 117: Terminal namespace-scoped settings
-- Epic #1667 — TMux session management
-- Issue #1687 — Entry retention policies
-- ============================================================

CREATE TABLE IF NOT EXISTS terminal_setting (
  id              uuid PRIMARY KEY DEFAULT new_uuid(),
  namespace       text NOT NULL
                    CHECK (namespace ~ '^[a-z0-9][a-z0-9._-]*$' AND length(namespace) <= 63),
  key             text NOT NULL CHECK (length(TRIM(key)) > 0),
  value           jsonb NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(namespace, key)
);

CREATE INDEX IF NOT EXISTS idx_terminal_setting_namespace
  ON terminal_setting(namespace);

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_terminal_setting_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS terminal_setting_updated_at ON terminal_setting;
CREATE TRIGGER terminal_setting_updated_at
  BEFORE UPDATE ON terminal_setting
  FOR EACH ROW
  EXECUTE FUNCTION update_terminal_setting_updated_at();
