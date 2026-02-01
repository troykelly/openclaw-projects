-- User settings/preferences table
-- Stores per-user preferences that persist across sessions

CREATE TABLE IF NOT EXISTS user_setting (
  id uuid PRIMARY KEY DEFAULT new_uuid(),
  email text NOT NULL UNIQUE,  -- Links to auth_session.email

  -- Theme preference
  theme text NOT NULL DEFAULT 'system' CHECK (theme IN ('light', 'dark', 'system')),

  -- Default view preferences
  default_view text NOT NULL DEFAULT 'activity' CHECK (default_view IN ('activity', 'projects', 'timeline', 'contacts')),
  default_project_id uuid REFERENCES work_item(id) ON DELETE SET NULL,

  -- Display preferences
  sidebar_collapsed boolean NOT NULL DEFAULT false,
  show_completed_items boolean NOT NULL DEFAULT true,
  items_per_page integer NOT NULL DEFAULT 50 CHECK (items_per_page BETWEEN 10 AND 100),

  -- Notification preferences (for future use)
  email_notifications boolean NOT NULL DEFAULT true,
  email_digest_frequency text NOT NULL DEFAULT 'daily' CHECK (email_digest_frequency IN ('never', 'daily', 'weekly')),

  -- Timezone (for displaying dates)
  timezone text NOT NULL DEFAULT 'UTC',

  -- Timestamps
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Index for quick lookup by email
CREATE INDEX IF NOT EXISTS idx_user_setting_email ON user_setting(email);

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_user_setting_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER user_setting_updated_at
  BEFORE UPDATE ON user_setting
  FOR EACH ROW
  EXECUTE FUNCTION update_user_setting_updated_at();
