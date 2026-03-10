-- Down migration 160: Remove active_namespaces column from user_setting
-- Issue #2348 — Epic #2345

DROP INDEX IF EXISTS idx_user_setting_active_namespaces;
ALTER TABLE user_setting DROP COLUMN IF EXISTS active_namespaces;
