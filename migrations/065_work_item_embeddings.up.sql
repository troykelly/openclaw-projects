-- Migration 065: Add embedding support to work_item
-- Part of Issue #1216 - semantic search for work items (todos, projects, etc.)
-- Required extension: pgvector (enabled in 007_required_extensions)
-- Follows the same pattern as memory (025), external_message (039), and skill_store_item (050)

-- Add embedding columns to work_item
-- Using 1024 dimensions (same as memory and external_message for consistency)
ALTER TABLE work_item
  ADD COLUMN IF NOT EXISTS embedding vector(1024),
  ADD COLUMN IF NOT EXISTS embedding_model TEXT,
  ADD COLUMN IF NOT EXISTS embedding_provider TEXT,
  ADD COLUMN IF NOT EXISTS embedding_status TEXT DEFAULT 'pending'
    CHECK (embedding_status IN ('complete', 'pending', 'failed', 'skipped'));

-- Create HNSW index for fast similarity search
-- Using cosine distance for semantic similarity
-- m=16, ef_construction=64 provides good recall/speed balance (same as memory table)
CREATE INDEX IF NOT EXISTS idx_work_item_embedding
  ON work_item
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Index for finding work items by embedding status (for backfill operations)
CREATE INDEX IF NOT EXISTS idx_work_item_embedding_status
  ON work_item(embedding_status)
  WHERE embedding_status != 'complete';
