-- Migration 044 Down: Remove Relationship Types
-- Part of Epic #486, Issue #490

-- Drop triggers first
DROP TRIGGER IF EXISTS relationship_type_embedding_pending_trigger ON relationship_type;
DROP TRIGGER IF EXISTS relationship_type_search_vector_trigger ON relationship_type;
DROP TRIGGER IF EXISTS relationship_type_updated_at_trigger ON relationship_type;

-- Drop trigger functions
DROP FUNCTION IF EXISTS relationship_type_embedding_pending_on_change();
DROP FUNCTION IF EXISTS relationship_type_search_vector_update();
DROP FUNCTION IF EXISTS update_relationship_type_updated_at();

-- Drop the table (cascades indexes)
DROP TABLE IF EXISTS relationship_type CASCADE;
