-- Issue #1287: Structured agent identity management with versioning
-- One identity per agent persona. Agents propose changes, users approve.

CREATE TABLE IF NOT EXISTS agent_identity (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL UNIQUE,
  display_name    text NOT NULL,
  emoji           text,
  avatar_s3_key   text,
  persona         text NOT NULL,
  principles      text[] NOT NULL DEFAULT '{}',
  quirks          text[] NOT NULL DEFAULT '{}',
  voice_config    jsonb,
  is_active       boolean NOT NULL DEFAULT true,
  version         integer NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_identity_history (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_id     uuid NOT NULL REFERENCES agent_identity(id) ON DELETE CASCADE,
  version         integer NOT NULL,
  changed_by      text NOT NULL,
  change_type     text NOT NULL,
  change_reason   text,
  field_changed   text,
  previous_value  text,
  new_value       text,
  full_snapshot   jsonb NOT NULL,
  approved_by     text,
  approved_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_identity_history ON agent_identity_history (identity_id, version DESC);
CREATE INDEX IF NOT EXISTS idx_identity_history_pending ON agent_identity_history (change_type) WHERE change_type = 'propose';
