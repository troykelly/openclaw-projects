-- Migration 134: gateway_connection table for WS connection state tracking
-- Epic #2153 — Gateway WebSocket Connection, Issue #2161

CREATE TABLE IF NOT EXISTS gateway_connection (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id   TEXT        NOT NULL UNIQUE,
  gateway_url   TEXT        NOT NULL,
  status        TEXT        NOT NULL
                CHECK (status IN ('connecting', 'connected', 'disconnected')),
  connected_at  TIMESTAMPTZ,
  last_tick_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS gateway_connection_updated_at_idx
  ON gateway_connection (updated_at);

-- Trigger: auto-update updated_at on row change
CREATE OR REPLACE FUNCTION set_gateway_connection_updated_at()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_gateway_connection_updated_at
  BEFORE UPDATE ON gateway_connection
  FOR EACH ROW EXECUTE FUNCTION set_gateway_connection_updated_at();

-- pg_cron: remove stale entries from dead instances every minute
-- Uses IF NOT EXISTS pattern to be idempotent
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'gateway_connection_cleanup') THEN
    PERFORM cron.schedule(
      'gateway_connection_cleanup',
      '* * * * *',
      $$DELETE FROM gateway_connection WHERE updated_at < NOW() - INTERVAL '5 minutes'$$
    );
  END IF;
END;
$do$;
