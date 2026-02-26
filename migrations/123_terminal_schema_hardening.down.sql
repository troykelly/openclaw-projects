-- ============================================================
-- Migration 123 (down): Revert terminal schema hardening
-- Issue #1871
-- ============================================================

-- ── Revert Retention Cron ────────────────────────────────────
SELECT cron.unschedule('terminal-entry-cleanup');

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

-- ── Revert FK CASCADE Fixes ─────────────────────────────────
-- terminal_known_host.connection_id: back to implicit RESTRICT
ALTER TABLE terminal_known_host
  DROP CONSTRAINT IF EXISTS terminal_known_host_connection_id_fkey;
ALTER TABLE terminal_known_host
  ADD CONSTRAINT terminal_known_host_connection_id_fkey
    FOREIGN KEY (connection_id) REFERENCES terminal_connection(id);

-- terminal_activity.connection_id: back to implicit RESTRICT
ALTER TABLE terminal_activity
  DROP CONSTRAINT IF EXISTS terminal_activity_connection_id_fkey;
ALTER TABLE terminal_activity
  ADD CONSTRAINT terminal_activity_connection_id_fkey
    FOREIGN KEY (connection_id) REFERENCES terminal_connection(id);

-- terminal_activity.session_id: back to implicit RESTRICT
ALTER TABLE terminal_activity
  DROP CONSTRAINT IF EXISTS terminal_activity_session_id_fkey;
ALTER TABLE terminal_activity
  ADD CONSTRAINT terminal_activity_session_id_fkey
    FOREIGN KEY (session_id) REFERENCES terminal_session(id);

-- terminal_session.connection_id: back to implicit RESTRICT
ALTER TABLE terminal_session
  DROP CONSTRAINT IF EXISTS terminal_session_connection_id_fkey;
ALTER TABLE terminal_session
  ADD CONSTRAINT terminal_session_connection_id_fkey
    FOREIGN KEY (connection_id) REFERENCES terminal_connection(id);

-- terminal_tunnel.session_id: back to implicit RESTRICT
ALTER TABLE terminal_tunnel
  DROP CONSTRAINT IF EXISTS terminal_tunnel_session_id_fkey;
ALTER TABLE terminal_tunnel
  ADD CONSTRAINT terminal_tunnel_session_id_fkey
    FOREIGN KEY (session_id) REFERENCES terminal_session(id);

-- ── Drop New Indexes ─────────────────────────────────────────
DROP INDEX IF EXISTS idx_terminal_tunnel_session;
DROP INDEX IF EXISTS idx_terminal_activity_connection;
DROP INDEX IF EXISTS idx_terminal_session_window_session;
