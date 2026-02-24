-- ============================================================
-- Migration 116: Terminal management tables
-- Epic #1667 — TMux session management foundation
-- Issue #1668 — Database migrations for terminal_* tables
-- ============================================================

-- ============================================================
-- STEP 1: terminal_credential
-- Encrypted SSH keys, passwords, or command references.
-- ============================================================
CREATE TABLE IF NOT EXISTS terminal_credential (
  id                uuid PRIMARY KEY DEFAULT new_uuid(),
  namespace         text NOT NULL DEFAULT 'default'
                      CHECK (namespace ~ '^[a-z0-9][a-z0-9._-]*$' AND length(namespace) <= 63),
  name              text NOT NULL CHECK (length(TRIM(name)) > 0),
  kind              text NOT NULL CHECK (kind IN ('ssh_key', 'password', 'command')),
  encrypted_value   bytea,
  command           text,
  command_timeout_s int DEFAULT 10,
  cache_ttl_s       int DEFAULT 0,
  fingerprint       text,
  public_key        text,
  deleted_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_terminal_credential_namespace
  ON terminal_credential(namespace);

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_terminal_credential_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER terminal_credential_updated_at
  BEFORE UPDATE ON terminal_credential
  FOR EACH ROW
  EXECUTE FUNCTION update_terminal_credential_updated_at();

-- ============================================================
-- STEP 2: terminal_connection
-- SSH connection definitions. Reusable across sessions.
-- ============================================================
CREATE TABLE IF NOT EXISTS terminal_connection (
  id                  uuid PRIMARY KEY DEFAULT new_uuid(),
  namespace           text NOT NULL DEFAULT 'default'
                        CHECK (namespace ~ '^[a-z0-9][a-z0-9._-]*$' AND length(namespace) <= 63),
  name                text NOT NULL CHECK (length(TRIM(name)) > 0),
  host                text,
  port                int DEFAULT 22,
  username            text,
  auth_method         text CHECK (auth_method IS NULL OR auth_method IN ('key', 'password', 'agent', 'command')),
  credential_id       uuid REFERENCES terminal_credential(id),
  proxy_jump_id       uuid REFERENCES terminal_connection(id),
  is_local            boolean DEFAULT false,
  env                 jsonb,
  connect_timeout_s   int DEFAULT 30,
  keepalive_interval  int DEFAULT 60,
  idle_timeout_s      int,
  max_sessions        int,
  host_key_policy     text DEFAULT 'strict' CHECK (host_key_policy IN ('strict', 'tofu', 'skip')),
  tags                text[],
  notes               text,
  last_connected_at   timestamptz,
  last_error          text,
  deleted_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_terminal_connection_namespace
  ON terminal_connection(namespace);
CREATE INDEX IF NOT EXISTS idx_terminal_connection_tags
  ON terminal_connection USING gin(tags);

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_terminal_connection_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER terminal_connection_updated_at
  BEFORE UPDATE ON terminal_connection
  FOR EACH ROW
  EXECUTE FUNCTION update_terminal_connection_updated_at();

-- ============================================================
-- STEP 3: terminal_known_host
-- SSH host key trust store.
-- ============================================================
CREATE TABLE IF NOT EXISTS terminal_known_host (
  id                uuid PRIMARY KEY DEFAULT new_uuid(),
  namespace         text NOT NULL DEFAULT 'default'
                      CHECK (namespace ~ '^[a-z0-9][a-z0-9._-]*$' AND length(namespace) <= 63),
  connection_id     uuid REFERENCES terminal_connection(id),
  host              text NOT NULL,
  port              int DEFAULT 22,
  key_type          text NOT NULL,
  key_fingerprint   text NOT NULL,
  public_key        text NOT NULL,
  trusted_at        timestamptz NOT NULL DEFAULT now(),
  trusted_by        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE(namespace, host, port, key_type)
);

-- ============================================================
-- STEP 4: terminal_session
-- Active or historical tmux sessions.
-- ============================================================
CREATE TABLE IF NOT EXISTS terminal_session (
  id                    uuid PRIMARY KEY DEFAULT new_uuid(),
  namespace             text NOT NULL DEFAULT 'default'
                          CHECK (namespace ~ '^[a-z0-9][a-z0-9._-]*$' AND length(namespace) <= 63),
  connection_id         uuid REFERENCES terminal_connection(id),
  tmux_session_name     text NOT NULL,
  worker_id             text,
  status                text NOT NULL DEFAULT 'starting'
                          CHECK (status IN ('starting', 'active', 'idle', 'disconnected', 'terminated', 'error', 'pending_host_verification')),
  cols                  int DEFAULT 120,
  rows                  int DEFAULT 40,
  capture_interval_s    int DEFAULT 30,
  capture_on_command    boolean DEFAULT true,
  embed_commands        boolean DEFAULT true,
  embed_scrollback      boolean DEFAULT false,
  started_at            timestamptz,
  last_activity_at      timestamptz,
  terminated_at         timestamptz,
  exit_code             int,
  error_message         text,
  tags                  text[],
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_terminal_session_namespace
  ON terminal_session(namespace);
CREATE INDEX IF NOT EXISTS idx_terminal_session_status
  ON terminal_session(status);
CREATE INDEX IF NOT EXISTS idx_terminal_session_connection
  ON terminal_session(connection_id);
CREATE INDEX IF NOT EXISTS idx_terminal_session_tags
  ON terminal_session USING gin(tags);

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_terminal_session_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER terminal_session_updated_at
  BEFORE UPDATE ON terminal_session
  FOR EACH ROW
  EXECUTE FUNCTION update_terminal_session_updated_at();

-- ============================================================
-- STEP 5: terminal_session_window
-- Tmux windows within sessions.
-- ============================================================
CREATE TABLE IF NOT EXISTS terminal_session_window (
  id            uuid PRIMARY KEY DEFAULT new_uuid(),
  session_id    uuid NOT NULL REFERENCES terminal_session(id) ON DELETE CASCADE,
  namespace     text NOT NULL DEFAULT 'default'
                  CHECK (namespace ~ '^[a-z0-9][a-z0-9._-]*$' AND length(namespace) <= 63),
  window_index  int NOT NULL,
  window_name   text,
  is_active     boolean DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE(session_id, window_index)
);

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_terminal_session_window_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER terminal_session_window_updated_at
  BEFORE UPDATE ON terminal_session_window
  FOR EACH ROW
  EXECUTE FUNCTION update_terminal_session_window_updated_at();

-- ============================================================
-- STEP 6: terminal_session_pane
-- Panes within windows.
-- ============================================================
CREATE TABLE IF NOT EXISTS terminal_session_pane (
  id                uuid PRIMARY KEY DEFAULT new_uuid(),
  window_id         uuid NOT NULL REFERENCES terminal_session_window(id) ON DELETE CASCADE,
  namespace         text NOT NULL DEFAULT 'default'
                      CHECK (namespace ~ '^[a-z0-9][a-z0-9._-]*$' AND length(namespace) <= 63),
  pane_index        int NOT NULL,
  is_active         boolean DEFAULT false,
  pid               int,
  current_command   text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE(window_id, pane_index)
);

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_terminal_session_pane_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER terminal_session_pane_updated_at
  BEFORE UPDATE ON terminal_session_pane
  FOR EACH ROW
  EXECUTE FUNCTION update_terminal_session_pane_updated_at();

-- ============================================================
-- STEP 7: terminal_session_entry
-- Captured interactions with pgvector embedding column.
-- ============================================================
CREATE TABLE IF NOT EXISTS terminal_session_entry (
  id            uuid PRIMARY KEY DEFAULT new_uuid(),
  session_id    uuid NOT NULL REFERENCES terminal_session(id) ON DELETE CASCADE,
  pane_id       uuid REFERENCES terminal_session_pane(id),
  namespace     text NOT NULL DEFAULT 'default'
                  CHECK (namespace ~ '^[a-z0-9][a-z0-9._-]*$' AND length(namespace) <= 63),
  kind          text NOT NULL CHECK (kind IN ('command', 'output', 'scrollback', 'annotation', 'error')),
  content       text NOT NULL,
  embedding     vector(1536),
  embedded_at   timestamptz,
  sequence      bigserial,
  captured_at   timestamptz NOT NULL DEFAULT now(),
  metadata      jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_terminal_entry_session
  ON terminal_session_entry(session_id);
CREATE INDEX IF NOT EXISTS idx_terminal_entry_namespace
  ON terminal_session_entry(namespace);
CREATE INDEX IF NOT EXISTS idx_terminal_entry_kind
  ON terminal_session_entry(kind);
CREATE INDEX IF NOT EXISTS idx_terminal_entry_captured
  ON terminal_session_entry(captured_at);
CREATE INDEX IF NOT EXISTS idx_terminal_entry_embedding
  ON terminal_session_entry USING ivfflat (embedding vector_cosine_ops);

-- ============================================================
-- STEP 8: terminal_tunnel
-- Active SSH tunnels.
-- ============================================================
CREATE TABLE IF NOT EXISTS terminal_tunnel (
  id              uuid PRIMARY KEY DEFAULT new_uuid(),
  namespace       text NOT NULL DEFAULT 'default'
                    CHECK (namespace ~ '^[a-z0-9][a-z0-9._-]*$' AND length(namespace) <= 63),
  connection_id   uuid NOT NULL REFERENCES terminal_connection(id),
  session_id      uuid REFERENCES terminal_session(id),
  direction       text NOT NULL CHECK (direction IN ('local', 'remote', 'dynamic')),
  bind_host       text DEFAULT '127.0.0.1',
  bind_port       int NOT NULL,
  target_host     text,
  target_port     int,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'failed', 'closed')),
  error_message   text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_terminal_tunnel_namespace
  ON terminal_tunnel(namespace);
CREATE INDEX IF NOT EXISTS idx_terminal_tunnel_connection
  ON terminal_tunnel(connection_id);

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_terminal_tunnel_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER terminal_tunnel_updated_at
  BEFORE UPDATE ON terminal_tunnel
  FOR EACH ROW
  EXECUTE FUNCTION update_terminal_tunnel_updated_at();

-- ============================================================
-- STEP 9: terminal_enrollment_token
-- For remote server self-registration.
-- ============================================================
CREATE TABLE IF NOT EXISTS terminal_enrollment_token (
  id                    uuid PRIMARY KEY DEFAULT new_uuid(),
  namespace             text NOT NULL DEFAULT 'default'
                          CHECK (namespace ~ '^[a-z0-9][a-z0-9._-]*$' AND length(namespace) <= 63),
  token_hash            text NOT NULL,
  label                 text NOT NULL CHECK (length(TRIM(label)) > 0),
  max_uses              int,
  uses                  int DEFAULT 0,
  expires_at            timestamptz,
  connection_defaults   jsonb,
  allowed_tags          text[],
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_terminal_enrollment_namespace
  ON terminal_enrollment_token(namespace);

-- ============================================================
-- STEP 10: terminal_activity
-- Audit trail for all terminal operations.
-- ============================================================
CREATE TABLE IF NOT EXISTS terminal_activity (
  id              uuid PRIMARY KEY DEFAULT new_uuid(),
  namespace       text NOT NULL DEFAULT 'default'
                    CHECK (namespace ~ '^[a-z0-9][a-z0-9._-]*$' AND length(namespace) <= 63),
  session_id      uuid REFERENCES terminal_session(id),
  connection_id   uuid REFERENCES terminal_connection(id),
  actor           text NOT NULL,
  action          text NOT NULL,
  detail          jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_terminal_activity_namespace
  ON terminal_activity(namespace);
CREATE INDEX IF NOT EXISTS idx_terminal_activity_session
  ON terminal_activity(session_id);
CREATE INDEX IF NOT EXISTS idx_terminal_activity_action
  ON terminal_activity(action);
CREATE INDEX IF NOT EXISTS idx_terminal_activity_created
  ON terminal_activity(created_at);
