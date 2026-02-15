-- Down migration 066: Remove geolocation fields from memory
DROP INDEX IF EXISTS idx_memory_location_embedding;
DROP INDEX IF EXISTS idx_memory_geo;
ALTER TABLE memory DROP CONSTRAINT IF EXISTS chk_memory_lng_range;
ALTER TABLE memory DROP CONSTRAINT IF EXISTS chk_memory_lat_range;
ALTER TABLE memory DROP CONSTRAINT IF EXISTS chk_memory_geo_pair;
ALTER TABLE memory DROP COLUMN IF EXISTS location_embedding;
ALTER TABLE memory DROP COLUMN IF EXISTS place_label;
ALTER TABLE memory DROP COLUMN IF EXISTS address;
ALTER TABLE memory DROP COLUMN IF EXISTS lng;
ALTER TABLE memory DROP COLUMN IF EXISTS lat;
-- Note: Do not drop cube/earthdistance extensions as other code may use them
