-- Issue #2189: Webhook Token Hashing — HMAC-SHA-256 with per-token salt
--
-- Adds a token_salt column to project_webhook. When populated, the token
-- column stores an HMAC-SHA-256 hash instead of plaintext. Existing tokens
-- remain plaintext (null salt) until rehashed by the application on next use
-- or by a background migration job.

ALTER TABLE project_webhook
  ADD COLUMN IF NOT EXISTS token_salt text;

COMMENT ON COLUMN project_webhook.token_salt IS
  'Per-token salt for HMAC-SHA-256 hashing. NULL means token column is plaintext (legacy).';
