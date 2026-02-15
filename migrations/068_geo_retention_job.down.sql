-- Down migration 068: Remove geo location retention pgcron job
-- Reverse of 068_geo_retention_job.up.sql

-- 1. Unschedule the pgcron job
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'geo_retention_cleanup') THEN
    PERFORM cron.unschedule('geo_retention_cleanup');
  END IF;
END $do$;

-- 2. Drop the retention function
DROP FUNCTION IF EXISTS geo_retention_cleanup();
