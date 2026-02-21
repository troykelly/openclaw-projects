-- ============================================================
-- Down migration 102: Remove HA entity time patterns aggregate policy
-- Reverse of 102_ha_entity_time_patterns_policy.up.sql
-- Must run before 098 down (which drops the materialized view).
-- ============================================================

SELECT remove_continuous_aggregate_policy('ha_entity_time_patterns', if_exists => true)
