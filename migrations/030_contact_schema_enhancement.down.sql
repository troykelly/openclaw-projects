-- Issue #208: Rollback contact schema enhancement

-- Drop triggers
DROP TRIGGER IF EXISTS external_message_update_contact_last_contact ON external_message;
DROP TRIGGER IF EXISTS contact_external_identity_update_contact ON contact_external_identity;

-- Drop functions
DROP FUNCTION IF EXISTS update_contact_last_contact_date();
DROP FUNCTION IF EXISTS update_contact_on_identity_change();

-- Drop external identity table
DROP TABLE IF EXISTS contact_external_identity;

-- Drop columns from contact table
ALTER TABLE contact
  DROP COLUMN IF EXISTS organization,
  DROP COLUMN IF EXISTS job_title,
  DROP COLUMN IF EXISTS timezone,
  DROP COLUMN IF EXISTS birthday,
  DROP COLUMN IF EXISTS photo_url,
  DROP COLUMN IF EXISTS preferred_endpoint_id,
  DROP COLUMN IF EXISTS pronouns,
  DROP COLUMN IF EXISTS language,
  DROP COLUMN IF EXISTS relationship_type,
  DROP COLUMN IF EXISTS relationship_notes,
  DROP COLUMN IF EXISTS first_contact_date,
  DROP COLUMN IF EXISTS last_contact_date;

-- Drop index (automatically dropped with column)
DROP INDEX IF EXISTS idx_contact_last_contact_date;
