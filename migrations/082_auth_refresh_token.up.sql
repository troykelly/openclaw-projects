-- Migration 082: Auth refresh token storage with family-based rotation
-- Issue #1324, Epic #1322 (JWT Auth)
--
-- Stores hashed refresh tokens with token family tracking for rotation
-- and reuse detection. Raw tokens are never persisted — only SHA-256 hashes.

CREATE TABLE IF NOT EXISTS auth_refresh_token (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_sha256    text NOT NULL UNIQUE,
  email           text NOT NULL,
  family_id       uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  revoked_at      timestamptz,
  replaced_by     uuid REFERENCES auth_refresh_token(id),
  grace_expires_at timestamptz
);

-- Look up all tokens for a given user (e.g., revoke-all-sessions)
CREATE INDEX IF NOT EXISTS idx_auth_refresh_token_email
  ON auth_refresh_token (email);

-- Family-based operations (revoke family on reuse detection)
CREATE INDEX IF NOT EXISTS idx_auth_refresh_token_family_id
  ON auth_refresh_token (family_id);

-- Cleanup of expired tokens
CREATE INDEX IF NOT EXISTS idx_auth_refresh_token_expires_at
  ON auth_refresh_token (expires_at)
  WHERE revoked_at IS NULL;
