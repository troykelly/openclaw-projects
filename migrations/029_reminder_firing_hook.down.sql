-- Issue #222: Rollback reminder firing hook

-- Remove the pg_cron job
SELECT cron.unschedule('internal_reminder_enqueue')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'internal_reminder_enqueue');

-- Drop the function
DROP FUNCTION IF EXISTS enqueue_due_reminders();
