-- ============================================================
-- Migration 101: HA observations continuous aggregate policy
-- Epic #1440 — HA observation pipeline
-- Issue #1544 — Split from migration 095 so that each migration
--   file contains a single SQL statement, avoiding the implicit
--   transaction that golang-migrate creates for multi-statement
--   files (which breaks TimescaleDB continuous aggregate DDL).
-- ============================================================

SELECT add_continuous_aggregate_policy('ha_observations_hourly',
  start_offset => INTERVAL '3 hours',
  end_offset => INTERVAL '30 minutes',
  schedule_interval => INTERVAL '1 hour',
  if_not_exists => TRUE)
