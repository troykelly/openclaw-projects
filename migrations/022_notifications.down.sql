-- Migration 022: Notifications system (issue #181) - Rollback

DROP TRIGGER IF EXISTS notification_preference_updated_at ON notification_preference;
DROP FUNCTION IF EXISTS update_notification_preference_updated_at();
DROP TABLE IF EXISTS notification_preference;
DROP TABLE IF EXISTS notification;
DROP TYPE IF EXISTS notification_type;
