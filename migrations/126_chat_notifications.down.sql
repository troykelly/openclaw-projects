-- Reverse migration 126: Chat notification enhancements
DROP TABLE IF EXISTS notification_rate;
DROP TABLE IF EXISTS notification_dedup;
ALTER TABLE user_setting DROP COLUMN IF EXISTS push_subscriptions;
-- Note: Cannot remove enum value from notification_type in PostgreSQL
