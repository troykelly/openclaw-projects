-- Migration 069 (down): Remove dedup constraint
-- Issue #1268

DROP INDEX IF EXISTS idx_geo_location_dedup;
