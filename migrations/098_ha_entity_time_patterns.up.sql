-- no-transaction
-- ============================================================
-- Migration 098: HA entity time patterns continuous aggregate
-- Epic #1440 — HA observation pipeline
-- Issue #1456 — Routine detection time-pattern aggregates.
--   Cannot run inside a transaction (timescaledb.continuous).
--
-- NOTE: This file MUST contain exactly one SQL statement.
-- golang-migrate sends the whole file as a single Exec() call, so PostgreSQL
-- auto-commits a single statement (no implicit transaction).
-- The TypeScript test helper also needs the -- no-transaction
-- marker above so it skips the explicit BEGIN/COMMIT wrapper.
-- The continuous aggregate policy is added in migration 102.
-- ============================================================

CREATE MATERIALIZED VIEW ha_entity_time_patterns
WITH (timescaledb.continuous) AS
SELECT
  namespace,
  entity_id,
  domain,
  EXTRACT(DOW FROM timestamp)::int AS day_of_week,
  EXTRACT(HOUR FROM timestamp)::int AS hour_of_day,
  time_bucket('1 day', timestamp) AS day_bucket,
  COUNT(*) AS change_count,
  AVG(score) AS avg_score
FROM ha_observations
GROUP BY namespace, entity_id, domain, day_of_week, hour_of_day, day_bucket
WITH NO DATA
