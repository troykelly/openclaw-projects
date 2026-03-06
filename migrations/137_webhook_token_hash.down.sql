-- Issue #2189: Rollback webhook token hashing
-- WARNING: This drops the token_salt column. Any tokens that have been hashed
-- will become unverifiable and will need to be regenerated.

ALTER TABLE project_webhook DROP COLUMN IF EXISTS token_salt;
