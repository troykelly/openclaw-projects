-- Migration 045 Down: Remove Relationships
-- Part of Epic #486, Issue #491

-- Drop triggers first
DROP TRIGGER IF EXISTS relationship_updated_at_trigger ON relationship;

-- Drop trigger functions
DROP FUNCTION IF EXISTS update_relationship_updated_at();

-- Drop the table (cascades indexes)
DROP TABLE IF EXISTS relationship CASCADE;
