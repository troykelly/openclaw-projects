-- Rollback Issue #290: Outbound message queue infrastructure

-- Drop indexes
DROP INDEX IF EXISTS external_message_provider_message_id_idx;
DROP INDEX IF EXISTS external_message_delivery_status_idx;

-- Drop triggers
DROP TRIGGER IF EXISTS trg_external_message_validate_status ON external_message;
DROP TRIGGER IF EXISTS trg_external_message_set_defaults ON external_message;

-- Drop functions
DROP FUNCTION IF EXISTS external_message_validate_status_transition();
DROP FUNCTION IF EXISTS external_message_set_defaults();

-- Remove columns
ALTER TABLE external_message
  DROP COLUMN IF EXISTS status_updated_at,
  DROP COLUMN IF EXISTS provider_status_raw,
  DROP COLUMN IF EXISTS provider_message_id,
  DROP COLUMN IF EXISTS delivery_status;

-- Drop enum type
DROP TYPE IF EXISTS message_delivery_status;
