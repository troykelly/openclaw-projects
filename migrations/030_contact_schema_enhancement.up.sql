-- Issue #208: Enhance contact schema for OpenClaw agent context

-- Add new metadata columns to contact table
ALTER TABLE contact
  ADD COLUMN IF NOT EXISTS organization text,
  ADD COLUMN IF NOT EXISTS job_title text,
  ADD COLUMN IF NOT EXISTS timezone text,
  ADD COLUMN IF NOT EXISTS birthday date,
  ADD COLUMN IF NOT EXISTS photo_url text,
  ADD COLUMN IF NOT EXISTS preferred_endpoint_id uuid REFERENCES contact_endpoint(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pronouns text,
  ADD COLUMN IF NOT EXISTS language text DEFAULT 'en',
  ADD COLUMN IF NOT EXISTS relationship_type text,
  ADD COLUMN IF NOT EXISTS relationship_notes text,
  ADD COLUMN IF NOT EXISTS first_contact_date timestamptz,
  ADD COLUMN IF NOT EXISTS last_contact_date timestamptz;

-- Create index for last_contact_date queries
CREATE INDEX IF NOT EXISTS idx_contact_last_contact_date ON contact(last_contact_date);

-- Create external identity linking table
CREATE TABLE IF NOT EXISTS contact_external_identity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL REFERENCES contact(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('microsoft', 'google', 'linkedin', 'github')),
  external_id text NOT NULL,
  sync_status text NOT NULL DEFAULT 'pending' CHECK (sync_status IN ('pending', 'synced', 'error')),
  synced_at timestamptz,
  sync_cursor text,
  sync_error text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- Unique per provider-contact and per provider-external_id
  CONSTRAINT contact_external_identity_unique UNIQUE (contact_id, provider),
  CONSTRAINT contact_external_identity_provider_id UNIQUE (provider, external_id)
);

CREATE INDEX IF NOT EXISTS idx_contact_external_identity_contact_id ON contact_external_identity(contact_id);
CREATE INDEX IF NOT EXISTS idx_contact_external_identity_provider ON contact_external_identity(provider);
CREATE INDEX IF NOT EXISTS idx_contact_external_identity_sync_status ON contact_external_identity(sync_status);

-- Trigger to update contact's updated_at when external identity changes
CREATE OR REPLACE FUNCTION update_contact_on_identity_change()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE contact SET updated_at = now() WHERE id = NEW.contact_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER contact_external_identity_update_contact
  AFTER INSERT OR UPDATE ON contact_external_identity
  FOR EACH ROW
  EXECUTE FUNCTION update_contact_on_identity_change();

-- Function to auto-update last_contact_date when messages arrive
CREATE OR REPLACE FUNCTION update_contact_last_contact_date()
RETURNS TRIGGER AS $$
BEGIN
  -- Update the contact's last_contact_date via the thread's endpoint
  UPDATE contact c
  SET last_contact_date = GREATEST(COALESCE(c.last_contact_date, '1970-01-01'::timestamptz), NEW.received_at),
      updated_at = now()
  FROM external_thread et
  JOIN contact_endpoint ce ON ce.id = et.endpoint_id
  WHERE et.id = NEW.thread_id
    AND ce.contact_id = c.id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update last_contact_date on new messages
DROP TRIGGER IF EXISTS external_message_update_contact_last_contact ON external_message;
CREATE TRIGGER external_message_update_contact_last_contact
  AFTER INSERT ON external_message
  FOR EACH ROW
  EXECUTE FUNCTION update_contact_last_contact_date();

-- Comments
COMMENT ON COLUMN contact.organization IS 'Company or organization the contact belongs to';
COMMENT ON COLUMN contact.job_title IS 'Job title or role';
COMMENT ON COLUMN contact.timezone IS 'IANA timezone name (e.g., America/New_York)';
COMMENT ON COLUMN contact.preferred_endpoint_id IS 'Preferred communication endpoint';
COMMENT ON COLUMN contact.relationship_type IS 'How user knows this contact (friend, family, colleague, client, vendor)';
COMMENT ON COLUMN contact.last_contact_date IS 'Auto-updated when messages are received';

COMMENT ON TABLE contact_external_identity IS 'Links contacts to external identity providers (M365, Google, etc.)';
