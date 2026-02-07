-- Migration 053: Fix scheduling engine reliability
-- Part of Epic #794, Issue #825
--
-- Fixes:
-- 1. Add consecutive_failures column (was only in payload, never tracked)
-- 2. FOR UPDATE SKIP LOCKED to prevent concurrent pgcron race conditions
-- 3. Use SELECT INTO (not PERFORM) to detect dedup hits
-- 4. Only update last_run_at when a job is actually enqueued
-- 5. Include consecutive_failures in payload for processor

-- ============================================================================
-- SCHEMA CHANGES
-- ============================================================================

ALTER TABLE skill_store_schedule
  ADD COLUMN IF NOT EXISTS consecutive_failures integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN skill_store_schedule.consecutive_failures
  IS 'Tracks consecutive job failures; auto-disables schedule when >= max_retries';

-- ============================================================================
-- REPLACE JOB ENQUEUE FUNCTION
-- ============================================================================
-- Fixes:
-- - FOR UPDATE SKIP LOCKED prevents concurrent pgcron invocations from
--   processing the same schedules.
-- - SELECT INTO (not PERFORM) captures the returned UUID so we know if a
--   job was actually enqueued vs. dedup hit (idempotency collision).
-- - Only updates last_run_at/last_run_status when a job is enqueued.
-- - Includes consecutive_failures in payload for processor auto-disable.
-- - Dedup strategy: minute-granularity idempotency keys. The next_run_at
--   column is kept for UI display but not used for scheduling decisions;
--   pgcron fires every minute, and idempotency keys prevent duplicates.

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
  'Finds due skill store schedules and enqueues processing jobs with idempotency. Uses FOR UPDATE SKIP LOCKED for concurrency safety.';
