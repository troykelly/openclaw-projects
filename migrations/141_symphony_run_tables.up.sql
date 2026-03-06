-- ============================================================
-- Migration 141: Symphony run lifecycle tables
-- Epic #2186 — Symphony Orchestration, Issue #2192
-- Tables: symphony_claim, symphony_workspace, symphony_run,
--   symphony_provisioning_step, symphony_run_terminal
-- ============================================================

-- ============================================================
-- 1. symphony_claim — issue claim lock with fencing epoch
-- Active claim states: 'pending', 'assigned', 'active'
-- These states participate in the partial unique index to
-- prevent duplicate active claims on the same work item.
-- Terminal states: 'released', 'expired', 'completed'
-- ============================================================
CREATE TABLE IF NOT EXISTS symphony_claim (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  namespace       TEXT        NOT NULL
                    CHECK (namespace ~ '^[a-z0-9][a-z0-9._-]*$' AND length(namespace) <= 63),
  work_item_id    UUID        NOT NULL REFERENCES work_item(id) ON DELETE CASCADE,
  orchestrator_id TEXT        NOT NULL CHECK (length(TRIM(orchestrator_id)) > 0),
  status          TEXT        NOT NULL
                    CHECK (status IN ('pending', 'assigned', 'active', 'released', 'expired', 'completed')),
  claim_epoch     INTEGER     NOT NULL DEFAULT 1,
  lease_expires_at TIMESTAMPTZ,
  claimed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  released_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- P1-1: Partial unique index enumerates exact active states in WHERE clause.
-- Only one active claim (pending/assigned/active) per work_item at a time.
CREATE UNIQUE INDEX IF NOT EXISTS idx_symphony_claim_active_work_item
  ON symphony_claim (work_item_id)
  WHERE status IN ('pending', 'assigned', 'active');

CREATE INDEX IF NOT EXISTS idx_symphony_claim_lease_expires
  ON symphony_claim (lease_expires_at)
  WHERE lease_expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_symphony_claim_orchestrator
  ON symphony_claim (orchestrator_id);

CREATE INDEX IF NOT EXISTS idx_symphony_claim_namespace
  ON symphony_claim (namespace);

-- updated_at trigger
CREATE OR REPLACE FUNCTION set_symphony_claim_updated_at()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_symphony_claim_updated_at ON symphony_claim;
CREATE TRIGGER trg_symphony_claim_updated_at
  BEFORE UPDATE ON symphony_claim
  FOR EACH ROW EXECUTE FUNCTION set_symphony_claim_updated_at();

-- ============================================================
-- 2. symphony_workspace — per-host workspace tracking
-- ============================================================
CREATE TABLE IF NOT EXISTS symphony_workspace (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  namespace       TEXT        NOT NULL
                    CHECK (namespace ~ '^[a-z0-9][a-z0-9._-]*$' AND length(namespace) <= 63),
  connection_id   UUID        NOT NULL REFERENCES terminal_connection(id) ON DELETE CASCADE,
  worktree_path   TEXT        NOT NULL CHECK (length(TRIM(worktree_path)) > 0),
  container_id    TEXT,
  warm_state      TEXT        NOT NULL DEFAULT 'cold'
                    CHECK (warm_state IN ('cold', 'warming', 'warm', 'cooling', 'dirty')),
  disk_usage_mb   INTEGER,
  last_used_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_symphony_workspace_connection_warm
  ON symphony_workspace (connection_id, warm_state);

CREATE INDEX IF NOT EXISTS idx_symphony_workspace_namespace
  ON symphony_workspace (namespace);

-- updated_at trigger
CREATE OR REPLACE FUNCTION set_symphony_workspace_updated_at()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_symphony_workspace_updated_at ON symphony_workspace;
CREATE TRIGGER trg_symphony_workspace_updated_at
  BEFORE UPDATE ON symphony_workspace
  FOR EACH ROW EXECUTE FUNCTION set_symphony_workspace_updated_at();

-- ============================================================
-- 3. symphony_run — run attempts with full state machine
-- Status CHECK: 22 values
-- Stage CHECK: 7 values
-- state_version supports idempotent transitions
-- ============================================================
CREATE TABLE IF NOT EXISTS symphony_run (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  namespace       TEXT        NOT NULL
                    CHECK (namespace ~ '^[a-z0-9][a-z0-9._-]*$' AND length(namespace) <= 63),
  work_item_id    UUID        NOT NULL REFERENCES work_item(id) ON DELETE CASCADE,
  project_id      UUID        REFERENCES work_item(id) ON DELETE SET NULL,
  workspace_id    UUID        REFERENCES symphony_workspace(id) ON DELETE SET NULL,
  claim_id        UUID        REFERENCES symphony_claim(id) ON DELETE SET NULL,
  orchestrator_id TEXT,
  attempt         INTEGER     NOT NULL DEFAULT 1,
  status          TEXT        NOT NULL DEFAULT 'queued'
                    CHECK (status IN (
                      'queued', 'claiming', 'claimed', 'provisioning', 'provisioned',
                      'cloning', 'cloned', 'installing', 'installed', 'branching',
                      'branched', 'executing', 'paused', 'resuming', 'reviewing',
                      'pushing', 'pr_created', 'merging', 'succeeded', 'failed',
                      'cancelled', 'timed_out'
                    )),
  stage           TEXT        NOT NULL DEFAULT 'queued'
                    CHECK (stage IN ('queued', 'setup', 'execution', 'review', 'delivery', 'teardown', 'terminal')),
  state_version   INTEGER     NOT NULL DEFAULT 1,
  trace_id        TEXT,
  branch_name     TEXT,
  pr_number       INTEGER,
  pr_url          TEXT,
  manifest        JSONB,
  tokens_used     BIGINT,
  cost_usd        NUMERIC(12,6),
  error_message   TEXT,
  error_code      TEXT,
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Run idempotency: unique (work_item_id, attempt) for active runs only.
-- Active statuses are all except the terminal ones: succeeded, failed, cancelled, timed_out.
CREATE UNIQUE INDEX IF NOT EXISTS idx_symphony_run_idempotent
  ON symphony_run (work_item_id, attempt)
  WHERE status NOT IN ('succeeded', 'failed', 'cancelled', 'timed_out');

CREATE INDEX IF NOT EXISTS idx_symphony_run_project_active
  ON symphony_run (project_id, status)
  WHERE project_id IS NOT NULL
    AND status NOT IN ('succeeded', 'failed', 'cancelled', 'timed_out');

CREATE INDEX IF NOT EXISTS idx_symphony_run_work_item
  ON symphony_run (work_item_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_symphony_run_orchestrator
  ON symphony_run (orchestrator_id)
  WHERE orchestrator_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_symphony_run_workspace
  ON symphony_run (workspace_id)
  WHERE workspace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_symphony_run_namespace
  ON symphony_run (namespace);

-- updated_at trigger
CREATE OR REPLACE FUNCTION set_symphony_run_updated_at()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_symphony_run_updated_at ON symphony_run;
CREATE TRIGGER trg_symphony_run_updated_at
  BEFORE UPDATE ON symphony_run
  FOR EACH ROW EXECUTE FUNCTION set_symphony_run_updated_at();

-- ============================================================
-- 4. symphony_provisioning_step — 8-step pipeline tracking
-- ============================================================
CREATE TABLE IF NOT EXISTS symphony_provisioning_step (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          UUID        NOT NULL REFERENCES symphony_run(id) ON DELETE CASCADE,
  ordinal         INTEGER     NOT NULL,
  step_name       TEXT        NOT NULL
                    CHECK (step_name IN ('workspace', 'container', 'secrets', 'clone', 'install', 'branch', 'verify', 'snapshot')),
  status          TEXT        NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'rolled_back')),
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  error_message   TEXT,
  rollback_status TEXT        CHECK (rollback_status IS NULL OR rollback_status IN ('pending', 'running', 'completed', 'failed')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_symphony_provisioning_step_run_ordinal
  ON symphony_provisioning_step (run_id, ordinal);

CREATE INDEX IF NOT EXISTS idx_symphony_provisioning_step_run
  ON symphony_provisioning_step (run_id);

-- updated_at trigger
CREATE OR REPLACE FUNCTION set_symphony_provisioning_step_updated_at()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_symphony_provisioning_step_updated_at ON symphony_provisioning_step;
CREATE TRIGGER trg_symphony_provisioning_step_updated_at
  BEFORE UPDATE ON symphony_provisioning_step
  FOR EACH ROW EXECUTE FUNCTION set_symphony_provisioning_step_updated_at();

-- ============================================================
-- 5. symphony_run_terminal — run-to-terminal junction
-- Note: terminal_session_id references terminal_session(id),
-- but we use UUID without a FK to avoid cross-domain coupling
-- (terminal_session may be managed by a different subsystem).
-- ============================================================
CREATE TABLE IF NOT EXISTS symphony_run_terminal (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id              UUID        NOT NULL REFERENCES symphony_run(id) ON DELETE CASCADE,
  terminal_session_id UUID        NOT NULL,
  purpose             TEXT        NOT NULL DEFAULT 'primary'
                        CHECK (purpose IN ('primary', 'monitor', 'debug', 'review')),
  ordinal             INTEGER     NOT NULL DEFAULT 0,
  lifecycle           TEXT        NOT NULL DEFAULT 'active'
                        CHECK (lifecycle IN ('active', 'detached', 'closed')),
  attached_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  detached_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_symphony_run_terminal_run
  ON symphony_run_terminal (run_id);

CREATE INDEX IF NOT EXISTS idx_symphony_run_terminal_session
  ON symphony_run_terminal (terminal_session_id);
