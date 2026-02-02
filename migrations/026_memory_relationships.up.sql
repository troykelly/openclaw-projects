-- Migration 026: Memory and Entity Relationships
-- Part of Epic #199, Issue #205

-- Relationship type for memory-to-memory links
DO $$ BEGIN
  CREATE TYPE memory_relationship_type AS ENUM (
    'related',      -- General relationship
    'supersedes',   -- This memory replaces another
    'contradicts',  -- This memory conflicts with another
    'supports'      -- This memory supports/confirms another
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Relationship type for memory-to-contact links
DO $$ BEGIN
  CREATE TYPE memory_contact_relationship AS ENUM (
    'about',        -- Memory is about this contact
    'from',         -- Memory originates from this contact
    'shared_with',  -- Memory was shared with this contact
    'mentioned'     -- Contact is mentioned in this memory
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Memory-to-memory relationship table
CREATE TABLE IF NOT EXISTS memory_relationship (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_id uuid NOT NULL REFERENCES work_item_memory(id) ON DELETE CASCADE,
  related_memory_id uuid NOT NULL REFERENCES work_item_memory(id) ON DELETE CASCADE,
  relationship_type memory_relationship_type NOT NULL DEFAULT 'related',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),

  -- Prevent self-references
  CONSTRAINT memory_relationship_no_self CHECK (memory_id != related_memory_id),
  -- Prevent duplicate relationships (order-independent)
  CONSTRAINT memory_relationship_unique UNIQUE (memory_id, related_memory_id)
);

-- Index for efficient lookup by either memory
CREATE INDEX idx_memory_relationship_memory_id ON memory_relationship(memory_id);
CREATE INDEX idx_memory_relationship_related_memory_id ON memory_relationship(related_memory_id);
CREATE INDEX idx_memory_relationship_type ON memory_relationship(relationship_type);

-- Memory-to-contact relationship table
CREATE TABLE IF NOT EXISTS memory_contact (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_id uuid NOT NULL REFERENCES work_item_memory(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES contact(id) ON DELETE CASCADE,
  relationship_type memory_contact_relationship NOT NULL DEFAULT 'about',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),

  -- Prevent duplicate relationships
  CONSTRAINT memory_contact_unique UNIQUE (memory_id, contact_id, relationship_type)
);

-- Index for efficient lookup
CREATE INDEX idx_memory_contact_memory_id ON memory_contact(memory_id);
CREATE INDEX idx_memory_contact_contact_id ON memory_contact(contact_id);
CREATE INDEX idx_memory_contact_type ON memory_contact(relationship_type);

-- Add comments for documentation
COMMENT ON TABLE memory_relationship IS 'Links memories to other memories with typed relationships';
COMMENT ON TABLE memory_contact IS 'Links memories to contacts with typed relationships';
COMMENT ON TYPE memory_relationship_type IS 'Types of relationships between memories';
COMMENT ON TYPE memory_contact_relationship IS 'Types of relationships between memories and contacts';
