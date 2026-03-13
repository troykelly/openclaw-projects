-- Migration 166 down: Remove note_export table and related objects
-- Part of Epic #2475, Issues #2476 + #2484

-- Remove pg_cron job
DO $do$
BEGIN
  PERFORM cron.unschedule('note_export_expiry');
EXCEPTION WHEN undefined_object THEN NULL;
END $do$;

-- Drop trigger and function
DROP TRIGGER IF EXISTS note_export_updated_at_trigger ON note_export;
DROP FUNCTION IF EXISTS update_note_export_updated_at();

-- Drop table (cascades indexes)
DROP TABLE IF EXISTS note_export;

-- Drop enum types
DROP TYPE IF EXISTS export_source_type;
DROP TYPE IF EXISTS export_status;
DROP TYPE IF EXISTS export_format;
