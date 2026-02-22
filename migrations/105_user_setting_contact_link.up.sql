-- ============================================================
-- Migration 105: Link user_setting to contact + login-eligible endpoints
-- Issue #1570 — Epic #1569: Identity Model & Contacts v2
-- Design: docs/plans/2026-02-22-identity-model-namespace-permissions.md §3.1
-- ============================================================

-- Add contact_id FK to user_setting (nullable — existing users keep working)
ALTER TABLE user_setting
  ADD COLUMN IF NOT EXISTS contact_id uuid REFERENCES contact(id) ON DELETE SET NULL;

-- Enforce 1:1: at most one human per contact
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_setting_contact_id
  ON user_setting(contact_id) WHERE contact_id IS NOT NULL;

-- Add is_login_eligible flag to contact_endpoint
-- Only endpoints explicitly marked login-eligible are used in the auth lookup.
-- Setting this is a privileged operation (human themselves or platform admin).
ALTER TABLE contact_endpoint
  ADD COLUMN IF NOT EXISTS is_login_eligible boolean NOT NULL DEFAULT false;

-- Index for auth lookup: find login-eligible email endpoints in default namespace
CREATE INDEX IF NOT EXISTS idx_contact_endpoint_login_lookup
  ON contact_endpoint(endpoint_type, normalized_value)
  WHERE is_login_eligible = true AND endpoint_type = 'email';

COMMENT ON COLUMN user_setting.contact_id IS 'FK to contact record representing this human. Must be in default namespace (enforced in application).';
COMMENT ON COLUMN contact_endpoint.is_login_eligible IS 'When true, this endpoint can be used for authentication. Privileged operation to set.';

-- ============================================================
-- Bootstrap: auto-link existing humans to contacts with matching
-- email endpoints in the default namespace
-- ============================================================
UPDATE user_setting us
SET contact_id = matched.contact_id
FROM (
  SELECT DISTINCT ON (ce.normalized_value)
    ce.normalized_value,
    c.id AS contact_id
  FROM contact_endpoint ce
  JOIN contact c ON c.id = ce.contact_id AND c.namespace = 'default'
  WHERE ce.endpoint_type = 'email'
  ORDER BY ce.normalized_value, c.updated_at DESC
) matched
WHERE lower(us.email) = matched.normalized_value
  AND us.contact_id IS NULL;

-- Mark the matching endpoints as login-eligible for linked users
UPDATE contact_endpoint ce
SET is_login_eligible = true
FROM user_setting us
JOIN contact c ON c.id = us.contact_id
WHERE ce.contact_id = c.id
  AND ce.endpoint_type = 'email'
  AND ce.normalized_value = lower(us.email)
  AND us.contact_id IS NOT NULL;
