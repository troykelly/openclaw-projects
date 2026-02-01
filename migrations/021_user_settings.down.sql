-- Drop user settings table and related objects

DROP TRIGGER IF EXISTS user_setting_updated_at ON user_setting;
DROP FUNCTION IF EXISTS update_user_setting_updated_at();
DROP INDEX IF EXISTS idx_user_setting_email;
DROP TABLE IF EXISTS user_setting;
