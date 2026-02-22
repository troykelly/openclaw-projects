-- ============================================================
-- Down migration 105: Remove user_setting contact link + login-eligible
-- ============================================================

-- Remove login-eligible flag from contact_endpoint
DROP INDEX IF EXISTS idx_contact_endpoint_login_lookup;
ALTER TABLE contact_endpoint DROP COLUMN IF EXISTS is_login_eligible;

-- Remove contact_id from user_setting
DROP INDEX IF EXISTS idx_user_setting_contact_id;
ALTER TABLE user_setting DROP COLUMN IF EXISTS contact_id;
