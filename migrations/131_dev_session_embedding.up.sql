-- Issue #1987: Add embedding column and search support to dev_session.
-- Enables semantic search across dev sessions using pgvector cosine similarity.

-- ── Step 1: Add embedding and search columns ──
ALTER TABLE dev_session
  ADD COLUMN IF NOT EXISTS embedding        vector(1024),
  ADD COLUMN IF NOT EXISTS embedding_status  text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS search_vector     tsvector;

-- ── Step 2: HNSW index for cosine similarity search ──
CREATE INDEX IF NOT EXISTS idx_dev_session_embedding_hnsw
  ON dev_session
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64)
  WHERE embedding IS NOT NULL;

-- ── Step 3: GIN index for full-text search ──
CREATE INDEX IF NOT EXISTS idx_dev_session_search_vector
  ON dev_session
  USING gin (search_vector)
  WHERE search_vector IS NOT NULL;

-- ── Step 4: Index on embedding_status for worker polling ──
CREATE INDEX IF NOT EXISTS idx_dev_session_embedding_status
  ON dev_session (embedding_status)
  WHERE embedding_status = 'pending';

-- ── Step 5: Trigger to keep search_vector up-to-date ──
CREATE OR REPLACE FUNCTION dev_session_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', COALESCE(NEW.session_name, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(NEW.task_summary, '')), 'B') ||
    setweight(to_tsvector('english', COALESCE(NEW.task_prompt, '')), 'C') ||
    setweight(to_tsvector('english', COALESCE(NEW.completion_summary, '')), 'B') ||
    setweight(to_tsvector('english', COALESCE(NEW.branch, '')), 'D') ||
    setweight(to_tsvector('english', COALESCE(NEW.repo_org, '') || ' ' || COALESCE(NEW.repo_name, '')), 'D');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_dev_session_search_vector ON dev_session;
CREATE TRIGGER trg_dev_session_search_vector
  BEFORE INSERT OR UPDATE OF session_name, task_summary, task_prompt, completion_summary, branch, repo_org, repo_name
  ON dev_session
  FOR EACH ROW EXECUTE FUNCTION dev_session_search_vector_update();

-- ── Step 6: Backfill search_vector for existing rows ──
UPDATE dev_session SET search_vector =
  setweight(to_tsvector('english', COALESCE(session_name, '')), 'A') ||
  setweight(to_tsvector('english', COALESCE(task_summary, '')), 'B') ||
  setweight(to_tsvector('english', COALESCE(task_prompt, '')), 'C') ||
  setweight(to_tsvector('english', COALESCE(completion_summary, '')), 'B') ||
  setweight(to_tsvector('english', COALESCE(branch, '')), 'D') ||
  setweight(to_tsvector('english', COALESCE(repo_org, '') || ' ' || COALESCE(repo_name, '')), 'D')
WHERE search_vector IS NULL;

-- ── Step 7: Mark existing rows for embedding ──
UPDATE dev_session SET embedding_status = 'pending'
WHERE embedding IS NULL AND (task_summary IS NOT NULL OR task_prompt IS NOT NULL OR completion_summary IS NOT NULL);
