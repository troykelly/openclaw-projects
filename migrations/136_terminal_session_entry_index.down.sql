-- Issue #2191, Sub-item 3: Drop composite index on terminal_session_entry
DROP INDEX IF EXISTS idx_terminal_session_entry_session_seq;
