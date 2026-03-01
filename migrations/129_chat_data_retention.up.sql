-- ============================================================
-- Migration 129: Chat data retention cron + GDPR deletion
-- Epic #1940 — Agent Chat
-- Issue #1964 — Data retention
-- ============================================================

-- Daily cleanup at 4 AM UTC:
-- 1. Delete chat_activity records older than 90 days
-- 2. Delete ended/expired chat sessions (and cascading data) older than 90 days
-- 3. Delete notification_dedup and notification_rate records older than 1 day
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'chat_data_retention') THEN
    PERFORM cron.schedule(
      'chat_data_retention',
      '0 4 * * *',
      $cmd$
        -- Purge old audit logs
        DELETE FROM chat_activity WHERE created_at < NOW() - INTERVAL '90 days';

        -- Purge old dedup/rate tracking
        DELETE FROM notification_dedup WHERE created_at < NOW() - INTERVAL '1 day';
        DELETE FROM notification_rate WHERE last_reset < NOW() - INTERVAL '1 day';

        -- Purge old ended/expired sessions (cascades to read cursors)
        -- Messages cascade via thread_id -> external_thread ON DELETE CASCADE
        DELETE FROM chat_session
          WHERE status IN ('ended', 'expired')
          AND ended_at < NOW() - INTERVAL '90 days';
      $cmd$
    );
  END IF;
END $do$;
