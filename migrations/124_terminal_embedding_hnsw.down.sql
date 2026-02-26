-- ============================================================
-- Migration 124 (down): Revert embedding column + index changes
-- ============================================================

DROP INDEX IF EXISTS idx_terminal_entry_unembedded;
DROP INDEX IF EXISTS idx_terminal_entry_embedding_hnsw;

ALTER TABLE terminal_session_entry
  ALTER COLUMN embedding TYPE vector(1536);

CREATE INDEX IF NOT EXISTS idx_terminal_entry_embedding
  ON terminal_session_entry USING ivfflat (embedding vector_cosine_ops);
