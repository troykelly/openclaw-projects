-- Issue #1337: Restore auth_session table for rollback

CREATE TABLE IF NOT EXISTS auth_session (
  id uuid PRIMARY KEY DEFAULT new_uuid(),
  email text NOT NULL CHECK (position('@' in email) > 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS auth_session_email_idx ON auth_session(email);
CREATE INDEX IF NOT EXISTS auth_session_expires_at_idx ON auth_session(expires_at);
