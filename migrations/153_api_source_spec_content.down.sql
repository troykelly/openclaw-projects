-- Revert spec_content column from api_source.
ALTER TABLE api_source DROP COLUMN IF EXISTS spec_content;
