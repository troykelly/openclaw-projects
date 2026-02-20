-- no-transaction
-- ============================================================
-- Migration 098: HA entity time patterns continuous aggregate
-- Epic #1440 — HA observation pipeline
-- Issue #1456 — Routine detection time-pattern aggregates.
--   Cannot run inside a transaction (timescaledb.continuous).
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
GROUP BY namespace, entity_id, domain, day_of_week, hour_of_day, day_bucket;

SELECT add_continuous_aggregate_policy('ha_entity_time_patterns',
  start_offset => INTERVAL '3 days',
  end_offset => INTERVAL '1 hour',
  schedule_interval => INTERVAL '1 day',
  if_not_exists => TRUE);
