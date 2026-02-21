-- ============================================================
-- Migration 102: HA entity time patterns continuous aggregate policy
-- Epic #1440 — HA observation pipeline
-- Issue #1544 — Split from migration 098 so that each migration
--   file contains a single SQL statement, avoiding the implicit
--   transaction that golang-migrate creates for multi-statement
--   files (which breaks TimescaleDB continuous aggregate DDL).
-- ============================================================

SELECT add_continuous_aggregate_policy('ha_entity_time_patterns',
  start_offset => INTERVAL '3 days',
  end_offset => INTERVAL '1 hour',
  schedule_interval => INTERVAL '1 day',
  if_not_exists => TRUE)
