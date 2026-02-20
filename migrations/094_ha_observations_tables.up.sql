-- ============================================================
-- Migration 094: Home Assistant observation tables
-- Epic #1440 — HA observation pipeline
-- Issue #1447 — DB migration for ha_observations, ha_routines,
--   ha_anomalies, ha_state_snapshots
-- ============================================================

-- ============================================================
-- 1. ha_observations — TimescaleDB hypertable for state changes
-- ============================================================
-- NOTE: TimescaleDB requires the partitioning column (timestamp) to be
-- part of any unique/primary key. Following the geo_location pattern,
-- we omit a standalone PRIMARY KEY on id and rely on the (id, timestamp)
-- unique index for row identity.

CREATE TABLE ha_observations (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  namespace TEXT NOT NULL DEFAULT 'default'
    CHECK (namespace ~ '^[a-z0-9][a-z0-9._-]*$' AND length(namespace) <= 63),
  timestamp TIMESTAMPTZ NOT NULL,
  batch_id UUID,
  entity_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  from_state TEXT,
  to_state TEXT NOT NULL,
  attributes JSONB DEFAULT '{}',
  score SMALLINT DEFAULT 0 CHECK (score BETWEEN 0 AND 10),
  scene_label TEXT,
  context JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

SELECT create_hypertable('ha_observations', 'timestamp',
  chunk_time_interval => INTERVAL '7 days',
  if_not_exists => TRUE);

-- Unique row identity: (id, timestamp) as promised above for the hypertable
CREATE UNIQUE INDEX idx_ha_obs_id_timestamp ON ha_observations (id, timestamp);

-- Indexes for common query patterns
CREATE INDEX idx_ha_obs_namespace_time ON ha_observations (namespace, timestamp DESC);
CREATE INDEX idx_ha_obs_entity_time ON ha_observations (entity_id, timestamp DESC);
CREATE INDEX idx_ha_obs_domain ON ha_observations (domain);
CREATE INDEX idx_ha_obs_score ON ha_observations (score) WHERE score >= 4;
CREATE INDEX idx_ha_obs_batch ON ha_observations (batch_id) WHERE batch_id IS NOT NULL;
CREATE INDEX idx_ha_obs_scene ON ha_observations (scene_label) WHERE scene_label IS NOT NULL;

-- 30-day retention policy on raw observation data
SELECT add_retention_policy('ha_observations', INTERVAL '30 days',
  if_not_exists => TRUE);

-- NOTE: Continuous aggregate (ha_observations_hourly) is created in
-- migration 095 because CREATE MATERIALIZED VIEW ... WITH
-- (timescaledb.continuous) cannot run inside a transaction block.

-- ============================================================
-- 2. ha_routines — detected patterns and routines
-- ============================================================

CREATE TABLE ha_routines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  namespace TEXT NOT NULL DEFAULT 'default'
    CHECK (namespace ~ '^[a-z0-9][a-z0-9._-]*$' AND length(namespace) <= 63),
  key TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  confidence REAL NOT NULL DEFAULT 0.0 CHECK (confidence BETWEEN 0.0 AND 1.0),
  observations_count INTEGER NOT NULL DEFAULT 0,
  first_seen TIMESTAMPTZ NOT NULL,
  last_seen TIMESTAMPTZ NOT NULL,
  time_window JSONB NOT NULL DEFAULT '{}',
  days TEXT[] DEFAULT '{}',
  sequence JSONB NOT NULL DEFAULT '[]',
  suggested_automation JSONB,
  status TEXT NOT NULL DEFAULT 'tentative'
    CHECK (status IN ('tentative', 'confirmed', 'rejected', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (namespace, key)
);

CREATE INDEX idx_ha_routines_namespace_status ON ha_routines (namespace, status);
CREATE INDEX idx_ha_routines_confidence ON ha_routines (confidence DESC) WHERE status != 'rejected';

-- ============================================================
-- 3. ha_anomalies — detected anomalies in HA state
-- ============================================================

CREATE TABLE ha_anomalies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  namespace TEXT NOT NULL DEFAULT 'default'
    CHECK (namespace ~ '^[a-z0-9][a-z0-9._-]*$' AND length(namespace) <= 63),
  timestamp TIMESTAMPTZ NOT NULL,
  routine_id UUID REFERENCES ha_routines(id) ON DELETE SET NULL,
  score SMALLINT NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 10),
  reason TEXT NOT NULL,
  entities TEXT[] NOT NULL DEFAULT '{}',
  notified BOOLEAN NOT NULL DEFAULT FALSE,
  resolved BOOLEAN NOT NULL DEFAULT FALSE,
  context JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ha_anomalies_namespace_time ON ha_anomalies (namespace, timestamp DESC);
CREATE INDEX idx_ha_anomalies_unresolved ON ha_anomalies (namespace) WHERE resolved = FALSE;
CREATE INDEX idx_ha_anomalies_routine ON ha_anomalies (routine_id) WHERE routine_id IS NOT NULL;

-- ============================================================
-- 4. ha_state_snapshots — daily state summaries
-- ============================================================

CREATE TABLE ha_state_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  namespace TEXT NOT NULL DEFAULT 'default'
    CHECK (namespace ~ '^[a-z0-9][a-z0-9._-]*$' AND length(namespace) <= 63),
  snapshot_date DATE NOT NULL,
  entity_count INTEGER NOT NULL,
  active_count INTEGER NOT NULL,
  domain_summary JSONB NOT NULL DEFAULT '{}',
  notable_states JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (namespace, snapshot_date)
);
