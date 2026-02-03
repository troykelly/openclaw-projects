-- Rollback: Remove embedding support from external_message
-- Part of Issue #295

-- Drop triggers first
DROP TRIGGER IF EXISTS tr_message_body_update_embedding ON external_message;
DROP TRIGGER IF EXISTS tr_message_queue_embedding ON external_message;

-- Drop functions
DROP FUNCTION IF EXISTS enqueue_message_embedding_on_body_update();
DROP FUNCTION IF EXISTS enqueue_message_embedding_job();

-- Drop indexes
DROP INDEX IF EXISTS idx_message_embedding_status;
DROP INDEX IF EXISTS idx_message_embedding;

-- Remove columns
ALTER TABLE external_message
  DROP COLUMN IF EXISTS embedding_status,
  DROP COLUMN IF EXISTS embedding_provider,
  DROP COLUMN IF EXISTS embedding_model,
  DROP COLUMN IF EXISTS embedding;
