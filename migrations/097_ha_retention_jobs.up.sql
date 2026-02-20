-- ============================================================
-- Migration 096: Home Assistant retention pgcron jobs
-- Epic #1440 — HA observation pipeline
-- Issue #1469 — Retention pgcron job
--
-- 1. ha_anomaly_archive: daily at 03:00 UTC
--    - Auto-resolve unresolved anomalies older than 90 days
--    - Hard delete anomalies older than 180 days
-- 2. ha_obs_weekly_stats: weekly at 04:00 UTC on Sundays
--    - Snapshot weekly observation statistics into ha_state_snapshots
-- ============================================================

-- ============================================================
-- 1. ha_anomaly_archive — daily anomaly lifecycle management
-- ============================================================

DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ha_anomaly_archive') THEN
    PERFORM cron.schedule(
      'ha_anomaly_archive',
      '0 3 * * *',
      $cmd$
        -- Auto-resolve old unresolved anomalies (90 days)
        UPDATE ha_anomalies
        SET resolved = TRUE
        WHERE resolved = FALSE
          AND created_at < NOW() - INTERVAL '90 days';

        -- Hard delete very old anomalies (180 days)
        DELETE FROM ha_anomalies
        WHERE created_at < NOW() - INTERVAL '180 days';
      $cmd$
    );
  END IF;
END $do$;

-- ============================================================
-- 2. ha_obs_weekly_stats — weekly observation snapshot
-- ============================================================

DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ha_obs_weekly_stats') THEN
    PERFORM cron.schedule(
      'ha_obs_weekly_stats',
      '0 4 * * 0',
      $cmd$
        WITH entity_stats AS (
          SELECT
            namespace,
            domain,
            entity_id,
            MAX(timestamp) AS latest_ts
          FROM ha_observations
          WHERE timestamp > NOW() - INTERVAL '7 days'
          GROUP BY namespace, domain, entity_id
        ),
        domain_counts AS (
          SELECT
            namespace,
            domain,
            COUNT(*) AS domain_entity_count
          FROM entity_stats
          GROUP BY namespace, domain
        )
        INSERT INTO ha_state_snapshots (namespace, snapshot_date, entity_count, active_count, domain_summary)
        SELECT
          e.namespace,
          CURRENT_DATE,
          COUNT(DISTINCT e.entity_id),
          COUNT(DISTINCT e.entity_id) FILTER (WHERE e.latest_ts > NOW() - INTERVAL '24 hours'),
          (SELECT jsonb_object_agg(d.domain, d.domain_entity_count)
           FROM domain_counts d
           WHERE d.namespace = e.namespace)
        FROM entity_stats e
        GROUP BY e.namespace
        ON CONFLICT (namespace, snapshot_date) DO UPDATE
          SET entity_count = EXCLUDED.entity_count,
              active_count = EXCLUDED.active_count,
              domain_summary = EXCLUDED.domain_summary;
      $cmd$
    );
  END IF;
END $do$;
