-- Migration 058 down: Remove OAuth sync job infrastructure (Issue #1055)

-- 1. Unschedule the pgcron job
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'oauth_contact_sync_enqueue') THEN
    PERFORM cron.unschedule('oauth_contact_sync_enqueue');
  END IF;
END $do$;

-- 2. Drop the enqueue function
DROP FUNCTION IF EXISTS enqueue_oauth_contact_sync_jobs();

-- 3. Clean up any pending sync jobs
DELETE FROM internal_job WHERE kind = 'oauth.sync.contacts' AND completed_at IS NULL;
