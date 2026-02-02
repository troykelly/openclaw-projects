-- Issue #222: Reminder firing hook for not_before dates
-- Complements the nudge system (not_after) with reminder support (not_before)

-- Reminder enqueuer: work items whose not_before has been reached.
-- Similar to enqueue_due_nudges but for reminders.
CREATE OR REPLACE FUNCTION enqueue_due_reminders()
RETURNS integer
LANGUAGE sql
AS $$
  WITH candidates AS (
    SELECT wi.id,
           wi.not_before
      FROM work_item wi
     WHERE wi.not_before IS NOT NULL
       AND wi.not_before <= now()
       AND wi.status NOT IN ('completed', 'cancelled', 'archived', 'done')
  ),
  inserted AS (
    INSERT INTO internal_job (kind, run_at, payload, idempotency_key)
    SELECT 'reminder.work_item.not_before',
           now(),
           jsonb_build_object(
             'work_item_id', c.id::text,
             'not_before', c.not_before
           ),
           'work_item_not_before:' || c.id::text || ':' || to_char(c.not_before, 'YYYY-MM-DD')
      FROM candidates c
    ON CONFLICT (kind, idempotency_key) DO NOTHING
    RETURNING 1
  )
  SELECT count(*)::int FROM inserted;
$$;

-- Register a pg_cron job to periodically enqueue reminders.
-- Runs every minute to catch reminders quickly.
-- Idempotent: only creates the cron entry if it does not exist.
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'internal_reminder_enqueue') THEN
    PERFORM cron.schedule(
      'internal_reminder_enqueue',
      '*/1 * * * *',
      $cmd$SELECT enqueue_due_reminders();$cmd$
    );
  END IF;
END $do$;

COMMENT ON FUNCTION enqueue_due_reminders() IS 'Enqueues internal jobs for work items whose not_before date has been reached';
