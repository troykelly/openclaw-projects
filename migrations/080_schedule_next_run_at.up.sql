-- Migration 080: Compute next_run_at in SQL enqueue function
-- Issue #1356: next_run_at was never set, causing every enabled schedule
-- to fire every minute regardless of cron_expression.
--
-- This migration updates the SQL enqueue function to remove the
-- `next_run_at IS NULL` bypass from the WHERE clause. The application
-- layer (server.ts, processor.ts) now computes and sets next_run_at
-- using cron-parser. This SQL change ensures that schedules without
-- next_run_at (legacy rows) get a backfill, and the enqueue function
-- no longer treats NULL next_run_at as "always due".

-- ============================================================================
-- BACKFILL: Set next_run_at for existing enabled schedules that have NULL
-- ============================================================================
-- We set next_run_at = now() so they fire on the next pgcron tick and then
-- get their next_run_at properly computed by the application processor.

UPDATE skill_store_schedule
SET next_run_at = now()
WHERE enabled = true
  AND next_run_at IS NULL;

-- ============================================================================
-- REPLACE JOB ENQUEUE FUNCTION
-- ============================================================================
-- Changes from migration 053:
-- 1. Remove `next_run_at IS NULL` from WHERE clause — schedules MUST have
--    next_run_at set by the application layer to be considered due.
-- 2. After enqueueing, the application processor sets next_run_at via
--    computeNextRunAt(); the SQL function no longer needs to handle this.

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
           last_run_at, last_run_status, cron_expression, timezone
    FROM skill_store_schedule
    WHERE enabled = true
      AND next_run_at IS NOT NULL
      AND next_run_at <= now()
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
  'Finds due skill store schedules (next_run_at <= now) and enqueues processing jobs. Uses FOR UPDATE SKIP LOCKED for concurrency safety. Issue #1356: requires next_run_at to be set by application layer.';
