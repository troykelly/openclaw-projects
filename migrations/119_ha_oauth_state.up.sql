-- Migration 119: Extend OAuth state for Home Assistant OAuth2 flows (Issue #1808)
--
-- 1. Add 'home_assistant' to the oauth_provider enum so oauth_state can reference HA flows.
-- 2. Add geo_provider_id to link the OAuth flow back to the geo_provider being connected.
-- 3. Add instance_url to store the HA instance URL (needed for token exchange in callback).
-- 4. Make code_verifier nullable since HA uses IndieAuth (no PKCE).

ALTER TYPE oauth_provider ADD VALUE IF NOT EXISTS 'home_assistant';

ALTER TABLE oauth_state
  ADD COLUMN IF NOT EXISTS geo_provider_id uuid REFERENCES geo_provider(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS instance_url text;

ALTER TABLE oauth_state ALTER COLUMN code_verifier DROP NOT NULL;

COMMENT ON COLUMN oauth_state.geo_provider_id IS 'Links HA OAuth flow to the geo_provider being connected (null for Google/Microsoft)';
COMMENT ON COLUMN oauth_state.instance_url IS 'HA instance URL for per-instance token exchange (null for centralized providers)';
