-- Issue #1269: Rollback contact communication preferences
ALTER TABLE contact DROP COLUMN IF EXISTS preferred_channel;
ALTER TABLE contact DROP COLUMN IF EXISTS quiet_hours_start;
ALTER TABLE contact DROP COLUMN IF EXISTS quiet_hours_end;
ALTER TABLE contact DROP COLUMN IF EXISTS quiet_hours_timezone;
ALTER TABLE contact DROP COLUMN IF EXISTS urgency_override_channel;
ALTER TABLE contact DROP COLUMN IF EXISTS notification_notes;

DROP TYPE IF EXISTS contact_channel;
