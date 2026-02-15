-- Migration 066: Geolocation fields for memory system
-- Part of Epic #1204, Issue #1205

-- Enable cube + earthdistance extensions for proximity queries
CREATE EXTENSION IF NOT EXISTS cube;
CREATE EXTENSION IF NOT EXISTS earthdistance;

-- Add geo columns to memory table
ALTER TABLE memory ADD COLUMN IF NOT EXISTS lat double precision;
ALTER TABLE memory ADD COLUMN IF NOT EXISTS lng double precision;
ALTER TABLE memory ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE memory ADD COLUMN IF NOT EXISTS place_label text;
ALTER TABLE memory ADD COLUMN IF NOT EXISTS location_embedding vector(1024);

-- lat/lng must be provided together
ALTER TABLE memory ADD CONSTRAINT chk_memory_geo_pair
  CHECK ((lat IS NULL AND lng IS NULL) OR (lat IS NOT NULL AND lng IS NOT NULL));

-- Valid coordinate ranges
ALTER TABLE memory ADD CONSTRAINT chk_memory_lat_range
  CHECK (lat IS NULL OR (lat >= -90 AND lat <= 90));
ALTER TABLE memory ADD CONSTRAINT chk_memory_lng_range
  CHECK (lng IS NULL OR (lng >= -180 AND lng <= 180));

-- Index for proximity queries
CREATE INDEX IF NOT EXISTS idx_memory_geo
  ON memory (lat, lng) WHERE lat IS NOT NULL;

-- HNSW index for location embedding similarity
CREATE INDEX IF NOT EXISTS idx_memory_location_embedding
  ON memory USING hnsw (location_embedding vector_cosine_ops)
  WHERE location_embedding IS NOT NULL;

-- Documentation
COMMENT ON COLUMN memory.lat IS 'WGS84 latitude of location context for this memory';
COMMENT ON COLUMN memory.lng IS 'WGS84 longitude of location context for this memory';
COMMENT ON COLUMN memory.address IS 'Reverse-geocoded address for the memory location';
COMMENT ON COLUMN memory.place_label IS 'Short human-friendly place name';
COMMENT ON COLUMN memory.location_embedding IS 'Separate embedding for address+place_label (1024 dims, same provider as content)';
