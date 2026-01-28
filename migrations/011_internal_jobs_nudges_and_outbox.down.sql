-- Issue #29 rollback

-- Remove cron job (if present)
DO $$
DECLARE
  jid integer;
BEGIN
  SELECT jobid INTO jid FROM cron.job WHERE jobname = 'internal_nudge_enqueue' LIMIT 1;
  IF jid IS NOT NULL THEN
    PERFORM cron.unschedule(jid);
  END IF;
END $$;

DROP FUNCTION IF EXISTS enqueue_due_nudges();
DROP FUNCTION IF EXISTS internal_job_fail(uuid, text, integer);
DROP FUNCTION IF EXISTS internal_job_complete(uuid);
DROP FUNCTION IF EXISTS internal_job_claim(text, integer);
DROP FUNCTION IF EXISTS internal_job_enqueue(text, timestamptz, jsonb, text);

DROP TABLE IF EXISTS webhook_outbox;
DROP TABLE IF EXISTS internal_job;
