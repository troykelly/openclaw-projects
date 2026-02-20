-- ============================================================
-- Down migration 096: Remove HA entity tier configuration
-- Reverse of 096_ha_entity_tier_config.up.sql
-- ============================================================

DROP TABLE IF EXISTS ha_entity_tier_config;
