-- Down migration 067: Remove geolocation provider system
-- Reverse order of up migration

-- ============================================================
-- 5. Remove user_setting columns
-- ============================================================

ALTER TABLE user_setting
  DROP COLUMN IF EXISTS geo_high_res_threshold_m,
  DROP COLUMN IF EXISTS geo_general_retention_days,
  DROP COLUMN IF EXISTS geo_high_res_retention_hours,
  DROP COLUMN IF EXISTS geo_auto_inject;

-- ============================================================
-- 4. Drop geo_location table (hypertable)
-- ============================================================

DROP TABLE IF EXISTS geo_location;

-- ============================================================
-- 3. Drop geo_provider_user table
-- ============================================================

DROP TRIGGER IF EXISTS geo_provider_user_updated_at ON geo_provider_user;
DROP FUNCTION IF EXISTS update_geo_provider_user_updated_at();
DROP TABLE IF EXISTS geo_provider_user;

-- ============================================================
-- 2. Drop geo_provider table
-- ============================================================

DROP TRIGGER IF EXISTS geo_provider_updated_at ON geo_provider;
DROP FUNCTION IF EXISTS update_geo_provider_updated_at();
DROP TABLE IF EXISTS geo_provider;

-- ============================================================
-- 1. Drop enum types
-- ============================================================

DROP TYPE IF EXISTS geo_provider_status;
DROP TYPE IF EXISTS geo_auth_type;
DROP TYPE IF EXISTS geo_provider_type;
