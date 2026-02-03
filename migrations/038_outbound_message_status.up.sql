-- Issue #290: Add outbound message queue infrastructure and status tracking
-- Part of Epic #289 (Unified Communications Platform)

-- Create enum for message delivery status
-- Values align with Twilio/Postmark terminology where possible
DO $$ BEGIN
  CREATE TYPE message_delivery_status AS ENUM (
    'pending',      -- Created, not yet queued for sending
    'queued',       -- In the send queue, awaiting processing
    'sending',      -- Currently being sent to provider
    'sent',         -- Provider accepted the message
    'delivered',    -- Provider confirmed delivery (terminal success)
    'failed',       -- Permanent failure (terminal)
    'bounced',      -- Email bounced (terminal)
    'undelivered'   -- Provider could not deliver (terminal)
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Add new columns to external_message for delivery tracking
ALTER TABLE external_message
  ADD COLUMN IF NOT EXISTS delivery_status message_delivery_status,
  ADD COLUMN IF NOT EXISTS provider_message_id text,
  ADD COLUMN IF NOT EXISTS provider_status_raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS status_updated_at timestamptz;

-- Set default for delivery_status on outbound messages
-- Inbound messages don't need delivery status tracking
UPDATE external_message
   SET delivery_status = 'delivered',
       status_updated_at = received_at
 WHERE direction = 'inbound' AND delivery_status IS NULL;

UPDATE external_message
   SET delivery_status = 'pending',
       status_updated_at = created_at
 WHERE direction = 'outbound' AND delivery_status IS NULL;

-- Now set defaults for future inserts based on direction
-- We'll use a trigger since DEFAULT can't reference other columns
CREATE OR REPLACE FUNCTION external_message_set_defaults()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Set delivery_status based on direction if not provided
  IF NEW.delivery_status IS NULL THEN
    IF NEW.direction = 'outbound' THEN
      NEW.delivery_status := 'pending';
    ELSE
      NEW.delivery_status := 'delivered';
    END IF;
  END IF;

  -- Set status_updated_at if not provided
  IF NEW.status_updated_at IS NULL THEN
    NEW.status_updated_at := COALESCE(NEW.received_at, now());
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_external_message_set_defaults ON external_message;
CREATE TRIGGER trg_external_message_set_defaults
BEFORE INSERT ON external_message
FOR EACH ROW
EXECUTE FUNCTION external_message_set_defaults();

-- Define valid status transitions
-- Terminal states: delivered, failed, bounced, undelivered
-- Non-terminal states: pending, queued, sending, sent
CREATE OR REPLACE FUNCTION external_message_validate_status_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  terminal_states message_delivery_status[] := ARRAY['delivered', 'failed', 'bounced', 'undelivered']::message_delivery_status[];
  old_ordinal int;
  new_ordinal int;
BEGIN
  -- Skip if status unchanged or this is an insert
  IF OLD.delivery_status = NEW.delivery_status THEN
    RETURN NEW;
  END IF;

  -- Prevent any transition FROM terminal states
  IF OLD.delivery_status = ANY(terminal_states) THEN
    RAISE EXCEPTION 'Cannot transition from terminal status: %', OLD.delivery_status
      USING ERRCODE = 'check_violation';
  END IF;

  -- Allow transitions TO terminal states (failed, bounced, undelivered) from any non-terminal
  IF NEW.delivery_status = ANY(terminal_states) THEN
    NEW.status_updated_at := now();
    RETURN NEW;
  END IF;

  -- For non-terminal states, enforce forward-only progression
  -- Order: pending(1) -> queued(2) -> sending(3) -> sent(4) -> delivered(5)
  old_ordinal := CASE OLD.delivery_status
    WHEN 'pending' THEN 1
    WHEN 'queued' THEN 2
    WHEN 'sending' THEN 3
    WHEN 'sent' THEN 4
    WHEN 'delivered' THEN 5
    ELSE 0
  END;

  new_ordinal := CASE NEW.delivery_status
    WHEN 'pending' THEN 1
    WHEN 'queued' THEN 2
    WHEN 'sending' THEN 3
    WHEN 'sent' THEN 4
    WHEN 'delivered' THEN 5
    ELSE 0
  END;

  IF new_ordinal <= old_ordinal THEN
    RAISE EXCEPTION 'Invalid status transition: % -> % (cannot go backwards)',
      OLD.delivery_status, NEW.delivery_status
      USING ERRCODE = 'check_violation';
  END IF;

  -- Update timestamp on valid transition
  NEW.status_updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_external_message_validate_status ON external_message;
CREATE TRIGGER trg_external_message_validate_status
BEFORE UPDATE OF delivery_status ON external_message
FOR EACH ROW
EXECUTE FUNCTION external_message_validate_status_transition();

-- Add index on delivery_status for monitoring dashboards
-- Partial index on non-terminal states for queue processing efficiency
CREATE INDEX IF NOT EXISTS external_message_delivery_status_idx
  ON external_message (delivery_status)
  WHERE delivery_status IN ('pending', 'queued', 'sending', 'sent');

-- Add index for looking up messages by provider ID (for webhook processing)
CREATE INDEX IF NOT EXISTS external_message_provider_message_id_idx
  ON external_message (provider_message_id)
  WHERE provider_message_id IS NOT NULL;

-- Comment on new columns
COMMENT ON COLUMN external_message.delivery_status IS 'Delivery status for outbound messages (pending -> queued -> sending -> sent -> delivered/failed)';
COMMENT ON COLUMN external_message.provider_message_id IS 'Provider-specific message ID (Twilio MessageSid, Postmark MessageID)';
COMMENT ON COLUMN external_message.provider_status_raw IS 'Raw status webhook payload from provider';
COMMENT ON COLUMN external_message.status_updated_at IS 'Timestamp of last delivery_status change';
