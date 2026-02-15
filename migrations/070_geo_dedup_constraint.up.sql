-- Migration 070: Add dedup constraint for concurrent geo_location inserts
-- Issue #1268 — TOCTOU deduplication guard
--
-- TimescaleDB hypertables require unique indexes to include all partitioning
-- columns as raw columns (expressions don't count). Since geo_location is
-- partitioned by `time`, we use the raw `time` column to prevent exact-
-- timestamp duplicates at the DB level.
--
-- For within-second dedup, the application layer uses pg_advisory_xact_lock
-- to serialize concurrent ingestion per (provider, user, entity) triple.

CREATE UNIQUE INDEX IF NOT EXISTS idx_geo_location_dedup
  ON geo_location (provider_id, user_email, entity_id, time);
