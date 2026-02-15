-- Issue #1269: Contact communication preferences and quiet hours
--
-- Add structured communication preference fields so agents can respect
-- per-contact channel preferences, quiet hours, and urgency overrides.

-- Enum for communication channel preferences
DO $$ BEGIN
  CREATE TYPE contact_channel AS ENUM ('telegram', 'email', 'sms', 'voice');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Add preference columns to contact table
ALTER TABLE contact ADD COLUMN IF NOT EXISTS preferred_channel contact_channel;
ALTER TABLE contact ADD COLUMN IF NOT EXISTS quiet_hours_start TIME;
ALTER TABLE contact ADD COLUMN IF NOT EXISTS quiet_hours_end TIME;
ALTER TABLE contact ADD COLUMN IF NOT EXISTS quiet_hours_timezone TEXT;
ALTER TABLE contact ADD COLUMN IF NOT EXISTS urgency_override_channel contact_channel;
ALTER TABLE contact ADD COLUMN IF NOT EXISTS notification_notes TEXT;

COMMENT ON COLUMN contact.preferred_channel IS 'Default communication channel: telegram, email, sms, or voice';
COMMENT ON COLUMN contact.quiet_hours_start IS 'Start of quiet hours (e.g. 23:00)';
COMMENT ON COLUMN contact.quiet_hours_end IS 'End of quiet hours (e.g. 08:00)';
COMMENT ON COLUMN contact.quiet_hours_timezone IS 'IANA timezone for quiet hours (e.g. Australia/Sydney)';
COMMENT ON COLUMN contact.urgency_override_channel IS 'Channel for urgent comms during quiet hours';
COMMENT ON COLUMN contact.notification_notes IS 'Free-text communication preferences (e.g. prefers voice for bad news)';
