-- Add spec_content column to api_source to store inline spec content.
-- Allows refreshing API sources that were onboarded via spec_content (no spec_url).
-- Issue #2277.

ALTER TABLE api_source ADD COLUMN IF NOT EXISTS spec_content text;
