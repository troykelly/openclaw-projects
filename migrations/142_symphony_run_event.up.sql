-- no-transaction
-- ============================================================
-- Migration 142: symphony_run_event — TimescaleDB hypertable
-- Epic #2186 — Symphony Orchestration, Issue #2192
--
-- Must run outside a transaction because:
--   - create_hypertable cannot run inside a transaction block
--   - add_columnstore_policy / add_retention_policy likewise
-- ============================================================

-- P1-2: TimescaleDB hypertables require the partitioning column (time)
-- to be part of any unique/primary key. We use a composite unique index
-- on (id, emitted_at) for row identity instead of a standalone PK.
CREATE TABLE IF NOT EXISTS symphony_run_event (
  id          UUID        NOT NULL DEFAULT gen_random_uuid(),
  namespace   TEXT        NOT NULL
                CHECK (namespace ~ '^[a-z0-9][a-z0-9._-]*$' AND length(namespace) <= 63),
  run_id      UUID        NOT NULL,
  emitted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  kind        TEXT        NOT NULL CHECK (length(TRIM(kind)) > 0),
  payload     JSONB       NOT NULL DEFAULT '{}',
  actor       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

SELECT create_hypertable('symphony_run_event', 'emitted_at',
  chunk_time_interval => INTERVAL '7 days',
  if_not_exists => TRUE);

-- Composite unique index including time column for TimescaleDB compatibility
CREATE UNIQUE INDEX IF NOT EXISTS idx_symphony_run_event_id_time
  ON symphony_run_event (id, emitted_at);

-- Index for common query: events by run in time order
CREATE INDEX IF NOT EXISTS idx_symphony_run_event_run_time
  ON symphony_run_event (run_id, emitted_at DESC);

CREATE INDEX IF NOT EXISTS idx_symphony_run_event_namespace_time
  ON symphony_run_event (namespace, emitted_at DESC);

-- Enable columnstore before adding compression policy (required in TimescaleDB 2.25+)
ALTER TABLE symphony_run_event SET (timescaledb.enable_columnstore = true);

-- Columnstore (compression) policy: compress chunks older than 30 days
-- TimescaleDB 2.25+ uses add_columnstore_policy (a procedure, not a function)
CALL add_columnstore_policy('symphony_run_event', INTERVAL '30 days',
  if_not_exists => TRUE);

-- Retention policy: drop chunks older than 90 days
SELECT add_retention_policy('symphony_run_event', INTERVAL '90 days',
  if_not_exists => TRUE);
