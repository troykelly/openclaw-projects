-- ============================================================
-- Down migration 096: Remove HA retention pgcron jobs
-- Reverse of 096_ha_retention_jobs.up.sql
-- ============================================================

-- 1. Unschedule the anomaly archive job
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ha_anomaly_archive') THEN
    PERFORM cron.unschedule('ha_anomaly_archive');
  END IF;
END $do$;

-- 2. Unschedule the weekly stats snapshot job
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ha_obs_weekly_stats') THEN
    PERFORM cron.unschedule('ha_obs_weekly_stats');
  END IF;
END $do$;
