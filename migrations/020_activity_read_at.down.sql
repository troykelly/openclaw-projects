-- Migration 020 down: Remove read_at column

DROP INDEX IF EXISTS work_item_activity_read_at_idx;
ALTER TABLE work_item_activity DROP COLUMN IF EXISTS read_at;
