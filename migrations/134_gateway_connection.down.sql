-- Migration 134 (down): Revert gateway_connection table
-- Epic #2153 — Gateway WebSocket Connection, Issue #2161

SELECT cron.unschedule('gateway_connection_cleanup');
DROP TRIGGER IF EXISTS trg_gateway_connection_updated_at ON gateway_connection;
DROP FUNCTION IF EXISTS set_gateway_connection_updated_at();
DROP TABLE IF EXISTS gateway_connection;
