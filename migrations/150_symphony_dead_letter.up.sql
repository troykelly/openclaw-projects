-- Symphony Dead-Letter Queue
-- Issue #2212 — Structured Logging & Trace Correlation
-- Stores failed critical writes (status, activity) after retry exhaustion.

CREATE TABLE IF NOT EXISTS symphony_dead_letter (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  namespace     text        NOT NULL,
  payload       jsonb       NOT NULL,
  error         text        NOT NULL,
  source        text        NOT NULL,  -- e.g., 'run_event', 'activity', 'notification'
  created_at    timestamptz NOT NULL DEFAULT now(),
  resolved_at   timestamptz,
  resolved_by   text
);

-- Index for unresolved entries lookup
CREATE INDEX IF NOT EXISTS idx_symphony_dead_letter_unresolved
  ON symphony_dead_letter (created_at ASC)
  WHERE resolved_at IS NULL;

-- Index for namespace filtering
CREATE INDEX IF NOT EXISTS idx_symphony_dead_letter_namespace
  ON symphony_dead_letter (namespace)
  WHERE resolved_at IS NULL;

-- Add trace_id column to symphony_run_event for trace correlation
-- (may not exist yet if migration 148 hasn't been applied — use IF NOT EXISTS via DO block)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'symphony_run_event') THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'symphony_run_event' AND column_name = 'trace_id'
    ) THEN
      ALTER TABLE symphony_run_event ADD COLUMN trace_id text;
      CREATE INDEX idx_symphony_run_event_trace_id ON symphony_run_event (trace_id)
        WHERE trace_id IS NOT NULL;
    END IF;
  END IF;
END
$$;
