-- ============================================================
-- Migration 130: Dev session terminal junction table
-- Issue #1988 — Orchestrate terminal sessions from dev sessions
-- ============================================================
-- Many-to-many link between dev_session and terminal_session.
-- Allows a dev session to track one or more terminal sessions,
-- and a terminal session to be shared across dev sessions.

CREATE TABLE IF NOT EXISTS dev_session_terminal (
  dev_session_id       uuid NOT NULL REFERENCES dev_session(id) ON DELETE CASCADE,
  terminal_session_id  uuid NOT NULL REFERENCES terminal_session(id) ON DELETE CASCADE,
  linked_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (dev_session_id, terminal_session_id)
);

CREATE INDEX IF NOT EXISTS idx_dev_session_terminal_terminal
  ON dev_session_terminal(terminal_session_id);
