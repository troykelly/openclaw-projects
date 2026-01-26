-- Issue #10 rollback

DROP TRIGGER IF EXISTS trg_work_item_communication_enforce_type ON work_item_communication;
DROP FUNCTION IF EXISTS work_item_communication_enforce_type();

DROP TABLE IF EXISTS work_item_communication;
DROP TABLE IF EXISTS external_message;
DROP TABLE IF EXISTS external_thread;

DROP TYPE IF EXISTS communication_action;
DROP TYPE IF EXISTS message_direction;

-- NOTE: we do not remove enum values from work_item_task_type (Postgres doesn't support it safely).
