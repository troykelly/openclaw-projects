-- Migration 058: OAuth sync job infrastructure (Issue #1055)
--
-- Adds a pgcron-driven periodic enqueue function for contact sync jobs.
-- Only contacts sync locally; email/files/calendar use live API access.
--
-- Pattern: identical to enqueue_due_nudges() / enqueue_due_reminders().
-- A single pgcron job runs every 5 minutes. For each active connection
-- with 'contacts' in enabled_features and enough elapsed time since last
-- sync, an internal_job row is inserted (idempotent via idempotency_key).

-- 1. Create the enqueue function
CREATE OR REPLACE FUNCTION enqueue_oauth_contact_sync_jobs()
RETURNS integer
LANGUAGE sql
AS $$
  WITH candidates AS (
    SELECT oc.id::text AS connection_id
      FROM oauth_connection oc
     WHERE oc.is_active = true
       AND 'contacts' = ANY(oc.enabled_features)
       -- Only enqueue if enough time has elapsed since last successful contacts sync.
       -- The interval check uses the sync_status JSONB field.
       -- If no lastSuccess exists, always enqueue (first sync).
       AND (
         oc.sync_status->'contacts'->>'lastSuccess' IS NULL
         OR (now() - (oc.sync_status->'contacts'->>'lastSuccess')::timestamptz)
            >= COALESCE(
                 current_setting('openclaw.contact_sync_interval', true),
                 '6 hours'
               )::interval
       )
  ),
  inserted AS (
    INSERT INTO internal_job (kind, run_at, payload, idempotency_key)
    SELECT 'oauth.sync.contacts',
           now(),
           jsonb_build_object(
             'connection_id', c.connection_id,
             'feature', 'contacts'
           ),
           'oauth_sync:' || c.connection_id || ':contacts'
      FROM candidates c
    ON CONFLICT (kind, idempotency_key) DO NOTHING
    RETURNING 1
  )
  SELECT count(*)::int FROM inserted;
$$;

COMMENT ON FUNCTION enqueue_oauth_contact_sync_jobs() IS
  'Enqueues internal jobs for OAuth connections that need a contact sync (Issue #1055)';

-- 2. Register the pgcron job (idempotent)
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'oauth_contact_sync_enqueue') THEN
    PERFORM cron.schedule(
      'oauth_contact_sync_enqueue',
      '*/5 * * * *',
      $cmd$SELECT enqueue_oauth_contact_sync_jobs();$cmd$
    );
  END IF;
END $do$;
