-- Migration 067: Geolocation provider system
-- Part of Epic #1242, Issue #1243
-- Creates provider tables, location hypertable, and user settings for geo ingestor plugin system

-- ============================================================
-- 1. Enum types
-- ============================================================

CREATE TYPE geo_provider_type AS ENUM ('home_assistant', 'mqtt', 'webhook');

CREATE TYPE geo_auth_type AS ENUM ('oauth2', 'access_token', 'mqtt_credentials', 'webhook_token');

CREATE TYPE geo_provider_status AS ENUM ('active', 'inactive', 'error', 'connecting');

-- ============================================================
-- 2. geo_provider — registered location source
-- ============================================================

CREATE TABLE geo_provider (
  id            uuid PRIMARY KEY DEFAULT new_uuid(),
  owner_email   text NOT NULL REFERENCES user_setting(email) ON DELETE CASCADE,
  provider_type geo_provider_type NOT NULL,
  auth_type     geo_auth_type NOT NULL,
  label         text NOT NULL,
  status        geo_provider_status NOT NULL DEFAULT 'inactive',
  status_message text,
  config        jsonb NOT NULL DEFAULT '{}',
  credentials   bytea,
  poll_interval_seconds integer,
  max_age_seconds       integer NOT NULL DEFAULT 900,
  is_shared     boolean NOT NULL DEFAULT false,
  last_seen_at  timestamptz,
  deleted_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_geo_provider_owner
  ON geo_provider (owner_email) WHERE deleted_at IS NULL;

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_geo_provider_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER geo_provider_updated_at
  BEFORE UPDATE ON geo_provider
  FOR EACH ROW
  EXECUTE FUNCTION update_geo_provider_updated_at();

COMMENT ON TABLE geo_provider IS 'Registered geolocation data sources (Home Assistant, MQTT brokers, webhooks)';
COMMENT ON COLUMN geo_provider.owner_email IS 'User who registered this provider';
COMMENT ON COLUMN geo_provider.provider_type IS 'Type of location source';
COMMENT ON COLUMN geo_provider.auth_type IS 'Authentication method used to connect';
COMMENT ON COLUMN geo_provider.label IS 'Human-friendly name for this provider';
COMMENT ON COLUMN geo_provider.status IS 'Current connection status';
COMMENT ON COLUMN geo_provider.status_message IS 'Details about current status (e.g. error message)';
COMMENT ON COLUMN geo_provider.config IS 'Provider-specific configuration (URLs, topics, etc.)';
COMMENT ON COLUMN geo_provider.credentials IS 'Encrypted credentials blob';
COMMENT ON COLUMN geo_provider.poll_interval_seconds IS 'How often to poll for updates (null = push only)';
COMMENT ON COLUMN geo_provider.max_age_seconds IS 'Maximum age before location data is considered stale (default 15 min)';
COMMENT ON COLUMN geo_provider.is_shared IS 'Whether this provider can supply data for multiple users';
COMMENT ON COLUMN geo_provider.last_seen_at IS 'Timestamp of last successful data receipt';
COMMENT ON COLUMN geo_provider.deleted_at IS 'Soft delete timestamp';

-- ============================================================
-- 3. geo_provider_user — maps providers to users with priority
-- ============================================================

CREATE TABLE geo_provider_user (
  id           uuid PRIMARY KEY DEFAULT new_uuid(),
  provider_id  uuid NOT NULL REFERENCES geo_provider(id) ON DELETE CASCADE,
  user_email   text NOT NULL REFERENCES user_setting(email) ON DELETE CASCADE,
  priority     integer NOT NULL DEFAULT 0,
  is_active    boolean NOT NULL DEFAULT true,
  entities     jsonb NOT NULL DEFAULT '[]',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_id, user_email)
);

CREATE INDEX idx_geo_provider_user_email
  ON geo_provider_user (user_email);

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_geo_provider_user_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER geo_provider_user_updated_at
  BEFORE UPDATE ON geo_provider_user
  FOR EACH ROW
  EXECUTE FUNCTION update_geo_provider_user_updated_at();

COMMENT ON TABLE geo_provider_user IS 'Maps geo providers to users with priority ordering and entity filtering';
COMMENT ON COLUMN geo_provider_user.provider_id IS 'Reference to the geo provider';
COMMENT ON COLUMN geo_provider_user.user_email IS 'User receiving location data from this provider';
COMMENT ON COLUMN geo_provider_user.priority IS 'Priority for source selection (higher = preferred)';
COMMENT ON COLUMN geo_provider_user.is_active IS 'Whether this mapping is currently active';
COMMENT ON COLUMN geo_provider_user.entities IS 'JSON array of entity IDs to track from this provider';

