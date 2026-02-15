-- Migration 068: Geo location retention pgcron job
-- Part of Epic #1242, Issue #1252
-- Creates geo_retention_cleanup() function and schedules daily pgcron job
-- Downsamples high-res data and deletes records beyond general retention window

-- ============================================================
-- 1. geo_retention_cleanup() — per-user retention enforcement
-- ============================================================

CREATE OR REPLACE FUNCTION geo_retention_cleanup()
RETURNS TABLE(users_processed int, records_downsampled bigint, records_expired bigint) AS $$
DECLARE
  setting RECORD;
  high_res_cutoff timestamptz;
  general_cutoff timestamptz;
  total_users int := 0;
  total_downsampled bigint := 0;
  total_expired bigint := 0;
  deleted_count bigint;
BEGIN
  FOR setting IN
    SELECT email, geo_high_res_retention_hours, geo_general_retention_days
    FROM user_setting
    WHERE geo_high_res_retention_hours IS NOT NULL
      AND geo_general_retention_days IS NOT NULL
  LOOP
    total_users := total_users + 1;
    high_res_cutoff := now() - (setting.geo_high_res_retention_hours || ' hours')::interval;
    general_cutoff := now() - (setting.geo_general_retention_days || ' days')::interval;

    -- Step 1: Delete ALL records beyond general retention window
    DELETE FROM geo_location
    WHERE user_email = setting.email
      AND time < general_cutoff;
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    total_expired := total_expired + deleted_count;

    -- Step 2: Downsample between high_res_cutoff and general_cutoff
    -- Keep only the best-accuracy record per (user, provider, entity, hour).
    -- Use an EXISTS-based anti-join to avoid ctid issues with TimescaleDB hypertables.
    DELETE FROM geo_location gl
    WHERE gl.user_email = setting.email
      AND gl.time < high_res_cutoff
      AND gl.time >= general_cutoff
      AND EXISTS (
        SELECT 1 FROM geo_location gl2
        WHERE gl2.user_email = gl.user_email
          AND gl2.provider_id = gl.provider_id
          AND gl2.entity_id IS NOT DISTINCT FROM gl.entity_id
          AND date_trunc('hour', gl2.time) = date_trunc('hour', gl.time)
          AND (
            -- gl2 has better (lower) accuracy than gl
            (gl2.accuracy_m IS NOT NULL AND gl.accuracy_m IS NOT NULL AND gl2.accuracy_m < gl.accuracy_m)
            -- gl2 has accuracy, gl does not
            OR (gl2.accuracy_m IS NOT NULL AND gl.accuracy_m IS NULL)
            -- same accuracy, break ties by keeping the more recent record
            OR (gl2.accuracy_m IS NOT DISTINCT FROM gl.accuracy_m AND gl2.time > gl.time)
          )
      );
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    total_downsampled := total_downsampled + deleted_count;
  END LOOP;

  users_processed := total_users;
  records_downsampled := total_downsampled;
  records_expired := total_expired;
  RETURN NEXT;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION geo_retention_cleanup() IS
  'Per-user geo_location retention: downsample high-res data and delete expired records (Issue #1252)';

-- ============================================================
-- 2. Register pgcron job — daily at 03:00 UTC, idempotent
-- ============================================================

DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'geo_retention_cleanup') THEN
    PERFORM cron.schedule(
      'geo_retention_cleanup',
      '0 3 * * *',
      $cmd$SELECT * FROM geo_retention_cleanup();$cmd$
    );
  END IF;
END $do$;
