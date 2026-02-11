-- Migration 056: Multi-account OAuth with labels and granular permissions (issue #1044)
--
-- Transforms oauth_connection from single-connection-per-provider to multi-account
-- with user-defined labels, granular permission levels, and per-feature sync tracking.

-- 1. Create permission level enum
DO $$ BEGIN
  CREATE TYPE oauth_permission_level AS ENUM ('read', 'read_write');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 2. Drop the old unique constraint (user_email, provider)
--    The constraint name may vary; find and drop it dynamically.
DO $$ BEGIN
  ALTER TABLE oauth_connection
    DROP CONSTRAINT IF EXISTS oauth_connection_user_email_provider_key;
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;

-- 3. Add new columns with defaults to preserve existing rows
ALTER TABLE oauth_connection
  ADD COLUMN IF NOT EXISTS label text NOT NULL DEFAULT 'Default',
  ADD COLUMN IF NOT EXISTS provider_account_id text,
  ADD COLUMN IF NOT EXISTS provider_account_email text,
  ADD COLUMN IF NOT EXISTS permission_level oauth_permission_level NOT NULL DEFAULT 'read',
  ADD COLUMN IF NOT EXISTS enabled_features text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS last_sync_at timestamptz,
  ADD COLUMN IF NOT EXISTS sync_status jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 4. Add unique index for one connection per provider account per user.
--    Uses COALESCE so NULL provider_account_email values are treated as equal
--    (PostgreSQL UNIQUE constraints treat NULLs as distinct, which would allow
--    duplicate legacy rows). This also enables ON CONFLICT to match NULL rows.
CREATE UNIQUE INDEX IF NOT EXISTS oauth_connection_user_provider_account_key
  ON oauth_connection (user_email, provider, COALESCE(provider_account_email, ''));

-- 5. Add indexes for common query patterns
CREATE INDEX IF NOT EXISTS oauth_connection_label_idx
  ON oauth_connection(label);

CREATE INDEX IF NOT EXISTS oauth_connection_provider_account_email_idx
  ON oauth_connection(provider_account_email);

CREATE INDEX IF NOT EXISTS oauth_connection_is_active_idx
  ON oauth_connection(is_active);

-- 6. Add column comments
COMMENT ON COLUMN oauth_connection.label IS 'User-defined name for this connection (e.g. "Work Gmail", "Personal Outlook")';
COMMENT ON COLUMN oauth_connection.provider_account_id IS 'Provider-side unique account identifier';
COMMENT ON COLUMN oauth_connection.provider_account_email IS 'Email address of the connected provider account';
COMMENT ON COLUMN oauth_connection.permission_level IS 'User-chosen access level: read-only or read-write';
COMMENT ON COLUMN oauth_connection.enabled_features IS 'Active feature flags: contacts, email, files, calendar';
COMMENT ON COLUMN oauth_connection.is_active IS 'Soft disable toggle — false disables sync without disconnecting';
COMMENT ON COLUMN oauth_connection.last_sync_at IS 'Timestamp of last completed sync of any type';
COMMENT ON COLUMN oauth_connection.sync_status IS 'Per-feature sync tracking: { "contacts": { "last_sync": ..., "cursor": ... }, ... }';
