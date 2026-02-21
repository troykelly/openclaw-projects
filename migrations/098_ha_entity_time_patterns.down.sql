-- no-transaction
-- ============================================================
-- Down migration 098: Remove HA entity time patterns aggregate
-- Reverse of 098_ha_entity_time_patterns.up.sql
--
-- NOTE: Single statement only. The continuous aggregate policy
-- is removed in the down migration of 102 (which runs first
-- during rollback since higher-numbered migrations roll back
-- before lower-numbered ones).
-- The -- no-transaction marker ensures the TypeScript test
-- helper skips the explicit BEGIN/COMMIT wrapper.
-- ============================================================

DROP MATERIALIZED VIEW IF EXISTS ha_entity_time_patterns
