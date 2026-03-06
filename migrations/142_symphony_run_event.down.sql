-- ============================================================
-- Down migration 142: Remove symphony_run_event hypertable
-- Reverse of 142_symphony_run_event.up.sql
-- Epic #2186 — Symphony Orchestration, Issue #2192
-- ============================================================

-- Remove retention policy before dropping hypertable
SELECT remove_retention_policy('symphony_run_event', if_exists => TRUE);

-- Drop the hypertable (this also removes the columnstore/compression policy)
DROP TABLE IF EXISTS symphony_run_event CASCADE;
