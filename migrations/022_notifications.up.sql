-- Migration 022: Notifications system (issue #181)
-- Creates notification and notification_preference tables

-- Notification types enum
DO $$ BEGIN
  CREATE TYPE notification_type AS ENUM (
    'assigned',
    'mentioned',
    'status_change',
    'unblocked',
    'due_soon',
    'comment'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Notifications table
CREATE TABLE IF NOT EXISTS notification (
  id uuid PRIMARY KEY DEFAULT new_uuid(),
  user_email text NOT NULL,
  notification_type notification_type NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  work_item_id uuid REFERENCES work_item(id) ON DELETE CASCADE,
  actor_email text,
  metadata jsonb NOT NULL DEFAULT '{}',
  read_at timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS notification_user_email_idx ON notification(user_email);
CREATE INDEX IF NOT EXISTS notification_user_unread_idx ON notification(user_email, created_at DESC) WHERE read_at IS NULL AND dismissed_at IS NULL;
CREATE INDEX IF NOT EXISTS notification_created_at_idx ON notification(created_at DESC);
CREATE INDEX IF NOT EXISTS notification_work_item_id_idx ON notification(work_item_id);

-- Notification preferences table
CREATE TABLE IF NOT EXISTS notification_preference (
  id uuid PRIMARY KEY DEFAULT new_uuid(),
  user_email text NOT NULL,
  notification_type notification_type NOT NULL,
  in_app_enabled boolean NOT NULL DEFAULT true,
  email_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_email, notification_type)
);

-- Index for quick lookup by user
CREATE INDEX IF NOT EXISTS notification_preference_user_email_idx ON notification_preference(user_email);

-- Trigger to update updated_at for notification_preference
CREATE OR REPLACE FUNCTION update_notification_preference_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER notification_preference_updated_at
  BEFORE UPDATE ON notification_preference
  FOR EACH ROW
  EXECUTE FUNCTION update_notification_preference_updated_at();

COMMENT ON TABLE notification IS 'User notifications for important events';
COMMENT ON TABLE notification_preference IS 'Per-user notification preferences by type';
