-- Rollback Issue #1941: Agent Chat schema

-- ── Drop triggers ──────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_external_message_status_transition ON external_message;
DROP FUNCTION IF EXISTS enforce_chat_message_status_transition();

DROP TRIGGER IF EXISTS trg_chat_session_status_transition ON chat_session;
DROP FUNCTION IF EXISTS enforce_chat_session_status_transition();

DROP TRIGGER IF EXISTS trg_external_message_updated_at ON external_message;
DROP FUNCTION IF EXISTS update_external_message_updated_at();

-- ── Drop user_setting extensions ───────────────────────────────────
ALTER TABLE user_setting DROP CONSTRAINT IF EXISTS chk_user_setting_chat_notification_prefs;
ALTER TABLE user_setting DROP COLUMN IF EXISTS chat_notification_prefs;
ALTER TABLE user_setting DROP COLUMN IF EXISTS default_agent_id;

-- ── Drop chat_read_cursor ──────────────────────────────────────────
DROP TABLE IF EXISTS chat_read_cursor;

-- ── Drop external_message extensions ───────────────────────────────
DROP INDEX IF EXISTS idx_external_message_idempotency;
ALTER TABLE external_message DROP CONSTRAINT IF EXISTS chk_external_message_content_type;
ALTER TABLE external_message DROP COLUMN IF EXISTS content_type;
ALTER TABLE external_message DROP COLUMN IF EXISTS agent_run_id;
ALTER TABLE external_message DROP COLUMN IF EXISTS idempotency_key;
ALTER TABLE external_message DROP COLUMN IF EXISTS status;
ALTER TABLE external_message DROP COLUMN IF EXISTS updated_at;

-- ── Drop chat_session ──────────────────────────────────────────────
DROP TABLE IF EXISTS chat_session;

-- ── Drop enum types ────────────────────────────────────────────────
DROP TYPE IF EXISTS chat_message_status;
DROP TYPE IF EXISTS chat_session_status;

-- Note: Cannot remove 'agent_chat' from contact_endpoint_type enum
-- because PostgreSQL does not support removing enum values.
-- This is safe — the value simply won't be used after rollback.
