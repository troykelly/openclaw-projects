-- ============================================================
-- Migration 123: Terminal schema hardening
-- Issue #1871 — Missing indexes, cascade consistency, cron optimization
-- ============================================================

-- ── Missing Indexes ──────────────────────────────────────────
-- terminal_session_window.session_id — GET session detail JOINs this with no index
CREATE INDEX IF NOT EXISTS idx_terminal_session_window_session
  ON terminal_session_window(session_id);

-- terminal_activity.connection_id — activity filter by connection does sequential scan
CREATE INDEX IF NOT EXISTS idx_terminal_activity_connection
  ON terminal_activity(connection_id);

-- terminal_tunnel.session_id — session-scoped tunnel queries have no index
CREATE INDEX IF NOT EXISTS idx_terminal_tunnel_session
  ON terminal_tunnel(session_id);

-- ── FK CASCADE Fixes ─────────────────────────────────────────
-- terminal_tunnel.session_id: was missing ON DELETE behavior (implicit RESTRICT),
-- change to SET NULL so session deletion doesn't block on open tunnels
ALTER TABLE terminal_tunnel
  DROP CONSTRAINT IF EXISTS terminal_tunnel_session_id_fkey;
ALTER TABLE terminal_tunnel
  ADD CONSTRAINT terminal_tunnel_session_id_fkey
    FOREIGN KEY (session_id) REFERENCES terminal_session(id)
    ON DELETE SET NULL;

-- terminal_session.connection_id: nullable but no ON DELETE SET NULL
-- (RESTRICT blocks hard-delete of connections with historical sessions)
ALTER TABLE terminal_session
  DROP CONSTRAINT IF EXISTS terminal_session_connection_id_fkey;
ALTER TABLE terminal_session
  ADD CONSTRAINT terminal_session_connection_id_fkey
    FOREIGN KEY (connection_id) REFERENCES terminal_connection(id)
    ON DELETE SET NULL;

-- terminal_activity.session_id: orphaned FK after session delete
ALTER TABLE terminal_activity
  DROP CONSTRAINT IF EXISTS terminal_activity_session_id_fkey;
ALTER TABLE terminal_activity
  ADD CONSTRAINT terminal_activity_session_id_fkey
    FOREIGN KEY (session_id) REFERENCES terminal_session(id)
    ON DELETE SET NULL;

-- terminal_activity.connection_id: same issue
ALTER TABLE terminal_activity
  DROP CONSTRAINT IF EXISTS terminal_activity_connection_id_fkey;
ALTER TABLE terminal_activity
  ADD CONSTRAINT terminal_activity_connection_id_fkey
    FOREIGN KEY (connection_id) REFERENCES terminal_connection(id)
    ON DELETE SET NULL;

-- terminal_known_host.connection_id: same issue
ALTER TABLE terminal_known_host
  DROP CONSTRAINT IF EXISTS terminal_known_host_connection_id_fkey;
ALTER TABLE terminal_known_host
  ADD CONSTRAINT terminal_known_host_connection_id_fkey
    FOREIGN KEY (connection_id) REFERENCES terminal_connection(id)
    ON DELETE SET NULL;

-- ── Retention Cron Optimization ──────────────────────────────
-- Replace the correlated subquery cron job with a CTE-based approach
-- that pre-fetches per-namespace retention values.
SELECT cron.unschedule('terminal-entry-cleanup');

SELECT cron.schedule(
  'terminal-entry-cleanup',
  '0 3 * * *',
  $$
    WITH retention AS (
      SELECT namespace,
             COALESCE((value->>'terminal_entry_retention_days')::int, 90) AS days
      FROM terminal_setting
      WHERE key = 'terminal_retention'
    )
    DELETE FROM terminal_session_entry e
    USING (
      SELECT DISTINCT namespace FROM terminal_session_entry
      WHERE kind != 'annotation'
    ) ns
    LEFT JOIN retention r ON r.namespace = ns.namespace
    WHERE e.namespace = ns.namespace
      AND e.kind != 'annotation'
      AND e.captured_at < now() - make_interval(days => COALESCE(r.days, 90))
  $$
);
