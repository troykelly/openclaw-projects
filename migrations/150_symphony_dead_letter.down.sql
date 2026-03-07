-- Undo: Symphony Dead-Letter Queue
-- Issue #2212

-- Remove trace_id from symphony_run_event (if table exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'symphony_run_event') THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'symphony_run_event' AND column_name = 'trace_id'
    ) THEN
      DROP INDEX IF EXISTS idx_symphony_run_event_trace_id;
      ALTER TABLE symphony_run_event DROP COLUMN trace_id;
    END IF;
  END IF;
END
$$;

DROP TABLE IF EXISTS symphony_dead_letter;
