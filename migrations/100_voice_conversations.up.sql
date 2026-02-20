-- ============================================================
-- Migration 100: Voice conversation tables
-- Epic #1431 — Voice agent backend
-- Issue #1432 — WebSocket conversation endpoint + DB tables
-- Issue #1433 — Agent routing and configuration
-- ============================================================

-- Voice conversations
CREATE TABLE voice_conversation (
  id UUID PRIMARY KEY DEFAULT new_uuid(),
  namespace TEXT NOT NULL DEFAULT 'default'
    CHECK (namespace ~ '^[a-z0-9][a-z0-9._-]*$' AND length(namespace) <= 63),
  agent_id TEXT,
  device_id TEXT,
  user_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX idx_voice_conversation_namespace ON voice_conversation (namespace, last_active_at DESC);
CREATE INDEX idx_voice_conversation_agent ON voice_conversation (namespace, agent_id);

-- Voice messages within conversations
CREATE TABLE voice_message (
  id UUID PRIMARY KEY DEFAULT new_uuid(),
  conversation_id UUID NOT NULL REFERENCES voice_conversation(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  text TEXT NOT NULL,
  service_calls JSONB,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_voice_message_conversation ON voice_message (conversation_id, timestamp);

-- Voice agent routing configuration
CREATE TABLE voice_agent_config (
  id UUID PRIMARY KEY DEFAULT new_uuid(),
  namespace TEXT NOT NULL DEFAULT 'default'
    CHECK (namespace ~ '^[a-z0-9][a-z0-9._-]*$' AND length(namespace) <= 63),
  default_agent_id TEXT,
  timeout_ms INTEGER NOT NULL DEFAULT 15000 CHECK (timeout_ms > 0 AND timeout_ms <= 120000),
  idle_timeout_s INTEGER NOT NULL DEFAULT 300 CHECK (idle_timeout_s > 0 AND idle_timeout_s <= 86400),
  retention_days INTEGER NOT NULL DEFAULT 30 CHECK (retention_days > 0 AND retention_days <= 365),
  device_mapping JSONB NOT NULL DEFAULT '{}',
  user_mapping JSONB NOT NULL DEFAULT '{}',
  service_allowlist JSONB NOT NULL DEFAULT '["light","switch","cover","climate","media_player","scene","script","input_boolean","input_number","input_select"]',
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (namespace)
);

CREATE INDEX idx_voice_agent_config_namespace ON voice_agent_config (namespace);
