-- ============================================================
-- Migration 092: Inbound message routing tables
-- Epic #1497 — prompt_template, inbound_destination, channel_default
-- ============================================================

-- ============================================================
-- STEP 1: prompt_template table
-- Reusable prompt blocks for agent triage instructions.
-- ============================================================
CREATE TABLE IF NOT EXISTS prompt_template (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  namespace     text NOT NULL DEFAULT 'default'
                  CHECK (namespace ~ '^[a-z0-9][a-z0-9._-]*$' AND length(namespace) <= 63),
  label         text NOT NULL CHECK (length(TRIM(label)) > 0),
  content       text NOT NULL,
  channel_type  text NOT NULL CHECK (channel_type IN ('sms', 'email', 'ha_observation', 'general')),
  is_default    boolean NOT NULL DEFAULT false,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Only one active default per channel_type per namespace
CREATE UNIQUE INDEX IF NOT EXISTS idx_prompt_template_default
  ON prompt_template (namespace, channel_type)
  WHERE is_default = true AND is_active = true;

CREATE INDEX IF NOT EXISTS idx_prompt_template_namespace ON prompt_template(namespace);
CREATE INDEX IF NOT EXISTS idx_prompt_template_channel ON prompt_template(channel_type);

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_prompt_template_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER prompt_template_updated_at
  BEFORE UPDATE ON prompt_template
  FOR EACH ROW
  EXECUTE FUNCTION update_prompt_template_updated_at();

-- ============================================================
-- STEP 2: inbound_destination table
-- Auto-discovered and configurable routing overrides per address.
-- ============================================================
CREATE TABLE IF NOT EXISTS inbound_destination (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  namespace           text NOT NULL DEFAULT 'default'
                        CHECK (namespace ~ '^[a-z0-9][a-z0-9._-]*$' AND length(namespace) <= 63),
  address             text NOT NULL,
  channel_type        text NOT NULL CHECK (channel_type IN ('sms', 'email')),
  display_name        text,
  agent_id            text,
  prompt_template_id  uuid REFERENCES prompt_template(id) ON DELETE SET NULL,
  context_id          uuid REFERENCES context(id) ON DELETE SET NULL,
  is_active           boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (address, channel_type)
);

CREATE INDEX IF NOT EXISTS idx_inbound_dest_address ON inbound_destination(address);
CREATE INDEX IF NOT EXISTS idx_inbound_dest_namespace ON inbound_destination(namespace);

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_inbound_destination_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER inbound_destination_updated_at
  BEFORE UPDATE ON inbound_destination
  FOR EACH ROW
  EXECUTE FUNCTION update_inbound_destination_updated_at();

-- ============================================================
-- STEP 3: channel_default table
-- Per-channel-type default routing configuration per namespace.
-- ============================================================
CREATE TABLE IF NOT EXISTS channel_default (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  namespace           text NOT NULL DEFAULT 'default'
                        CHECK (namespace ~ '^[a-z0-9][a-z0-9._-]*$' AND length(namespace) <= 63),
  channel_type        text NOT NULL CHECK (channel_type IN ('sms', 'email', 'ha_observation')),
  agent_id            text NOT NULL,
  prompt_template_id  uuid REFERENCES prompt_template(id) ON DELETE SET NULL,
  context_id          uuid REFERENCES context(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (namespace, channel_type)
);

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_channel_default_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER channel_default_updated_at
  BEFORE UPDATE ON channel_default
  FOR EACH ROW
  EXECUTE FUNCTION update_channel_default_updated_at();
