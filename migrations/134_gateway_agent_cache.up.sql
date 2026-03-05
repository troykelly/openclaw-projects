-- Issue #2151: Cache gateway agent list for chat discovery
CREATE TABLE IF NOT EXISTS gateway_agent_cache (
  namespace text NOT NULL,
  agent_id text NOT NULL CHECK (length(trim(agent_id)) > 0),
  display_name text,
  avatar_url text,
  is_default boolean NOT NULL DEFAULT false,
  synced_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (namespace, agent_id)
);

COMMENT ON TABLE gateway_agent_cache IS 'Cached agent list synced from OpenClaw gateway plugin (Issue #2151)';
