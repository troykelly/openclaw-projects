-- no-transaction
-- ============================================================
-- Migration 095: HA observations continuous aggregate
-- Epic #1440 — HA observation pipeline
-- Issue #1447 — Split from 094 because CREATE MATERIALIZED VIEW
--   WITH (timescaledb.continuous) cannot run inside a transaction.
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
GROUP BY namespace, bucket, domain, entity_id;

SELECT add_continuous_aggregate_policy('ha_observations_hourly',
  start_offset => INTERVAL '3 hours',
  end_offset => INTERVAL '30 minutes',
  schedule_interval => INTERVAL '1 hour',
  if_not_exists => TRUE);
