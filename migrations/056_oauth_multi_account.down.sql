-- Migration 056: Multi-account OAuth — Rollback (issue #1044)
--
-- Reverts to single-connection-per-provider schema.
-- WARNING: If multiple connections exist per user+provider, this will fail
-- due to the re-added unique constraint. Manual data cleanup needed first.

-- 1. Drop new indexes
DROP INDEX IF EXISTS oauth_connection_is_active_idx;
DROP INDEX IF EXISTS oauth_connection_provider_account_email_idx;
DROP INDEX IF EXISTS oauth_connection_label_idx;

-- 2. Drop the multi-account unique index
DROP INDEX IF EXISTS oauth_connection_user_provider_account_key;

-- 3. Remove new columns
ALTER TABLE oauth_connection
  DROP COLUMN IF EXISTS sync_status,
  DROP COLUMN IF EXISTS last_sync_at,
  DROP COLUMN IF EXISTS is_active,
  DROP COLUMN IF EXISTS enabled_features,
  DROP COLUMN IF EXISTS permission_level,
  DROP COLUMN IF EXISTS provider_account_email,
  DROP COLUMN IF EXISTS provider_account_id,
  DROP COLUMN IF EXISTS label;

-- 4. Restore original unique constraint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'oauth_connection_user_email_provider_key'
  ) THEN
    ALTER TABLE oauth_connection
      ADD CONSTRAINT oauth_connection_user_email_provider_key
      UNIQUE (user_email, provider);
  END IF;
END $$;

-- 5. Drop the permission level enum
DROP TYPE IF EXISTS oauth_permission_level;
