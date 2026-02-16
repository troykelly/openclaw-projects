-- Migration 083: One-time authorization codes for OAuth exchange
-- Issue #1325, Epic #1322 (JWT Auth)
--
-- After OAuth callback, the API generates a one-time code and redirects
-- to the SPA. The SPA exchanges the code for a JWT via POST /api/auth/exchange.
-- Codes are short-lived (60s TTL) and single-use.

CREATE TABLE IF NOT EXISTS auth_one_time_code (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_sha256 text NOT NULL UNIQUE,
  email       text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz
);

-- Cleanup of expired codes
CREATE INDEX IF NOT EXISTS idx_auth_one_time_code_expires_at
  ON auth_one_time_code (expires_at)
  WHERE used_at IS NULL;
