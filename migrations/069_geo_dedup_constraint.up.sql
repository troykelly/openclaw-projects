-- Migration 069: Add dedup constraint for concurrent geo_location inserts
-- Issue #1268 — TOCTOU deduplication guard
--
-- TimescaleDB hypertables require unique indexes to include all partitioning
-- columns. Since geo_location is partitioned by `time`, we include
-- date_trunc('second', time) so that two inserts for the same entity within
-- the same second are rejected at the DB level.
--
-- Note: CREATE UNIQUE INDEX (not CONCURRENTLY) is used because CONCURRENTLY
-- cannot run inside a transaction block, and migrations typically run in one.

CREATE UNIQUE INDEX IF NOT EXISTS idx_geo_location_dedup
  ON geo_location (provider_id, user_email, entity_id, date_trunc('second', time));
