-- ============================================================
-- Migration 124: Fix terminal entry embedding dimensions + switch to HNSW
-- Issue #1862 — Convert terminal search from ILIKE to pgvector cosine similarity
-- ============================================================
--
-- Problems fixed:
--   1. terminal_session_entry.embedding was vector(1536), but the embedding
--      service outputs 1024-dimension vectors. All other tables use vector(1024).
--   2. The ivfflat index was created on an empty table — centroids are degenerate.
--      HNSW doesn't require pre-training and works well at any table size.

-- ── Step 1: Drop the old ivfflat index ──
DROP INDEX IF EXISTS idx_terminal_entry_embedding;

-- ── Step 2: Alter column from vector(1536) to vector(1024) ──
-- No data loss: column has always been NULL (no embeddings generated yet).
ALTER TABLE terminal_session_entry
  ALTER COLUMN embedding TYPE vector(1024);

-- ── Step 3: Create HNSW index for cosine distance ──
-- HNSW parameters: m=16, ef_construction=64 (good defaults for <100K rows)
CREATE INDEX IF NOT EXISTS idx_terminal_entry_embedding_hnsw
  ON terminal_session_entry
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- ── Step 4: Add partial index for un-embedded entries ──
-- Speeds up the worker query: WHERE embedded_at IS NULL
CREATE INDEX IF NOT EXISTS idx_terminal_entry_unembedded
  ON terminal_session_entry (captured_at ASC)
  WHERE embedded_at IS NULL;
