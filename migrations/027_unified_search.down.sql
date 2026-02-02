-- Migration 027: Unified Search (Rollback)
-- Part of Epic #199, Issue #216

-- Drop triggers
DROP TRIGGER IF EXISTS work_item_search_trigger ON work_item;
DROP TRIGGER IF EXISTS contact_search_trigger ON contact;
DROP TRIGGER IF EXISTS memory_search_trigger ON work_item_memory;
DROP TRIGGER IF EXISTS message_search_trigger ON external_message;

-- Drop functions
DROP FUNCTION IF EXISTS work_item_search_update();
DROP FUNCTION IF EXISTS contact_search_update();
DROP FUNCTION IF EXISTS memory_search_update();
DROP FUNCTION IF EXISTS message_search_update();

-- Drop indexes
DROP INDEX IF EXISTS idx_work_item_search;
DROP INDEX IF EXISTS idx_contact_search;
DROP INDEX IF EXISTS idx_memory_search;
DROP INDEX IF EXISTS idx_message_search;

-- Drop columns
ALTER TABLE work_item DROP COLUMN IF EXISTS search_vector;
ALTER TABLE contact DROP COLUMN IF EXISTS search_vector;
ALTER TABLE work_item_memory DROP COLUMN IF EXISTS search_vector;
ALTER TABLE external_message DROP COLUMN IF EXISTS search_vector;
