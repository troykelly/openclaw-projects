-- no-transaction
-- ============================================================
-- Down migration 095: Remove HA observations continuous aggregate
-- Reverse of 095_ha_observations_aggregates.up.sql
--
-- NOTE: Single statement only. The continuous aggregate policy
-- is removed in the down migration of 101 (which runs first
-- during rollback since higher-numbered migrations roll back
-- before lower-numbered ones).
-- The -- no-transaction marker ensures the TypeScript test
-- helper skips the explicit BEGIN/COMMIT wrapper.
-- ============================================================

DROP MATERIALIZED VIEW IF EXISTS ha_observations_hourly
