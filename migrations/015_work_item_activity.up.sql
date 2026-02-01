-- Migration 015: Work Item Activity tracking (issue #130)
-- Creates the work_item_activity table to track changes to work items

-- Activity types enum
DO $$ BEGIN
  CREATE TYPE work_item_activity_type AS ENUM (
    'created',
    'updated',
    'status_change',
    'assigned',
    'comment'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Activity log table
CREATE TABLE IF NOT EXISTS work_item_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id uuid NOT NULL REFERENCES work_item(id) ON DELETE CASCADE,
  activity_type work_item_activity_type NOT NULL,
  actor_email text,
  description text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Index for efficient queries
CREATE INDEX IF NOT EXISTS work_item_activity_work_item_id_idx ON work_item_activity(work_item_id);
CREATE INDEX IF NOT EXISTS work_item_activity_created_at_idx ON work_item_activity(created_at DESC);
CREATE INDEX IF NOT EXISTS work_item_activity_type_idx ON work_item_activity(activity_type);

-- Grant permissions (same pattern as other tables)
COMMENT ON TABLE work_item_activity IS 'Tracks activity/changes on work items for activity feed';
