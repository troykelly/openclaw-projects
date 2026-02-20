-- no-transaction
-- ============================================================
-- Down migration 095: Remove HA observations continuous aggregate
-- Reverse of 095_ha_observations_aggregates.up.sql
-- ============================================================

SELECT remove_continuous_aggregate_policy('ha_observations_hourly', if_exists => true);
DROP MATERIALIZED VIEW IF EXISTS ha_observations_hourly;
