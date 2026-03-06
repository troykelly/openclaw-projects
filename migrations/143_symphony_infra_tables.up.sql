-- ============================================================
-- Migration 143: Symphony infrastructure tables
-- Epic #2186 — Symphony Orchestration, Issue #2192
-- Tables: symphony_container, symphony_cleanup_item,
--   symphony_secret_deployment, symphony_orchestrator_heartbeat,
--   symphony_github_rate_limit, symphony_circuit_breaker
-- ============================================================

-- ============================================================
-- 1. symphony_container — container tracking for orphan detection
-- P1-3: warm_state CHECK matches symphony_workspace warm_state values
-- ============================================================
CREATE TABLE IF NOT EXISTS symphony_container (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  namespace       TEXT        NOT NULL
                    CHECK (namespace ~ '^[a-z0-9][a-z0-9._-]*$' AND length(namespace) <= 63),
  connection_id   UUID        NOT NULL REFERENCES terminal_connection(id) ON DELETE CASCADE,
  container_id    TEXT        NOT NULL CHECK (length(TRIM(container_id)) > 0),
  image           TEXT,
  warm_state      TEXT        NOT NULL DEFAULT 'cold'
                    CHECK (warm_state IN ('cold', 'warming', 'warm', 'cooling', 'dirty')),
  max_ttl_hours   INTEGER,
  started_at      TIMESTAMPTZ,
  last_seen_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_symphony_container_namespace
  ON symphony_container (namespace);

CREATE INDEX IF NOT EXISTS idx_symphony_container_connection
  ON symphony_container (connection_id);

-- updated_at trigger
CREATE OR REPLACE FUNCTION set_symphony_container_updated_at()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_symphony_container_updated_at ON symphony_container;
CREATE TRIGGER trg_symphony_container_updated_at
  BEFORE UPDATE ON symphony_container
  FOR EACH ROW EXECUTE FUNCTION set_symphony_container_updated_at();

-- ============================================================
-- 2. symphony_cleanup_item — remediation queue with SLO tracking
-- ============================================================
CREATE TABLE IF NOT EXISTS symphony_cleanup_item (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  namespace       TEXT        NOT NULL
                    CHECK (namespace ~ '^[a-z0-9][a-z0-9._-]*$' AND length(namespace) <= 63),
  resource_type   TEXT        NOT NULL
                    CHECK (resource_type IN ('container', 'worktree', 'branch', 'secret', 'workspace')),
  resource_id     TEXT        NOT NULL CHECK (length(TRIM(resource_id)) > 0),
  status          TEXT        NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'in_progress', 'completed', 'failed', 'skipped')),
  reason          TEXT,
  run_id          UUID        REFERENCES symphony_run(id) ON DELETE SET NULL,
  error_message   TEXT,
  attempts        INTEGER     NOT NULL DEFAULT 0,
  slo_deadline_at TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_symphony_cleanup_pending
  ON symphony_cleanup_item (created_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_symphony_cleanup_namespace
  ON symphony_cleanup_item (namespace);

-- updated_at trigger
CREATE OR REPLACE FUNCTION set_symphony_cleanup_item_updated_at()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_symphony_cleanup_item_updated_at ON symphony_cleanup_item;
CREATE TRIGGER trg_symphony_cleanup_item_updated_at
  BEFORE UPDATE ON symphony_cleanup_item
  FOR EACH ROW EXECUTE FUNCTION set_symphony_cleanup_item_updated_at();

-- ============================================================
-- 3. symphony_secret_deployment — secret version + deployment tracking
-- ============================================================
CREATE TABLE IF NOT EXISTS symphony_secret_deployment (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  namespace       TEXT        NOT NULL
                    CHECK (namespace ~ '^[a-z0-9][a-z0-9._-]*$' AND length(namespace) <= 63),
  connection_id   UUID        NOT NULL REFERENCES terminal_connection(id) ON DELETE CASCADE,
  secret_name     TEXT        NOT NULL CHECK (length(TRIM(secret_name)) > 0),
  secret_version  TEXT        NOT NULL CHECK (length(TRIM(secret_version)) > 0),
  deployed_path   TEXT        NOT NULL CHECK (length(TRIM(deployed_path)) > 0),
  deployed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  validated_at    TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_symphony_secret_deployment_namespace
  ON symphony_secret_deployment (namespace);

CREATE INDEX IF NOT EXISTS idx_symphony_secret_deployment_connection
  ON symphony_secret_deployment (connection_id);

-- updated_at trigger
CREATE OR REPLACE FUNCTION set_symphony_secret_deployment_updated_at()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_symphony_secret_deployment_updated_at ON symphony_secret_deployment;
CREATE TRIGGER trg_symphony_secret_deployment_updated_at
  BEFORE UPDATE ON symphony_secret_deployment
  FOR EACH ROW EXECUTE FUNCTION set_symphony_secret_deployment_updated_at();

-- ============================================================
-- 4. symphony_orchestrator_heartbeat — orchestrator instance health
-- ============================================================
CREATE TABLE IF NOT EXISTS symphony_orchestrator_heartbeat (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  namespace         TEXT        NOT NULL
                      CHECK (namespace ~ '^[a-z0-9][a-z0-9._-]*$' AND length(namespace) <= 63),
  orchestrator_id   TEXT        NOT NULL UNIQUE,
  last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  active_runs       INTEGER     NOT NULL DEFAULT 0,
  metadata          JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_symphony_heartbeat_namespace
  ON symphony_orchestrator_heartbeat (namespace);

CREATE INDEX IF NOT EXISTS idx_symphony_heartbeat_last
  ON symphony_orchestrator_heartbeat (last_heartbeat_at);

-- updated_at trigger
CREATE OR REPLACE FUNCTION set_symphony_orchestrator_heartbeat_updated_at()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_symphony_orchestrator_heartbeat_updated_at ON symphony_orchestrator_heartbeat;
CREATE TRIGGER trg_symphony_orchestrator_heartbeat_updated_at
  BEFORE UPDATE ON symphony_orchestrator_heartbeat
  FOR EACH ROW EXECUTE FUNCTION set_symphony_orchestrator_heartbeat_updated_at();

-- ============================================================
-- 5. symphony_github_rate_limit — GitHub API rate budget
-- ============================================================
CREATE TABLE IF NOT EXISTS symphony_github_rate_limit (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  namespace       TEXT        NOT NULL
                    CHECK (namespace ~ '^[a-z0-9][a-z0-9._-]*$' AND length(namespace) <= 63),
  resource        TEXT        NOT NULL CHECK (length(TRIM(resource)) > 0),
  remaining       INTEGER     NOT NULL,
  "limit"         INTEGER     NOT NULL,
  resets_at       TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (namespace, resource)
);

CREATE INDEX IF NOT EXISTS idx_symphony_rate_limit_namespace
  ON symphony_github_rate_limit (namespace);

-- updated_at trigger
CREATE OR REPLACE FUNCTION set_symphony_github_rate_limit_updated_at()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_symphony_github_rate_limit_updated_at ON symphony_github_rate_limit;
CREATE TRIGGER trg_symphony_github_rate_limit_updated_at
  BEFORE UPDATE ON symphony_github_rate_limit
  FOR EACH ROW EXECUTE FUNCTION set_symphony_github_rate_limit_updated_at();

-- ============================================================
-- 6. symphony_circuit_breaker — circuit breaker state persistence
-- Persists circuit breaker state across orchestrator restarts.
-- ============================================================
CREATE TABLE IF NOT EXISTS symphony_circuit_breaker (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  namespace       TEXT        NOT NULL
                    CHECK (namespace ~ '^[a-z0-9][a-z0-9._-]*$' AND length(namespace) <= 63),
  circuit_name    TEXT        NOT NULL CHECK (length(TRIM(circuit_name)) > 0),
  state           TEXT        NOT NULL DEFAULT 'closed'
                    CHECK (state IN ('closed', 'open', 'half_open')),
  failure_count   INTEGER     NOT NULL DEFAULT 0,
  last_failure_at TIMESTAMPTZ,
  opened_at       TIMESTAMPTZ,
  half_open_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (namespace, circuit_name)
);

CREATE INDEX IF NOT EXISTS idx_symphony_circuit_breaker_namespace
  ON symphony_circuit_breaker (namespace);

-- updated_at trigger
CREATE OR REPLACE FUNCTION set_symphony_circuit_breaker_updated_at()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_symphony_circuit_breaker_updated_at ON symphony_circuit_breaker;
CREATE TRIGGER trg_symphony_circuit_breaker_updated_at
  BEFORE UPDATE ON symphony_circuit_breaker
  FOR EACH ROW EXECUTE FUNCTION set_symphony_circuit_breaker_updated_at();