-- ============================================================
-- 4. geo_location — TimescaleDB hypertable for location data
-- ============================================================

CREATE TABLE geo_location (
  time             timestamptz NOT NULL,
  user_email       text NOT NULL,
  provider_id      uuid NOT NULL REFERENCES geo_provider(id) ON DELETE CASCADE,
  entity_id        text,
  lat              double precision NOT NULL CHECK (lat >= -90 AND lat <= 90),
  lng              double precision NOT NULL CHECK (lng >= -180 AND lng <= 180),
  accuracy_m       double precision,
  altitude_m       double precision,
  speed_mps        double precision,
  bearing          double precision,
  indoor_zone      text,
  address          text,
  place_label      text,
  raw_payload      jsonb,
  location_embedding vector(1024),
  embedding_status text DEFAULT 'pending'
    CHECK (embedding_status IN ('complete', 'pending', 'failed', 'skipped'))
);

-- Convert to TimescaleDB hypertable
SELECT create_hypertable('geo_location', 'time');

-- Indexes for common query patterns
CREATE INDEX idx_geo_location_user_time
  ON geo_location (user_email, time DESC);

CREATE INDEX idx_geo_location_provider_time
  ON geo_location (provider_id, time DESC);

CREATE INDEX idx_geo_location_coords
  ON geo_location (lat, lng);

-- HNSW index for location embedding similarity search
CREATE INDEX idx_geo_location_embedding
  ON geo_location USING hnsw (location_embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

COMMENT ON TABLE geo_location IS 'Time-series geolocation data from all providers (TimescaleDB hypertable)';
COMMENT ON COLUMN geo_location.time IS 'Timestamp of the location observation';
COMMENT ON COLUMN geo_location.user_email IS 'User this location belongs to';
COMMENT ON COLUMN geo_location.provider_id IS 'Provider that reported this location';
COMMENT ON COLUMN geo_location.entity_id IS 'Provider-specific entity identifier (e.g. HA device_tracker entity)';
COMMENT ON COLUMN geo_location.lat IS 'WGS84 latitude (-90 to 90)';
COMMENT ON COLUMN geo_location.lng IS 'WGS84 longitude (-180 to 180)';
COMMENT ON COLUMN geo_location.accuracy_m IS 'Horizontal accuracy in metres';
COMMENT ON COLUMN geo_location.altitude_m IS 'Altitude in metres above sea level';
COMMENT ON COLUMN geo_location.speed_mps IS 'Speed in metres per second';
COMMENT ON COLUMN geo_location.bearing IS 'Compass bearing in degrees (0-360)';
COMMENT ON COLUMN geo_location.indoor_zone IS 'Named zone when indoors (e.g. "office", "home")';
COMMENT ON COLUMN geo_location.address IS 'Reverse-geocoded address';
COMMENT ON COLUMN geo_location.place_label IS 'Short human-friendly place name';
COMMENT ON COLUMN geo_location.raw_payload IS 'Full raw payload from the provider for debugging';
COMMENT ON COLUMN geo_location.location_embedding IS 'Embedding of address+place_label for semantic location search (1024 dims)';
COMMENT ON COLUMN geo_location.embedding_status IS 'Status of embedding generation';

-- ============================================================
-- 5. user_setting — add geolocation preference columns
-- ============================================================

ALTER TABLE user_setting
  ADD COLUMN IF NOT EXISTS geo_auto_inject boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS geo_high_res_retention_hours integer NOT NULL DEFAULT 168,
  ADD COLUMN IF NOT EXISTS geo_general_retention_days integer NOT NULL DEFAULT 365,
  ADD COLUMN IF NOT EXISTS geo_high_res_threshold_m double precision NOT NULL DEFAULT 50.0;

COMMENT ON COLUMN user_setting.geo_auto_inject IS 'Whether to automatically inject location context into agent prompts';
COMMENT ON COLUMN user_setting.geo_high_res_retention_hours IS 'Hours to retain high-resolution (raw) location data (default 7 days)';
COMMENT ON COLUMN user_setting.geo_general_retention_days IS 'Days to retain general (downsampled) location data (default 1 year)';
COMMENT ON COLUMN user_setting.geo_high_res_threshold_m IS 'Movement threshold in metres for high-resolution retention (default 50m)';
