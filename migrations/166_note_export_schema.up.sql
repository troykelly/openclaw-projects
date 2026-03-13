-- Migration 166: note_export table for async document export
-- Part of Epic #2475, Issues #2476 + #2484
-- Tracks export jobs from pending → generating → ready/failed/expired

-- ============================================================
-- STEP 1: ENUM types
-- ============================================================

DO $$ BEGIN
  CREATE TYPE export_format AS ENUM ('pdf', 'docx', 'odf');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE export_status AS ENUM ('pending', 'generating', 'ready', 'failed', 'expired');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE export_source_type AS ENUM ('note', 'notebook');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- STEP 2: note_export table
-- ============================================================

CREATE TABLE IF NOT EXISTS note_export (
  id              uuid PRIMARY KEY DEFAULT new_uuid(),
  namespace       text NOT NULL DEFAULT 'default'
                    CHECK (namespace ~ '^[a-z0-9][a-z0-9._-]*$' AND length(namespace) <= 63),
  requested_by    text NOT NULL,
  source_type     export_source_type NOT NULL,
  source_id       uuid NOT NULL,
  format          export_format NOT NULL,
  options         jsonb NOT NULL DEFAULT '{}',
  status          export_status NOT NULL DEFAULT 'pending',
  error_message   text,
  storage_key     text,
  original_filename text,
  size_bytes      bigint,
  attempt_count   smallint NOT NULL DEFAULT 0,
  started_at      timestamptz,
  expires_at      timestamptz NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  -- storage_key must be set when status is 'ready'
  CONSTRAINT chk_ready_has_storage_key
    CHECK (status != 'ready' OR storage_key IS NOT NULL)
);

COMMENT ON TABLE note_export IS 'Async document export job queue for notes and notebooks';
COMMENT ON COLUMN note_export.namespace IS 'Data partition — matches namespace_grant';
COMMENT ON COLUMN note_export.requested_by IS 'User email or agent identifier that requested the export';
COMMENT ON COLUMN note_export.source_type IS 'Whether exporting a single note or entire notebook';
COMMENT ON COLUMN note_export.source_id IS 'ID of the note or notebook being exported';
COMMENT ON COLUMN note_export.options IS 'Export options: page_size, margin, include_toc, etc.';
COMMENT ON COLUMN note_export.storage_key IS 'S3 key where the generated document is stored';
COMMENT ON COLUMN note_export.attempt_count IS 'Number of generation attempts (for retry tracking, #2484)';
COMMENT ON COLUMN note_export.started_at IS 'Timestamp when status last transitioned to generating (#2484)';
COMMENT ON COLUMN note_export.expires_at IS 'When the export download link expires (default 24h)';

-- ============================================================
-- STEP 3: Indexes
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_note_export_namespace_status
  ON note_export (namespace, status);

CREATE INDEX IF NOT EXISTS idx_note_export_requested_by_created
  ON note_export (requested_by, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_note_export_source
  ON note_export (source_type, source_id);

-- ============================================================
-- STEP 4: updated_at trigger
-- ============================================================

CREATE OR REPLACE FUNCTION update_note_export_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS note_export_updated_at_trigger ON note_export;
CREATE TRIGGER note_export_updated_at_trigger
  BEFORE UPDATE ON note_export
  FOR EACH ROW EXECUTE FUNCTION update_note_export_updated_at();

-- ============================================================
-- STEP 5: pg_cron cleanup job
-- Hourly: mark expired exports
-- ============================================================

DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'note_export_expiry') THEN
    PERFORM cron.schedule(
      'note_export_expiry',
      '0 * * * *',
      $cmd$UPDATE note_export SET status = 'expired' WHERE expires_at < NOW() AND status NOT IN ('failed', 'expired');$cmd$
    );
  END IF;
END $do$;

-- ============================================================
-- NOTE: RLS is NOT enabled on this table.
-- Access control is application-level via namespace scoping,
-- consistent with all other tables in this project.
-- The API service validates namespace membership and
-- requested_by ownership before returning results.
-- ============================================================
