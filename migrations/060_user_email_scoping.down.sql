-- Rollback migration 060: Remove user_email scoping columns

DROP INDEX IF EXISTS idx_external_message_user_email;
ALTER TABLE external_message DROP COLUMN IF EXISTS user_email;

DROP INDEX IF EXISTS idx_external_thread_user_email;
ALTER TABLE external_thread DROP COLUMN IF EXISTS user_email;

DROP INDEX IF EXISTS idx_relationship_user_email;
ALTER TABLE relationship DROP COLUMN IF EXISTS user_email;

DROP INDEX IF EXISTS idx_contact_endpoint_user_email;
ALTER TABLE contact_endpoint DROP COLUMN IF EXISTS user_email;

DROP INDEX IF EXISTS idx_contact_user_email;
ALTER TABLE contact DROP COLUMN IF EXISTS user_email;

DROP INDEX IF EXISTS idx_work_item_user_email;
ALTER TABLE work_item DROP COLUMN IF EXISTS user_email;
