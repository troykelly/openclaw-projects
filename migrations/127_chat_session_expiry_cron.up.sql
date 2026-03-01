-- ============================================================
-- Migration 127: pgcron job for chat session expiry
-- Epic #1940 — Agent Chat
-- Issue #1961 — Session expiration
-- ============================================================

-- Expire idle chat sessions every 15 minutes.
-- Sessions inactive for >24h are set to 'expired'.
-- The status transition trigger automatically sets ended_at.
-- Configurable via CHAT_SESSION_EXPIRY_HOURS env var in the application,
-- but the cron job uses a fixed 24h default (safe server-side).
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'chat_session_expiry') THEN
    PERFORM cron.schedule(
      'chat_session_expiry',
      '*/15 * * * *',
      $cmd$UPDATE chat_session SET status = 'expired', version = version + 1 WHERE status = 'active' AND last_activity_at < NOW() - INTERVAL '24 hours';$cmd$
    );
  END IF;
END $do$;

-- Index to make the expiry scan efficient
CREATE INDEX IF NOT EXISTS idx_chat_session_expiry
  ON chat_session(last_activity_at)
  WHERE status = 'active';
