-- Issue #1178 rollback: remove retention cron jobs

DO $$
DECLARE
  jid integer;
BEGIN
  SELECT jobid INTO jid FROM cron.job WHERE jobname = 'webhook_outbox_retention' LIMIT 1;
  IF jid IS NOT NULL THEN
    PERFORM cron.unschedule(jid);
  END IF;
END $$;

DO $$
DECLARE
  jid integer;
BEGIN
  SELECT jobid INTO jid FROM cron.job WHERE jobname = 'internal_job_retention' LIMIT 1;
  IF jid IS NOT NULL THEN
    PERFORM cron.unschedule(jid);
  END IF;
END $$;
