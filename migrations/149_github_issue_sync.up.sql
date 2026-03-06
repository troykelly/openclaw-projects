-- ============================================================
-- Migration 148: GitHub Issue Sync schema extensions
-- Epic #2186 — Symphony Orchestration, Issue #2202
--
-- Extends project_repository with sync tracking columns and
-- creates github_issue_sync for per-issue sync state.
-- ============================================================

-- ============================================================
-- 1. Extend project_repository for sync tracking
-- ============================================================

-- Add sync tracking columns
ALTER TABLE project_repository
  ADD COLUMN IF NOT EXISTS last_synced_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sync_hash       TEXT,
  ADD COLUMN IF NOT EXISTS sync_initiative_id UUID REFERENCES work_item(id) ON DELETE SET NULL;

-- Create index for sync_initiative_id
CREATE INDEX IF NOT EXISTS idx_project_repository_sync_initiative
  ON project_repository(sync_initiative_id) WHERE sync_initiative_id IS NOT NULL;

-- Update sync_strategy CHECK to use the new values.
-- Drop old constraint and add new one (idempotent via DO block).
DO $$
BEGIN
  -- Drop old CHECK if it exists
  IF EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'project_repository_sync_strategy_check'
  ) THEN
    ALTER TABLE project_repository DROP CONSTRAINT project_repository_sync_strategy_check;
  END IF;

  -- Add new CHECK with updated values
  ALTER TABLE project_repository
    ADD CONSTRAINT project_repository_sync_strategy_check
    CHECK (sync_strategy IS NULL OR sync_strategy IN (
      'github_authoritative', 'bidirectional', 'manual',
      -- Legacy values (backwards compatibility during migration)
      'mirror', 'selective'
    ));
END;
$$;

-- ============================================================
-- 2. github_issue_sync — per-issue sync state
-- Links a project_repository + external issue to a work_item.
-- Tracks sync hash for drift detection and sync timestamps.
-- ============================================================
CREATE TABLE IF NOT EXISTS github_issue_sync (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  namespace           TEXT        NOT NULL
                        CHECK (namespace ~ '^[a-z0-9][a-z0-9._-]*$' AND length(namespace) <= 63),
  project_repository_id UUID      NOT NULL REFERENCES project_repository(id) ON DELETE CASCADE,
  work_item_id        UUID        NOT NULL REFERENCES work_item(id) ON DELETE CASCADE,
  external_link_id    UUID        REFERENCES work_item_external_link(id) ON DELETE SET NULL,
  github_issue_number INTEGER     NOT NULL CHECK (github_issue_number >= 1),
  github_issue_url    TEXT        NOT NULL CHECK (length(TRIM(github_issue_url)) > 0),
  sync_hash           TEXT,
  last_synced_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  github_state        TEXT        NOT NULL DEFAULT 'open'
                        CHECK (github_state IN ('open', 'closed')),
  github_author       TEXT,
  github_labels       JSONB       NOT NULL DEFAULT '[]',
  github_assignees    JSONB       NOT NULL DEFAULT '[]',
  github_milestone    TEXT,
  github_priority     INTEGER     CHECK (github_priority IS NULL OR github_priority BETWEEN 1 AND 5),
  github_created_at   TIMESTAMPTZ,
  github_updated_at   TIMESTAMPTZ,
  github_closed_at    TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- One sync record per issue per repo
  UNIQUE (project_repository_id, github_issue_number)
);

CREATE INDEX IF NOT EXISTS idx_github_issue_sync_namespace
  ON github_issue_sync(namespace);
CREATE INDEX IF NOT EXISTS idx_github_issue_sync_repo
  ON github_issue_sync(project_repository_id);
CREATE INDEX IF NOT EXISTS idx_github_issue_sync_work_item
  ON github_issue_sync(work_item_id);
CREATE INDEX IF NOT EXISTS idx_github_issue_sync_state
  ON github_issue_sync(github_state);

-- updated_at trigger
CREATE OR REPLACE FUNCTION set_github_issue_sync_updated_at()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_github_issue_sync_updated_at ON github_issue_sync;
CREATE TRIGGER trg_github_issue_sync_updated_at
  BEFORE UPDATE ON github_issue_sync
  FOR EACH ROW EXECUTE FUNCTION set_github_issue_sync_updated_at();
