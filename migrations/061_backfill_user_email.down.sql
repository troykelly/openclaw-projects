-- Rollback migration 061: Revert backfilled user_email to NULL
-- Only touches rows that were set to the sentinel default by the up migration.

UPDATE work_item SET user_email = NULL WHERE user_email = 'default@openclaw.local';
UPDATE contact SET user_email = NULL WHERE user_email = 'default@openclaw.local';
UPDATE contact_endpoint SET user_email = NULL WHERE user_email = 'default@openclaw.local';
UPDATE relationship SET user_email = NULL WHERE user_email = 'default@openclaw.local';
UPDATE external_thread SET user_email = NULL WHERE user_email = 'default@openclaw.local';
UPDATE external_message SET user_email = NULL WHERE user_email = 'default@openclaw.local';
