-- Migration 080 down: Revert to migration 053 version of enqueue function
-- Restores the `next_run_at IS NULL` bypass in the WHERE clause.

CREATE OR REPLACE FUNCTION enqueue_skill_store_scheduled_jobs()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_count integer := 0;
  v_schedule RECORD;
  v_minute_bucket text;
  v_idem_key text;
  v_job_id uuid;
BEGIN
  FOR v_schedule IN
    SELECT id, skill_id, collection, webhook_url, webhook_headers,
           payload_template, max_retries, consecutive_failures,
           last_run_at, last_run_status
    FROM skill_store_schedule
    WHERE enabled = true
      AND (
        next_run_at IS NULL
        OR next_run_at <= now()
      )
      AND NOT (
        last_run_status IS NULL
        AND last_run_at IS NOT NULL
        AND last_run_at > now() - interval '1 hour'
      )
    FOR UPDATE SKIP LOCKED
  LOOP
    v_minute_bucket := to_char(now(), 'YYYY-MM-DD-HH24-MI');
    v_idem_key := 'skill_schedule:' || v_schedule.id::text || ':' || v_minute_bucket;

    SELECT internal_job_enqueue(
      'skill_store.scheduled_process',
      now(),
      jsonb_build_object(
        'schedule_id', v_schedule.id::text,
        'skill_id', v_schedule.skill_id,
        'collection', v_schedule.collection,
        'webhook_url', v_schedule.webhook_url,
        'webhook_headers', v_schedule.webhook_headers,
        'payload_template', v_schedule.payload_template,
        'max_retries', v_schedule.max_retries,
        'consecutive_failures', v_schedule.consecutive_failures,
        'triggered_at', now()::text
      ),
      v_idem_key
    ) INTO v_job_id;

    IF v_job_id IS NOT NULL THEN
      UPDATE skill_store_schedule
      SET last_run_at = now(),
          last_run_status = NULL
      WHERE id = v_schedule.id;

      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION enqueue_skill_store_scheduled_jobs IS
  'Finds due skill store schedules and enqueues processing jobs with idempotency. Uses FOR UPDATE SKIP LOCKED for concurrency safety.';
