-- Migration 020: Add read_at column to work_item_activity (issue #102)
-- Allows tracking when activity items have been read

ALTER TABLE work_item_activity
ADD COLUMN IF NOT EXISTS read_at timestamptz DEFAULT NULL;

-- Index for efficient queries on unread items
CREATE INDEX IF NOT EXISTS work_item_activity_read_at_idx ON work_item_activity(read_at);

COMMENT ON COLUMN work_item_activity.read_at IS 'Timestamp when the activity item was marked as read, NULL if unread';
