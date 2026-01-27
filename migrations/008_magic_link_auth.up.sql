-- Issue #19: magic-link auth (15m) + 7d session cookies

CREATE TABLE IF NOT EXISTS auth_magic_link (
  id uuid PRIMARY KEY DEFAULT new_uuid(),
  email text NOT NULL CHECK (position('@' in email) > 1),
  token_sha256 text NOT NULL CHECK (length(token_sha256) = 64),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  CONSTRAINT auth_magic_link_token_unique UNIQUE (token_sha256)
);

CREATE INDEX IF NOT EXISTS auth_magic_link_email_idx ON auth_magic_link(email);
CREATE INDEX IF NOT EXISTS auth_magic_link_expires_at_idx ON auth_magic_link(expires_at);

CREATE TABLE IF NOT EXISTS auth_session (
  id uuid PRIMARY KEY DEFAULT new_uuid(),
  email text NOT NULL CHECK (position('@' in email) > 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS auth_session_email_idx ON auth_session(email);
CREATE INDEX IF NOT EXISTS auth_session_expires_at_idx ON auth_session(expires_at);
