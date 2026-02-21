-- ============================================================
-- Down migration 101: Remove HA observations aggregate policy
-- Reverse of 101_ha_observations_aggregate_policy.up.sql
-- Must run before 095 down (which drops the materialized view).
-- ============================================================

SELECT remove_continuous_aggregate_policy('ha_observations_hourly', if_exists => true)
