-- Issue #2191, Sub-item 3: Composite index on terminal_session_entry
-- Optimises ordered entry retrieval by session (the primary query pattern
-- for terminal replay and scrollback).
-- Note: Not using CONCURRENTLY because the migration runner wraps SQL
-- in a transaction block. For large tables, consider running this index
-- creation manually with CONCURRENTLY outside the migration.
CREATE INDEX IF NOT EXISTS idx_terminal_session_entry_session_seq
  ON terminal_session_entry (session_id, sequence);
