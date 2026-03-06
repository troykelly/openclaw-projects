-- ============================================================
-- Down migration 142: Remove symphony_run_event hypertable
-- Reverse of 142_symphony_run_event.up.sql
-- Epic #2186 — Symphony Orchestration, Issue #2192
-- ============================================================

-- Remove retention policy before dropping hypertable (defensive: only if hypertable exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM timescaledb_information.hypertables
    WHERE hypertable_name = 'symphony_run_event'
  ) THEN
    PERFORM remove_retention_policy('symphony_run_event', if_exists => TRUE);
  END IF;
END $$;

-- Drop the hypertable (this also removes the columnstore/compression policy)
DROP TABLE IF EXISTS symphony_run_event CASCADE;
