-- Migration 052: Skill Store Activity tracking (issue #808)
-- Extends the activity feed to cover skill store operations.

-- Activity types for skill store operations
DO $$ BEGIN
  CREATE TYPE skill_store_activity_type AS ENUM (
    'item_created',
    'item_updated',
    'item_deleted',
    'item_archived',
    'items_bulk_created',
    'items_bulk_deleted',
    'schedule_triggered',
    'schedule_paused',
    'schedule_resumed',
    'collection_deleted'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Skill store activity log table
CREATE TABLE IF NOT EXISTS skill_store_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_type skill_store_activity_type NOT NULL,
  skill_id text NOT NULL,
  collection text,
  description text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_skill_store_activity_skill_id ON skill_store_activity(skill_id);
CREATE INDEX IF NOT EXISTS idx_skill_store_activity_created_at ON skill_store_activity(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_skill_store_activity_type ON skill_store_activity(activity_type);
CREATE INDEX IF NOT EXISTS idx_skill_store_activity_read_at ON skill_store_activity(read_at);

COMMENT ON TABLE skill_store_activity IS 'Tracks activity/changes on skill store items and schedules for activity feed (issue #808)';
