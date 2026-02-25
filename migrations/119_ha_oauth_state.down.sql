-- Note: ALTER TYPE ... DROP VALUE is not supported in PostgreSQL.
-- We can only remove the added columns.
ALTER TABLE oauth_state DROP COLUMN IF EXISTS instance_url;
ALTER TABLE oauth_state DROP COLUMN IF EXISTS geo_provider_id;
ALTER TABLE oauth_state ALTER COLUMN code_verifier SET NOT NULL;
