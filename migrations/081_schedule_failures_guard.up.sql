-- Migration 081: Guard against enqueuing schedules at max_retries
-- Issue #1360: If worker crashes between hitting max_retries and
-- the processor disabling the schedule, the SQL enqueue function
-- keeps firing because it doesn't check consecutive_failures.
--
-- Fix: Two-phase approach:
-- 1. Auto-disable any enabled schedules that have reached max_retries
--    (handles max_retries=0 edge case and crash recovery)
-- 2. Add consecutive_failures < max_retries guard to WHERE clause
--    as defense-in-depth

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
  -- Phase 1: Auto-disable schedules that have reached max_retries (Issue #1360)
  -- This handles the crash recovery case: if the processor crashed before
  -- disabling the schedule, we clean it up here. Also handles max_retries=0.
  UPDATE skill_store_schedule
  SET enabled = false,
      last_run_status = 'failed'
  WHERE enabled = true
    AND consecutive_failures >= max_retries
    AND max_retries IS NOT NULL;

  -- Phase 2: Enqueue due schedules (with guard as defense-in-depth)
  FOR v_schedule IN
    SELECT id, skill_id, collection, webhook_url, webhook_headers,
           payload_template, max_retries, consecutive_failures,
           last_run_at, last_run_status, cron_expression, timezone
    FROM skill_store_schedule
    WHERE enabled = true
      AND next_run_at IS NOT NULL
      AND next_run_at <= now()
      -- Guard: do not enqueue if consecutive failures have reached max_retries (Issue #1360)
      AND (consecutive_failures < max_retries OR max_retries IS NULL)
      -- Overlap prevention: skip if previous run still in progress
      -- (last_run_status IS NULL means never run OR currently running)
      AND NOT (
        last_run_status IS NULL
        AND last_run_at IS NOT NULL
        AND last_run_at > now() - interval '1 hour'
      )
    FOR UPDATE SKIP LOCKED
  LOOP
    -- Use minute-granularity idempotency key to prevent duplicate jobs
    v_minute_bucket := to_char(now(), 'YYYY-MM-DD-HH24-MI');
    v_idem_key := 'skill_schedule:' || v_schedule.id::text || ':' || v_minute_bucket;

    -- Use SELECT INTO (not PERFORM) to detect dedup hits
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

    -- Only update last_run_at when a job was actually enqueued (not a dedup hit)
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
  'Finds due skill store schedules and enqueues processing jobs. Auto-disables schedules at max_retries and skips them (Issue #1360). Uses FOR UPDATE SKIP LOCKED for concurrency safety.';
