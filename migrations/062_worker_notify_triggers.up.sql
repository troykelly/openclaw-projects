-- Issue #1178: NOTIFY triggers for worker container LISTEN/NOTIFY polling
-- These triggers fire pg_notify on INSERT so the worker can wake immediately
-- instead of polling on an interval.

-- Trigger function for internal_job inserts
CREATE OR REPLACE FUNCTION notify_internal_job_ready()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_notify('internal_job_ready', NEW.id::text);
  RETURN NEW;
END;
$$;

-- Trigger function for webhook_outbox inserts
CREATE OR REPLACE FUNCTION notify_webhook_outbox_ready()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_notify('webhook_outbox_ready', NEW.id::text);
  RETURN NEW;
END;
$$;

-- Wire triggers to tables
CREATE TRIGGER trg_internal_job_notify
  AFTER INSERT ON internal_job
  FOR EACH ROW
  EXECUTE FUNCTION notify_internal_job_ready();

CREATE TRIGGER trg_webhook_outbox_notify
  AFTER INSERT ON webhook_outbox
  FOR EACH ROW
  EXECUTE FUNCTION notify_webhook_outbox_ready();
