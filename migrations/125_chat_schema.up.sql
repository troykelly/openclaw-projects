-- Issue #1941: Agent Chat schema — enums, tables, triggers, indexes
-- Part of Epic #1940 (Agent Chat)

-- ── New enum values ─────────────────────────────────────────────────

-- Add 'agent_chat' to contact_endpoint_type (used as channel on external_thread)
DO $$ BEGIN
  ALTER TYPE contact_endpoint_type ADD VALUE IF NOT EXISTS 'agent_chat';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Chat session lifecycle status
DO $$ BEGIN
  CREATE TYPE chat_session_status AS ENUM ('active', 'ended', 'expired');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Chat message delivery status
DO $$ BEGIN
  CREATE TYPE chat_message_status AS ENUM ('pending', 'streaming', 'delivered', 'failed');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ── New table: chat_session ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS chat_session (
  id uuid PRIMARY KEY DEFAULT new_uuid(),
  thread_id uuid NOT NULL UNIQUE REFERENCES external_thread(id) ON DELETE CASCADE,
  user_email text NOT NULL REFERENCES user_setting(email) ON DELETE CASCADE,
  agent_id text NOT NULL CHECK (length(trim(agent_id)) > 0),
  namespace text NOT NULL DEFAULT 'default',
  status chat_session_status NOT NULL DEFAULT 'active',
  title text CHECK (title IS NULL OR (length(trim(title)) > 0 AND length(title) <= 200)),
  stream_secret text NOT NULL CHECK (length(stream_secret) = 64), -- 32-byte hex
  version integer NOT NULL DEFAULT 1,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}' CHECK (pg_column_size(metadata) <= 16384),
  CONSTRAINT chat_session_active_no_ended CHECK (
    status != 'active' OR ended_at IS NULL
  ),
  CONSTRAINT chat_session_ended_has_ended_at CHECK (
    status = 'active' OR ended_at IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_chat_session_user ON chat_session(user_email, namespace);
CREATE INDEX IF NOT EXISTS idx_chat_session_active ON chat_session(user_email) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_chat_session_agent ON chat_session(agent_id);
CREATE INDEX IF NOT EXISTS idx_chat_session_activity ON chat_session(last_activity_at);

-- ── Extended external_message ───────────────────────────────────────

ALTER TABLE external_message ADD COLUMN IF NOT EXISTS updated_at timestamptz;
ALTER TABLE external_message ADD COLUMN IF NOT EXISTS status chat_message_status DEFAULT 'delivered';
ALTER TABLE external_message ADD COLUMN IF NOT EXISTS idempotency_key text;
ALTER TABLE external_message ADD COLUMN IF NOT EXISTS agent_run_id text;
ALTER TABLE external_message ADD COLUMN IF NOT EXISTS content_type text DEFAULT 'text/plain';

-- Add CHECK constraint for content_type (idempotent via DO block)
DO $$ BEGIN
  ALTER TABLE external_message ADD CONSTRAINT chk_external_message_content_type
    CHECK (content_type IN ('text/plain', 'text/markdown', 'application/vnd.openclaw.rich-card'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Unique index for idempotency deduplication (partial: only where key is set)
CREATE UNIQUE INDEX IF NOT EXISTS idx_external_message_idempotency
  ON external_message(thread_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- Trigger to update external_message.updated_at on modification
CREATE OR REPLACE FUNCTION update_external_message_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_external_message_updated_at ON external_message;
CREATE TRIGGER trg_external_message_updated_at
  BEFORE UPDATE ON external_message
  FOR EACH ROW
  EXECUTE FUNCTION update_external_message_updated_at();

-- ── New table: chat_read_cursor ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS chat_read_cursor (
  user_email text NOT NULL,
  session_id uuid NOT NULL REFERENCES chat_session(id) ON DELETE CASCADE,
  last_read_message_id uuid REFERENCES external_message(id) ON DELETE SET NULL,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_email, session_id)
);

-- ── Extended user_setting ───────────────────────────────────────────

ALTER TABLE user_setting ADD COLUMN IF NOT EXISTS default_agent_id text;
ALTER TABLE user_setting ADD COLUMN IF NOT EXISTS chat_notification_prefs jsonb NOT NULL DEFAULT '{}';

-- Add CHECK constraint for chat_notification_prefs size (idempotent via DO block)
DO $$ BEGIN
  ALTER TABLE user_setting ADD CONSTRAINT chk_user_setting_chat_notification_prefs
    CHECK (pg_column_size(chat_notification_prefs) <= 4096);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ── State machine triggers ──────────────────────────────────────────

-- Prevent invalid chat_session status transitions
-- Valid transitions: active -> ended, active -> expired
CREATE OR REPLACE FUNCTION enforce_chat_session_status_transition()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  -- Only 'active' sessions can transition to 'ended' or 'expired'
  IF OLD.status != 'active' THEN
    RAISE EXCEPTION 'Cannot transition chat_session from % to %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;

  -- Set ended_at automatically when transitioning out of active
  IF NEW.ended_at IS NULL THEN
    NEW.ended_at = now();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_chat_session_status_transition ON chat_session;
CREATE TRIGGER trg_chat_session_status_transition
  BEFORE UPDATE OF status ON chat_session
  FOR EACH ROW
  EXECUTE FUNCTION enforce_chat_session_status_transition();

-- Prevent invalid external_message status transitions for chat messages
-- Valid: pending -> streaming -> delivered, pending -> delivered, pending -> failed,
--        streaming -> delivered, streaming -> failed
CREATE OR REPLACE FUNCTION enforce_chat_message_status_transition()
RETURNS TRIGGER AS $$
BEGIN
  -- Only enforce if status actually changes and was set (not NULL -> value)
  IF OLD.status IS NULL OR OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  -- Cannot go backwards from terminal states
  IF OLD.status = 'delivered' OR OLD.status = 'failed' THEN
    RAISE EXCEPTION 'Cannot transition message status from % to %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;

  -- From pending: can go to streaming, delivered, or failed
  IF OLD.status = 'pending' AND NEW.status NOT IN ('streaming', 'delivered', 'failed') THEN
    RAISE EXCEPTION 'Cannot transition message status from pending to %', NEW.status
      USING ERRCODE = 'check_violation';
  END IF;

  -- From streaming: can go to delivered or failed
  IF OLD.status = 'streaming' AND NEW.status NOT IN ('delivered', 'failed') THEN
    RAISE EXCEPTION 'Cannot transition message status from streaming to %', NEW.status
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_external_message_status_transition ON external_message;
CREATE TRIGGER trg_external_message_status_transition
  BEFORE UPDATE OF status ON external_message
  FOR EACH ROW
  EXECUTE FUNCTION enforce_chat_message_status_transition();
