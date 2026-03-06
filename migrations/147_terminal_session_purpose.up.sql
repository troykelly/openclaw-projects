-- ============================================================
-- Migration 147: Add purpose column to terminal_session
-- Issue #2193 — Dev Session & Terminal Session Schema Migrations
--
-- Distinguishes interactive (user-created) from orchestrated
-- (Symphony-created) terminal sessions.
-- ============================================================

ALTER TABLE terminal_session
  ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'interactive'
    CHECK (purpose IN ('interactive', 'orchestrated'));

CREATE INDEX IF NOT EXISTS idx_terminal_session_purpose
  ON terminal_session(purpose);

COMMENT ON COLUMN terminal_session.purpose IS
  'Issue #2193: Session purpose — interactive (user) or orchestrated (Symphony).';
