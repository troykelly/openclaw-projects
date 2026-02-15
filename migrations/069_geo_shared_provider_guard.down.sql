-- Revert migration 069: Restore CASCADE deletion on geo_provider.owner_email
-- Issue #1259

ALTER TABLE geo_provider
  DROP CONSTRAINT IF EXISTS geo_provider_owner_email_fkey;

ALTER TABLE geo_provider
  ADD CONSTRAINT geo_provider_owner_email_fkey
    FOREIGN KEY (owner_email) REFERENCES user_setting(email) ON DELETE CASCADE;
