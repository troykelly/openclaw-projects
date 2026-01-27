-- Issue #10: inbound external messages -> threads/work items

-- Add a task_type for communication-driven work
DO $$ BEGIN
  ALTER TYPE work_item_task_type ADD VALUE IF NOT EXISTS 'communication';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE message_direction AS ENUM ('inbound', 'outbound');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE communication_action AS ENUM ('reply_required', 'follow_up');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS external_thread (
  id uuid PRIMARY KEY DEFAULT new_uuid(),
  endpoint_id uuid NOT NULL REFERENCES contact_endpoint(id) ON DELETE CASCADE,
  channel contact_endpoint_type NOT NULL,
  external_thread_key text NOT NULL CHECK (length(trim(external_thread_key)) > 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT external_thread_key_unique UNIQUE (channel, external_thread_key)
);

CREATE INDEX IF NOT EXISTS external_thread_endpoint_idx ON external_thread(endpoint_id);

CREATE TABLE IF NOT EXISTS external_message (
  id uuid PRIMARY KEY DEFAULT new_uuid(),
  thread_id uuid NOT NULL REFERENCES external_thread(id) ON DELETE CASCADE,
  external_message_key text NOT NULL CHECK (length(trim(external_message_key)) > 0),
  direction message_direction NOT NULL,
  body text,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  received_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT external_message_key_unique UNIQUE (thread_id, external_message_key)
);

CREATE INDEX IF NOT EXISTS external_message_thread_idx ON external_message(thread_id);
CREATE INDEX IF NOT EXISTS external_message_received_at_idx ON external_message(received_at);

-- Subtype table: a work item that represents an actionable communication
CREATE TABLE IF NOT EXISTS work_item_communication (
  work_item_id uuid PRIMARY KEY REFERENCES work_item(id) ON DELETE CASCADE,
  thread_id uuid NOT NULL REFERENCES external_thread(id) ON DELETE RESTRICT,
  message_id uuid REFERENCES external_message(id) ON DELETE SET NULL,
  action communication_action NOT NULL DEFAULT 'reply_required',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS work_item_communication_thread_idx ON work_item_communication(thread_id);

CREATE OR REPLACE FUNCTION work_item_communication_enforce_type()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Ensure the parent work item is marked as a communication task.
  UPDATE work_item
    SET task_type = 'communication'
  WHERE id = NEW.work_item_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_work_item_communication_enforce_type ON work_item_communication;
CREATE TRIGGER trg_work_item_communication_enforce_type
BEFORE INSERT OR UPDATE OF work_item_id
ON work_item_communication
FOR EACH ROW
EXECUTE FUNCTION work_item_communication_enforce_type();
