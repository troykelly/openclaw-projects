-- ============================================================
-- Migration 096: Home Assistant entity tier configuration
-- Epic #1440 — HA observation pipeline
-- Issue #1451 — Configurable entity classification tiers
-- ============================================================

CREATE TABLE ha_entity_tier_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  namespace TEXT NOT NULL DEFAULT 'default'
    CHECK (namespace ~ '^[a-z0-9][a-z0-9._-]*$' AND length(namespace) <= 63),
  tier TEXT NOT NULL CHECK (tier IN ('ignore', 'geo', 'log_only', 'triage', 'escalate')),
  domain TEXT,
  entity_pattern TEXT,
  entity_id TEXT,
  priority INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (domain IS NOT NULL OR entity_pattern IS NOT NULL OR entity_id IS NOT NULL)
);

CREATE INDEX idx_ha_tier_namespace ON ha_entity_tier_config (namespace);
CREATE INDEX idx_ha_tier_entity_id ON ha_entity_tier_config (entity_id) WHERE entity_id IS NOT NULL;
CREATE INDEX idx_ha_tier_domain ON ha_entity_tier_config (domain) WHERE domain IS NOT NULL;
