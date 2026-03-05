-- Migration 135 (down): Revert gateway_connection table
-- Epic #2153 — Gateway WebSocket Connection, Issue #2161

-- Defensive: only unschedule if the job exists
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'gateway_connection_cleanup') THEN
    PERFORM cron.unschedule('gateway_connection_cleanup');
  END IF;
END;
$do$;
DROP TRIGGER IF EXISTS trg_gateway_connection_updated_at ON gateway_connection;
DROP FUNCTION IF EXISTS set_gateway_connection_updated_at();
DROP TABLE IF EXISTS gateway_connection;
