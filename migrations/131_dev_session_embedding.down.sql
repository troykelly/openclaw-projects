-- Rollback Issue #1987: Remove embedding and search support from dev_session.

DROP TRIGGER IF EXISTS trg_dev_session_search_vector ON dev_session;
DROP FUNCTION IF EXISTS dev_session_search_vector_update();

DROP INDEX IF EXISTS idx_dev_session_embedding_hnsw;
DROP INDEX IF EXISTS idx_dev_session_search_vector;
DROP INDEX IF EXISTS idx_dev_session_embedding_status;

ALTER TABLE dev_session
  DROP COLUMN IF EXISTS embedding,
  DROP COLUMN IF EXISTS embedding_status,
  DROP COLUMN IF EXISTS search_vector;
