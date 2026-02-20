-- ============================================================
-- Down migration 094: Remove HA observation tables
-- Reverse of 094_ha_observations_tables.up.sql
-- NOTE: Continuous aggregate dropped in 095 down migration.
-- ============================================================

-- 1. Remove retention policy before dropping hypertable
SELECT remove_retention_policy('ha_observations', if_exists => TRUE);

-- 2. Drop tables in correct order (ha_anomalies first due to FK on ha_routines)
DROP TABLE IF EXISTS ha_anomalies;
DROP TABLE IF EXISTS ha_state_snapshots;
DROP TABLE IF EXISTS ha_routines;
DROP TABLE IF EXISTS ha_observations;
