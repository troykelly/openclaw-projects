-- no-transaction
-- ============================================================
-- Down migration 098: Remove HA entity time patterns aggregate
-- Reverse of 098_ha_entity_time_patterns.up.sql
-- ============================================================

SELECT remove_continuous_aggregate_policy('ha_entity_time_patterns', if_exists => true);
DROP MATERIALIZED VIEW IF EXISTS ha_entity_time_patterns;
