-- ============================================================
-- Migration 128: Chat audit activity table
-- Epic #1940 — Agent Chat
-- Issue #1962 — Audit logging
-- ============================================================

CREATE TABLE IF NOT EXISTS chat_activity (
  id              uuid PRIMARY KEY DEFAULT new_uuid(),
  namespace       text NOT NULL DEFAULT 'default',
  session_id      uuid REFERENCES chat_session(id) ON DELETE SET NULL,
  user_email      text,
  agent_id        text,
  action          text NOT NULL,
  detail          jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_activity_session
  ON chat_activity(session_id);
CREATE INDEX IF NOT EXISTS idx_chat_activity_user
  ON chat_activity(user_email) WHERE user_email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chat_activity_created
  ON chat_activity(created_at);
