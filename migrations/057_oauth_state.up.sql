-- Migration 057: Database-backed PKCE state storage (issue #1046)
--
-- Replaces the in-memory Map used to store OAuth PKCE state with a
-- persistent database table.  States are single-use and expire after
-- 10 minutes by default.

CREATE TABLE IF NOT EXISTS oauth_state (
  state         text           PRIMARY KEY,
  provider      oauth_provider NOT NULL,
  code_verifier text           NOT NULL,
  scopes        text[]         NOT NULL DEFAULT '{}',
  user_email    text,
  redirect_path text,
  created_at    timestamptz    NOT NULL DEFAULT now(),
  expires_at    timestamptz    NOT NULL DEFAULT (now() + interval '10 minutes')
);

CREATE INDEX IF NOT EXISTS oauth_state_expires_at_idx ON oauth_state(expires_at);

COMMENT ON TABLE  oauth_state IS 'Short-lived PKCE state for in-flight OAuth authorization flows';
COMMENT ON COLUMN oauth_state.state IS 'Cryptographic random token sent as the OAuth state parameter';
COMMENT ON COLUMN oauth_state.code_verifier IS 'PKCE code verifier; paired with the code_challenge sent to the provider';
COMMENT ON COLUMN oauth_state.scopes IS 'OAuth scopes requested in this flow';
COMMENT ON COLUMN oauth_state.user_email IS 'Authenticated user email (if known at flow start)';
COMMENT ON COLUMN oauth_state.redirect_path IS 'Frontend path to redirect to after callback completes';
COMMENT ON COLUMN oauth_state.expires_at IS 'Expiry timestamp; states past this time are invalid and can be pruned';
