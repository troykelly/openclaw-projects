-- Migration 026: Memory and Entity Relationships (Rollback)
-- Part of Epic #199, Issue #205

-- Drop tables first (they depend on the types)
DROP TABLE IF EXISTS memory_contact;
DROP TABLE IF EXISTS memory_relationship;

-- Drop types
DROP TYPE IF EXISTS memory_contact_relationship;
DROP TYPE IF EXISTS memory_relationship_type;
