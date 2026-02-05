-- Migration 049: File Share Schema (Rollback)
-- Part of Epic #574, Issue #584

DROP FUNCTION IF EXISTS cleanup_expired_file_shares();
DROP FUNCTION IF EXISTS validate_file_share_token(text, boolean);
DROP TABLE IF EXISTS file_share;
