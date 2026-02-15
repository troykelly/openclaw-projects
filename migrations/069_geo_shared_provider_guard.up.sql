-- Migration 069: Guard shared geo providers from cascade deletion
-- Issue #1259
-- Changes geo_provider.owner_email FK from ON DELETE CASCADE to ON DELETE RESTRICT
-- to prevent accidental deletion of shared providers when the owner user is removed.

-- 1. Drop the existing CASCADE foreign key on owner_email
ALTER TABLE geo_provider
  DROP CONSTRAINT IF EXISTS geo_provider_owner_email_fkey;

-- 2. Re-add with ON DELETE RESTRICT so deleting a user_setting row fails
--    if they still own any geo providers.
ALTER TABLE geo_provider
  ADD CONSTRAINT geo_provider_owner_email_fkey
    FOREIGN KEY (owner_email) REFERENCES user_setting(email) ON DELETE RESTRICT;
