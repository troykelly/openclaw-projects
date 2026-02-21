-- no-transaction
-- ============================================================
-- Migration 095: HA observations continuous aggregate
-- Epic #1440 — HA observation pipeline
-- Issue #1447 — Split from 094 because CREATE MATERIALIZED VIEW
--   WITH (timescaledb.continuous) cannot run inside a transaction.
--
-- NOTE: This file MUST contain exactly one SQL statement.
-- golang-migrate sends the whole file as a single Exec() call, so PostgreSQL
-- auto-commits a single statement (no implicit transaction).
-- The TypeScript test helper also needs the -- no-transaction
-- marker above so it skips the explicit BEGIN/COMMIT wrapper.
-- The continuous aggregate policy is added in migration 101.
-- ============================================================

CREATE MATERIALIZED VIEW ha_observations_hourly
WITH (timescaledb.continuous) AS
SELECT
  namespace,
  time_bucket('1 hour', timestamp) AS bucket,
  domain,
  entity_id,
  COUNT(*) AS change_count,
  AVG(score) AS avg_score,
  MAX(score) AS max_score,
  jsonb_agg(DISTINCT scene_label) FILTER (WHERE scene_label IS NOT NULL) AS scenes
FROM ha_observations
GROUP BY namespace, bucket, domain, entity_id
