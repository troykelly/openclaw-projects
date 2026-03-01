-- Rollback: remove chat session expiry cron job and index
SELECT cron.unschedule('chat_session_expiry');

DROP INDEX IF EXISTS idx_chat_session_expiry;
