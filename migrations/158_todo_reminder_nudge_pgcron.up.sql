-- Issue #2292: pgcron functions for todo reminder/nudge and job routing
-- Complements the work_item reminder/nudge system with todo-specific support.

-- ============================================================
-- Reminder enqueuer: todos whose not_before has been reached.
-- ============================================================
CREATE OR REPLACE FUNCTION enqueue_due_todo_reminders()
RETURNS integer
LANGUAGE sql
AS $$
  WITH candidates AS (
    SELECT t.id,
           t.work_item_id,
           t.text,
           t.not_before,
           t.namespace
      FROM work_item_todo t
     WHERE t.not_before IS NOT NULL
       AND t.not_before <= now()
       AND t.completed = false
  ),
  inserted AS (
    INSERT INTO internal_job (kind, run_at, payload, idempotency_key)
    SELECT 'reminder.todo.not_before',
           now(),
           jsonb_build_object(
             'entity_type', 'todo',
             'todo_id', c.id::text,
             'work_item_id', c.work_item_id::text,
             'text', c.text,
             'namespace', c.namespace
           ),
           'todo_not_before:' || c.id::text || ':' || to_char(c.not_before, 'YYYY-MM-DD')
      FROM candidates c
    ON CONFLICT (kind, idempotency_key) DO NOTHING
    RETURNING 1
  )
  SELECT count(*)::int FROM inserted;
$$;

COMMENT ON FUNCTION enqueue_due_todo_reminders() IS 'Enqueues internal jobs for todos whose not_before date has been reached';

-- ============================================================
-- Nudge enqueuer: todos whose not_after (deadline) is approaching.
-- ============================================================
CREATE OR REPLACE FUNCTION enqueue_due_todo_nudges()
RETURNS integer
LANGUAGE sql
AS $$
  WITH candidates AS (
    SELECT t.id,
           t.work_item_id,
           t.text,
           t.not_after,
           t.namespace
      FROM work_item_todo t
     WHERE t.not_after IS NOT NULL
       AND t.not_after > now()
       AND t.not_after <= now() + interval '24 hours'
       AND t.completed = false
  ),
  inserted AS (
    INSERT INTO internal_job (kind, run_at, payload, idempotency_key)
    SELECT 'nudge.todo.not_after',
           now(),
           jsonb_build_object(
             'entity_type', 'todo',
             'todo_id', c.id::text,
             'work_item_id', c.work_item_id::text,
             'text', c.text,
             'namespace', c.namespace
           ),
           'todo_not_after:' || c.id::text || ':' || to_char(c.not_after, 'YYYY-MM-DD')
      FROM candidates c
    ON CONFLICT (kind, idempotency_key) DO NOTHING
    RETURNING 1
  )
  SELECT count(*)::int FROM inserted;
$$;

COMMENT ON FUNCTION enqueue_due_todo_nudges() IS 'Enqueues internal jobs for todos whose not_after deadline is approaching';

-- ============================================================
-- Register pg_cron jobs for todo reminders and nudges.
-- ============================================================
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'internal_todo_reminder_enqueue') THEN
    PERFORM cron.schedule(
      'internal_todo_reminder_enqueue',
      '*/1 * * * *',
      $cmd$SELECT enqueue_due_todo_reminders();$cmd$
    );
  END IF;
END $do$;

DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'internal_todo_nudge_enqueue') THEN
    PERFORM cron.schedule(
      'internal_todo_nudge_enqueue',
      '*/5 * * * *',
      $cmd$SELECT enqueue_due_todo_nudges();$cmd$
    );
  END IF;
END $do$;
