-- Migration 028: Unified Memory System - Rollback
-- Part of Epic #199, Issue #209

-- Restore foreign key constraints to reference work_item_memory
ALTER TABLE memory_relationship DROP CONSTRAINT IF EXISTS memory_relationship_memory_id_fkey;
ALTER TABLE memory_relationship DROP CONSTRAINT IF EXISTS memory_relationship_related_memory_id_fkey;
ALTER TABLE memory_relationship
  ADD CONSTRAINT memory_relationship_memory_id_fkey
  FOREIGN KEY (memory_id) REFERENCES work_item_memory(id) ON DELETE CASCADE;
ALTER TABLE memory_relationship
  ADD CONSTRAINT memory_relationship_related_memory_id_fkey
  FOREIGN KEY (related_memory_id) REFERENCES work_item_memory(id) ON DELETE CASCADE;

ALTER TABLE memory_contact DROP CONSTRAINT IF EXISTS memory_contact_memory_id_fkey;
ALTER TABLE memory_contact
  ADD CONSTRAINT memory_contact_memory_id_fkey
  FOREIGN KEY (memory_id) REFERENCES work_item_memory(id) ON DELETE CASCADE;

-- Drop triggers and functions
DROP TRIGGER IF EXISTS memory_updated_at_trigger ON memory;
DROP TRIGGER IF EXISTS memory_search_vector_trigger ON memory;
DROP FUNCTION IF EXISTS update_memory_updated_at();
DROP FUNCTION IF EXISTS memory_search_vector_update();

-- Drop the unified memory table
DROP TABLE IF EXISTS memory CASCADE;

-- Note: memory_type enum values 'preference' and 'fact' cannot be removed
-- This is a PostgreSQL limitation - enum values cannot be removed
