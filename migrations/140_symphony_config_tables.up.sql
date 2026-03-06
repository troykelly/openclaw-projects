-- ============================================================
-- Migration 140: Symphony core configuration tables
-- Epic #2186 — Symphony Orchestration, Issue #2192
-- Tables: project_repository, project_host, symphony_tool_config,
--   symphony_orchestrator_config, symphony_notification_rule
-- ============================================================

-- ============================================================
-- 1. project_repository — project-to-repo mapping
-- ============================================================
CREATE TABLE IF NOT EXISTS project_repository (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  namespace       TEXT        NOT NULL
                    CHECK (namespace ~ '^[a-z0-9][a-z0-9._-]*$' AND length(namespace) <= 63),
  project_id      UUID        NOT NULL REFERENCES work_item(id) ON DELETE CASCADE,
  org             TEXT        NOT NULL CHECK (length(TRIM(org)) > 0),
  repo            TEXT        NOT NULL CHECK (length(TRIM(repo)) > 0),
  default_branch  TEXT        NOT NULL DEFAULT 'main',
  sync_strategy   TEXT        CHECK (sync_strategy IS NULL OR sync_strategy IN ('mirror', 'selective', 'manual')),
  sync_epic_id    UUID        REFERENCES work_item(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (namespace, project_id, org, repo)
);

CREATE INDEX IF NOT EXISTS idx_project_repository_namespace
  ON project_repository(namespace);
CREATE INDEX IF NOT EXISTS idx_project_repository_project
  ON project_repository(project_id);

-- updated_at trigger
CREATE OR REPLACE FUNCTION set_project_repository_updated_at()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_project_repository_updated_at ON project_repository;
CREATE TRIGGER trg_project_repository_updated_at
  BEFORE UPDATE ON project_repository
  FOR EACH ROW EXECUTE FUNCTION set_project_repository_updated_at();

-- ============================================================
-- 2. project_host — project-to-SSH-host assignment
-- ============================================================
CREATE TABLE IF NOT EXISTS project_host (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  namespace               TEXT        NOT NULL
                            CHECK (namespace ~ '^[a-z0-9][a-z0-9._-]*$' AND length(namespace) <= 63),
  project_id              UUID        NOT NULL REFERENCES work_item(id) ON DELETE CASCADE,
  connection_id           UUID        NOT NULL REFERENCES terminal_connection(id) ON DELETE CASCADE,
  priority                INTEGER     NOT NULL DEFAULT 0,
  max_concurrent_sessions INTEGER     NOT NULL DEFAULT 1,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, connection_id)
);

CREATE INDEX IF NOT EXISTS idx_project_host_namespace
  ON project_host(namespace);
CREATE INDEX IF NOT EXISTS idx_project_host_project
  ON project_host(project_id);

-- updated_at trigger
CREATE OR REPLACE FUNCTION set_project_host_updated_at()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_project_host_updated_at ON project_host;
CREATE TRIGGER trg_project_host_updated_at
  BEFORE UPDATE ON project_host
  FOR EACH ROW EXECUTE FUNCTION set_project_host_updated_at();

-- ============================================================
-- 3. symphony_tool_config — coding agent CLI configs
-- ============================================================
CREATE TABLE IF NOT EXISTS symphony_tool_config (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  namespace       TEXT        NOT NULL
                    CHECK (namespace ~ '^[a-z0-9][a-z0-9._-]*$' AND length(namespace) <= 63),
  tool_name       TEXT        NOT NULL CHECK (length(TRIM(tool_name)) > 0),
  command         TEXT        NOT NULL CHECK (length(TRIM(command)) > 0),
  verify_command  TEXT,
  min_version     TEXT,
  auth_config     JSONB,
  timeout_seconds INTEGER     NOT NULL DEFAULT 300,
  env_vars        JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (namespace, tool_name)
);

CREATE INDEX IF NOT EXISTS idx_symphony_tool_config_namespace
  ON symphony_tool_config(namespace);

-- updated_at trigger
CREATE OR REPLACE FUNCTION set_symphony_tool_config_updated_at()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_symphony_tool_config_updated_at ON symphony_tool_config;
CREATE TRIGGER trg_symphony_tool_config_updated_at
  BEFORE UPDATE ON symphony_tool_config
  FOR EACH ROW EXECUTE FUNCTION set_symphony_tool_config_updated_at();

-- ============================================================
-- 4. symphony_orchestrator_config — per-project versioned settings
-- ============================================================
CREATE TABLE IF NOT EXISTS symphony_orchestrator_config (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  namespace       TEXT        NOT NULL
                    CHECK (namespace ~ '^[a-z0-9][a-z0-9._-]*$' AND length(namespace) <= 63),
  project_id      UUID        REFERENCES work_item(id) ON DELETE CASCADE,
  version         INTEGER     NOT NULL DEFAULT 1,
  config          JSONB       NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (namespace, project_id, version)
);

CREATE INDEX IF NOT EXISTS idx_symphony_orchestrator_config_namespace
  ON symphony_orchestrator_config(namespace);
CREATE INDEX IF NOT EXISTS idx_symphony_orchestrator_config_project
  ON symphony_orchestrator_config(project_id);

-- updated_at trigger
CREATE OR REPLACE FUNCTION set_symphony_orchestrator_config_updated_at()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_symphony_orchestrator_config_updated_at ON symphony_orchestrator_config;
CREATE TRIGGER trg_symphony_orchestrator_config_updated_at
  BEFORE UPDATE ON symphony_orchestrator_config
  FOR EACH ROW EXECUTE FUNCTION set_symphony_orchestrator_config_updated_at();

-- ============================================================
-- 5. symphony_notification_rule — event->channel notification mapping
-- Valid events require a migration to update this CHECK constraint.
-- ============================================================
CREATE TABLE IF NOT EXISTS symphony_notification_rule (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  namespace       TEXT        NOT NULL
                    CHECK (namespace ~ '^[a-z0-9][a-z0-9._-]*$' AND length(namespace) <= 63),
  project_id      UUID        REFERENCES work_item(id) ON DELETE CASCADE,
  -- Notification event: adding new events requires a migration to update this CHECK
  event           TEXT        NOT NULL
                    CHECK (event IN (
                      'run_failed', 'run_succeeded', 'run_paused', 'run_stalled',
                      'budget_warning', 'budget_exceeded',
                      'host_degraded', 'host_offline',
                      'cleanup_failed', 'cleanup_slo_breach',
                      'secret_rotation_detected', 'secret_validation_failed',
                      'approval_required', 'merge_ready'
                    )),
  channel         TEXT        NOT NULL
                    CHECK (channel IN ('webhook', 'email', 'slack', 'discord')),
  destination     TEXT        NOT NULL CHECK (length(TRIM(destination)) > 0),
  filter          JSONB,
  enabled         BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_symphony_notification_rule_namespace
  ON symphony_notification_rule(namespace);
CREATE INDEX IF NOT EXISTS idx_symphony_notification_rule_event
  ON symphony_notification_rule(event) WHERE enabled = TRUE;

-- updated_at trigger
CREATE OR REPLACE FUNCTION set_symphony_notification_rule_updated_at()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_symphony_notification_rule_updated_at ON symphony_notification_rule;
CREATE TRIGGER trg_symphony_notification_rule_updated_at
  BEFORE UPDATE ON symphony_notification_rule
  FOR EACH ROW EXECUTE FUNCTION set_symphony_notification_rule_updated_at();
