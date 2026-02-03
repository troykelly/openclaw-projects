-- Migration: Add embedding support to external_message
-- Part of Issue #295 - semantic search for messages
-- Required extension: pgvector (enabled in 007_required_extensions)

-- Add embedding columns to external_message
-- Using 1024 dimensions (same as memory table for consistency)
ALTER TABLE external_message
  ADD COLUMN IF NOT EXISTS embedding vector(1024),
  ADD COLUMN IF NOT EXISTS embedding_model TEXT,
  ADD COLUMN IF NOT EXISTS embedding_provider TEXT,
  ADD COLUMN IF NOT EXISTS embedding_status TEXT DEFAULT 'pending'
    CHECK (embedding_status IN ('complete', 'pending', 'failed'));

-- Create HNSW index for fast similarity search
-- Using cosine distance for semantic similarity
-- m=16, ef_construction=64 provides good recall/speed balance
CREATE INDEX IF NOT EXISTS idx_message_embedding
  ON external_message
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Index for finding messages by embedding status (for backfill operations)
CREATE INDEX IF NOT EXISTS idx_message_embedding_status
  ON external_message(embedding_status)
  WHERE embedding_status != 'complete';

-- Function to enqueue embedding job on message insert
CREATE OR REPLACE FUNCTION enqueue_message_embedding_job()
RETURNS TRIGGER AS $$
BEGIN
  -- Only queue for messages with body content
  IF NEW.body IS NOT NULL AND length(trim(NEW.body)) > 0 THEN
    -- Enqueue embedding job (idempotency key prevents duplicates)
    PERFORM internal_job_enqueue(
      'message.embed',
      NOW(),
      jsonb_build_object('message_id', NEW.id::text),
      'message.embed:' || NEW.id::text
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-queue embedding jobs on message insert
DROP TRIGGER IF EXISTS tr_message_queue_embedding ON external_message;
CREATE TRIGGER tr_message_queue_embedding
  AFTER INSERT ON external_message
  FOR EACH ROW
  EXECUTE FUNCTION enqueue_message_embedding_job();

-- Also queue when body is updated (for messages where body was initially empty)
CREATE OR REPLACE FUNCTION enqueue_message_embedding_on_body_update()
RETURNS TRIGGER AS $$
BEGIN
  -- Only if body changed and now has content
  IF (OLD.body IS DISTINCT FROM NEW.body)
     AND NEW.body IS NOT NULL
     AND length(trim(NEW.body)) > 0
     AND (NEW.embedding IS NULL OR NEW.embedding_status != 'complete')
  THEN
    -- Reset embedding status
    NEW.embedding_status := 'pending';
    NEW.embedding := NULL;
    NEW.embedding_model := NULL;
    NEW.embedding_provider := NULL;

    -- Enqueue new embedding job
    PERFORM internal_job_enqueue(
      'message.embed',
      NOW(),
      jsonb_build_object('message_id', NEW.id::text),
      'message.embed:' || NEW.id::text || ':' || extract(epoch from now())::text
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_message_body_update_embedding ON external_message;
CREATE TRIGGER tr_message_body_update_embedding
  BEFORE UPDATE ON external_message
  FOR EACH ROW
  EXECUTE FUNCTION enqueue_message_embedding_on_body_update();
