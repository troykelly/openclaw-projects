-- ============================================================
-- Migration 118: pgcron job for terminal entry retention cleanup
-- Epic #1667 — TMux session management
-- Issue #1687 — Entry retention policies
-- ============================================================

-- Daily cleanup at 3 AM UTC
-- Deletes entries older than the namespace's configured retention days (default 90).
-- Annotations (kind='annotation') are exempt from cleanup.
SELECT cron.schedule(
  'terminal-entry-cleanup',
  '0 3 * * *',
  $$
    DELETE FROM terminal_session_entry
    WHERE kind != 'annotation'
    AND captured_at < now() - make_interval(days =>
      COALESCE(
        (SELECT (value->>'terminal_entry_retention_days')::int
         FROM terminal_setting
         WHERE namespace = terminal_session_entry.namespace
         AND key = 'terminal_retention'
         LIMIT 1),
        90
      )
    )
  $$
);
