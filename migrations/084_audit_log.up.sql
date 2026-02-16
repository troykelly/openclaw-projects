-- Migration 084: Audit log table for auth events
-- Issue #1339, Epic #1322 (JWT Auth)
--
-- Stores auth-related audit events (login attempts, token operations, security events).
-- Never stores raw tokens, secrets, or full email addresses — only masked/hashed forms.

CREATE TABLE IF NOT EXISTS audit_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type      text NOT NULL,
  actor_ip        text,
  actor_email_hash text,
  metadata        jsonb NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Index for querying by event type (e.g., all auth.refresh_reuse_detected events)
CREATE INDEX IF NOT EXISTS idx_audit_log_event_type
  ON audit_log (event_type);

-- Index for time-range queries (recent events, cleanup)
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at
  ON audit_log (created_at);

-- Index for per-actor queries (hashed email)
CREATE INDEX IF NOT EXISTS idx_audit_log_actor_email_hash
  ON audit_log (actor_email_hash)
  WHERE actor_email_hash IS NOT NULL;
