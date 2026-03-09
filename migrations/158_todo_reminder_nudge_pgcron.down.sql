-- Down migration for Issue #2292: Remove todo reminder/nudge pgcron functions

-- Remove cron jobs
SELECT cron.unschedule('internal_todo_reminder_enqueue')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'internal_todo_reminder_enqueue');

SELECT cron.unschedule('internal_todo_nudge_enqueue')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'internal_todo_nudge_enqueue');

-- Drop functions
DROP FUNCTION IF EXISTS enqueue_due_todo_reminders();
DROP FUNCTION IF EXISTS enqueue_due_todo_nudges();
