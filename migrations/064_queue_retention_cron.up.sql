-- Issue #1178: pg_cron retention jobs for internal_job and webhook_outbox
-- Removes completed/dead-letter rows to prevent unbounded table growth.

-- Daily cleanup of completed internal jobs older than 30 days
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'internal_job_retention') THEN
    PERFORM cron.schedule(
      'internal_job_retention',
      '0 3 * * *',
      $cmd$DELETE FROM internal_job WHERE completed_at < NOW() - INTERVAL '30 days';$cmd$
    );
  END IF;
END $do$;

-- Daily cleanup of webhook_outbox:
--   dispatched rows older than 30 days
--   dead-letter rows (>=5 attempts) older than 90 days
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'webhook_outbox_retention') THEN
    PERFORM cron.schedule(
      'webhook_outbox_retention',
      '0 3 * * *',
      $cmd$DELETE FROM webhook_outbox WHERE (dispatched_at IS NOT NULL AND dispatched_at < NOW() - INTERVAL '30 days') OR (attempts >= 5 AND created_at < NOW() - INTERVAL '90 days');$cmd$
    );
  END IF;
END $do$;
