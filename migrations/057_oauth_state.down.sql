-- Migration 057 (down): Remove oauth_state table (issue #1046)

DROP INDEX IF EXISTS oauth_state_expires_at_idx;
DROP TABLE IF EXISTS oauth_state;
