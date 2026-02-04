-- Migration 047: Relationships
-- Part of Epic #486, Issue #491
-- Creates the relationship table connecting contacts via relationship types.
-- Supports directional, symmetric, and group membership relationships.

-- ============================================================================
-- RELATIONSHIP TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS relationship (
  id uuid PRIMARY KEY DEFAULT new_uuid(),

  -- The two contacts in the relationship
  contact_a_id uuid NOT NULL REFERENCES contact(id) ON DELETE CASCADE,
  contact_b_id uuid NOT NULL REFERENCES contact(id) ON DELETE CASCADE,

  -- The relationship type
  relationship_type_id uuid NOT NULL REFERENCES relationship_type(id),

  -- Metadata
  notes text,
  created_by_agent text,

  -- Embedding for semantic search
  embedding vector(1024),
  embedding_status text NOT NULL DEFAULT 'pending'
    CHECK (embedding_status IN ('pending', 'complete', 'failed')),

  -- Timestamps
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- Constraints
  CONSTRAINT no_self_relationship CHECK (contact_a_id != contact_b_id),
  CONSTRAINT unique_relationship UNIQUE (contact_a_id, contact_b_id, relationship_type_id)
);

COMMENT ON TABLE relationship IS 'Connects two contacts via a relationship type. Core graph for contact relationships.';
COMMENT ON COLUMN relationship.contact_a_id IS 'First contact in the relationship (for directional types, this is the "subject")';
COMMENT ON COLUMN relationship.contact_b_id IS 'Second contact in the relationship (for directional types, this is the "object")';
COMMENT ON COLUMN relationship.relationship_type_id IS 'References relationship_type table for the type of relationship';
COMMENT ON COLUMN relationship.notes IS 'Optional notes about this specific relationship instance';
COMMENT ON COLUMN relationship.created_by_agent IS 'Agent that created this relationship';
COMMENT ON COLUMN relationship.embedding IS 'vector(1024) for semantic search via pgvector';

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_relationship_contact_a ON relationship (contact_a_id);
CREATE INDEX IF NOT EXISTS idx_relationship_contact_b ON relationship (contact_b_id);
CREATE INDEX IF NOT EXISTS idx_relationship_type ON relationship (relationship_type_id);
CREATE INDEX IF NOT EXISTS idx_relationship_embedding_pending ON relationship (embedding_status)
  WHERE embedding_status = 'pending';

-- Composite index for efficient graph traversal: find all relationships for a contact
CREATE INDEX IF NOT EXISTS idx_relationship_contact_a_type ON relationship (contact_a_id, relationship_type_id);
CREATE INDEX IF NOT EXISTS idx_relationship_contact_b_type ON relationship (contact_b_id, relationship_type_id);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_relationship_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS relationship_updated_at_trigger ON relationship;
CREATE TRIGGER relationship_updated_at_trigger
  BEFORE UPDATE ON relationship
  FOR EACH ROW EXECUTE FUNCTION update_relationship_updated_at();
