-- Issue #1178 rollback: remove NOTIFY triggers

DROP TRIGGER IF EXISTS trg_webhook_outbox_notify ON webhook_outbox;
DROP TRIGGER IF EXISTS trg_internal_job_notify ON internal_job;
DROP FUNCTION IF EXISTS notify_webhook_outbox_ready();
DROP FUNCTION IF EXISTS notify_internal_job_ready();
