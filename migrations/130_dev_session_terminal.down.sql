-- ============================================================
-- Down migration 130: Drop dev_session_terminal junction table
-- Issue #1988 — Orchestrate terminal sessions from dev sessions
-- ============================================================

DROP INDEX IF EXISTS idx_dev_session_terminal_terminal;
DROP TABLE IF EXISTS dev_session_terminal;
