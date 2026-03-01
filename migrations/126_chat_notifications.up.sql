-- Migration 126: Chat notification enhancements (Issue #1954, #1955, #1956)
-- Adds agent_message notification type, push subscription, notification dedup tracking
-- Part of Epic #1940 (Agent Chat)

-- ── Extend notification_type enum ─────────────────────────────────
DO $$ BEGIN
  ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'agent_message';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ── Push subscription storage ─────────────────────────────────────
ALTER TABLE user_setting ADD COLUMN IF NOT EXISTS push_subscriptions jsonb NOT NULL DEFAULT '[]';

-- Size constraint: max 8KB for push subscriptions array
DO $$ BEGIN
  ALTER TABLE user_setting ADD CONSTRAINT chk_user_setting_push_subscriptions
    CHECK (pg_column_size(push_subscriptions) <= 8192);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ── Notification dedup tracking ───────────────────────────────────
-- Tracks (user_email, reason_key) to prevent duplicate notifications
-- within a 15-minute window.
CREATE TABLE IF NOT EXISTS notification_dedup (
  id uuid PRIMARY KEY DEFAULT new_uuid(),
  user_email text NOT NULL,
  reason_key text NOT NULL CHECK (length(reason_key) <= 100),
  notification_id uuid REFERENCES notification(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_email, reason_key, created_at)
);

CREATE INDEX IF NOT EXISTS idx_notification_dedup_lookup
  ON notification_dedup(user_email, reason_key, created_at DESC);

-- ── Notification rate tracking ────────────────────────────────────
-- Tracks escalation channel usage for rate limiting
CREATE TABLE IF NOT EXISTS notification_rate (
  id uuid PRIMARY KEY DEFAULT new_uuid(),
  user_email text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('sms', 'email', 'push')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notification_rate_lookup
  ON notification_rate(user_email, channel, created_at DESC);
