-- Migration 044: Relationship Types
-- Part of Epic #486, Issue #490
-- Creates the relationship_type reference table pre-seeded with common types.
-- Relationship types define how contacts relate to each other.

-- ============================================================================
-- RELATIONSHIP_TYPE TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS relationship_type (
  id uuid PRIMARY KEY DEFAULT new_uuid(),

  -- Identity
  name text NOT NULL UNIQUE,               -- snake_case canonical: 'partner_of'
  label text NOT NULL,                      -- Human-readable: 'Partner of'

  -- Directionality
  is_directional boolean NOT NULL DEFAULT false,
  inverse_type_id uuid REFERENCES relationship_type(id),

  -- Metadata
  description text,
  created_by_agent text,                    -- null = pre-seeded

  -- Embedding for semantic matching
  embedding vector(1024),
  embedding_status text NOT NULL DEFAULT 'pending'
    CHECK (embedding_status IN ('pending', 'complete', 'failed')),

  -- Full-text search
  search_vector tsvector,

  -- Timestamps
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE relationship_type IS 'Reference table of relationship types between contacts';
COMMENT ON COLUMN relationship_type.name IS 'snake_case canonical name, e.g. partner_of';
COMMENT ON COLUMN relationship_type.label IS 'Human-readable label, e.g. Partner of';
COMMENT ON COLUMN relationship_type.is_directional IS 'true = directional (parent_of/child_of), false = symmetric (friend_of)';
COMMENT ON COLUMN relationship_type.inverse_type_id IS 'For directional types, points to the inverse type';
COMMENT ON COLUMN relationship_type.created_by_agent IS 'null for pre-seeded types; agent ID for agent-created types';
COMMENT ON COLUMN relationship_type.embedding IS 'vector(1024) for semantic matching via pgvector';

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_relationship_type_name ON relationship_type(name);
CREATE INDEX IF NOT EXISTS idx_relationship_type_directional ON relationship_type(is_directional);
CREATE INDEX IF NOT EXISTS idx_relationship_type_inverse ON relationship_type(inverse_type_id)
  WHERE inverse_type_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_relationship_type_search_vector ON relationship_type
  USING GIN(search_vector);
CREATE INDEX IF NOT EXISTS idx_relationship_type_embedding_pending ON relationship_type(embedding_status)
  WHERE embedding_status = 'pending';

-- HNSW index for semantic search (only useful when embeddings exist)
CREATE INDEX IF NOT EXISTS idx_relationship_type_embedding ON relationship_type
  USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64)
  WHERE embedding IS NOT NULL;

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_relationship_type_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS relationship_type_updated_at_trigger ON relationship_type;
CREATE TRIGGER relationship_type_updated_at_trigger
  BEFORE UPDATE ON relationship_type
  FOR EACH ROW EXECUTE FUNCTION update_relationship_type_updated_at();

-- Auto-update search_vector for full-text search
CREATE OR REPLACE FUNCTION relationship_type_search_vector_update()
RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', COALESCE(NEW.name, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(NEW.label, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(NEW.description, '')), 'B');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS relationship_type_search_vector_trigger ON relationship_type;
CREATE TRIGGER relationship_type_search_vector_trigger
  BEFORE INSERT OR UPDATE OF name, label, description ON relationship_type
  FOR EACH ROW EXECUTE FUNCTION relationship_type_search_vector_update();

-- Mark embedding as pending when description changes
CREATE OR REPLACE FUNCTION relationship_type_embedding_pending_on_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.name IS DISTINCT FROM NEW.name
     OR OLD.label IS DISTINCT FROM NEW.label
     OR OLD.description IS DISTINCT FROM NEW.description THEN
    NEW.embedding_status = 'pending';
    NEW.embedding = NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS relationship_type_embedding_pending_trigger ON relationship_type;
CREATE TRIGGER relationship_type_embedding_pending_trigger
  BEFORE UPDATE OF name, label, description ON relationship_type
  FOR EACH ROW EXECUTE FUNCTION relationship_type_embedding_pending_on_change();

-- ============================================================================
-- PRE-SEEDED DATA: SYMMETRIC TYPES
-- ============================================================================

INSERT INTO relationship_type (name, label, is_directional, description) VALUES
  ('partner_of', 'Partner of', false,
   'Romantic or life partner. Inclusive of all relationship structures including marriage, civil union, domestic partnership, and polyamorous relationships. Also known as spouse, husband, wife. Inclusive and gender-neutral.'),
  ('sibling_of', 'Sibling of', false,
   'Sibling relationship including biological, adoptive, step, and half siblings.'),
  ('friend_of', 'Friend of', false,
   'Friendship or close social bond.'),
  ('colleague_of', 'Colleague of', false,
   'Colleague or coworker in a professional setting.'),
  ('housemate_of', 'Housemate of', false,
   'Shares a dwelling or household. Includes roommates, flatmates, and other shared living arrangements.'),
  ('co_parent_of', 'Co-parent of', false,
   'Shares parenting responsibilities for one or more children, regardless of romantic relationship status.')
ON CONFLICT (name) DO NOTHING;

-- ============================================================================
-- PRE-SEEDED DATA: DIRECTIONAL TYPES
-- ============================================================================
-- Directional types are inserted in pairs. We insert both types first,
-- then link them with UPDATE statements to set inverse_type_id.

-- Familial
INSERT INTO relationship_type (name, label, is_directional, description) VALUES
  ('parent_of', 'Parent of', true,
   'Parent relationship including biological, adoptive, step, and foster parents.'),
  ('child_of', 'Child of', true,
   'Child relationship including biological, adoptive, step, and foster children.')
ON CONFLICT (name) DO NOTHING;

INSERT INTO relationship_type (name, label, is_directional, description) VALUES
  ('grandparent_of', 'Grandparent of', true,
   'Grandparent relationship including biological and adoptive.'),
  ('grandchild_of', 'Grandchild of', true,
   'Grandchild relationship including biological and adoptive.')
ON CONFLICT (name) DO NOTHING;

-- Care
INSERT INTO relationship_type (name, label, is_directional, description) VALUES
  ('cares_for', 'Cares for', true,
   'Provides care, support, or guardianship. Includes formal and informal caregiving.'),
  ('cared_for_by', 'Cared for by', true,
   'Receives care, support, or guardianship from someone.')
ON CONFLICT (name) DO NOTHING;

-- Professional
INSERT INTO relationship_type (name, label, is_directional, description) VALUES
  ('employs', 'Employs', true,
   'Employer relationship. The person or organisation that employs someone.'),
  ('employed_by', 'Employed by', true,
   'Employee relationship. Works for a person or organisation.')
ON CONFLICT (name) DO NOTHING;

INSERT INTO relationship_type (name, label, is_directional, description) VALUES
  ('manages', 'Manages', true,
   'Direct management or supervisory relationship.'),
  ('managed_by', 'Managed by', true,
   'Reports to or is supervised by someone.')
ON CONFLICT (name) DO NOTHING;

INSERT INTO relationship_type (name, label, is_directional, description) VALUES
  ('mentor_of', 'Mentor of', true,
   'Mentorship relationship. Provides guidance and advice.'),
  ('mentee_of', 'Mentee of', true,
   'Mentee relationship. Receives guidance and advice from a mentor.')
ON CONFLICT (name) DO NOTHING;

-- Kinship/community
INSERT INTO relationship_type (name, label, is_directional, description) VALUES
  ('elder_of', 'Elder of', true,
   'Recognised elder or senior figure in a family, community, or cultural context.'),
  ('junior_of', 'Junior of', true,
   'Junior or younger member relative to an elder in a family, community, or cultural context.')
ON CONFLICT (name) DO NOTHING;

-- Group/org membership
INSERT INTO relationship_type (name, label, is_directional, description) VALUES
  ('member_of', 'Member of', true,
   'Member of a group, organisation, team, or community.'),
  ('has_member', 'Has member', true,
   'Group, organisation, team, or community that has a member.')
ON CONFLICT (name) DO NOTHING;

INSERT INTO relationship_type (name, label, is_directional, description) VALUES
  ('founder_of', 'Founder of', true,
   'Founded or co-founded an organisation, company, or group.'),
  ('founded_by', 'Founded by', true,
   'Organisation, company, or group that was founded by someone.')
ON CONFLICT (name) DO NOTHING;

INSERT INTO relationship_type (name, label, is_directional, description) VALUES
  ('client_of', 'Client of', true,
   'Client or customer of a service provider, business, or professional.'),
  ('has_client', 'Has client', true,
   'Service provider, business, or professional that has a client or customer.')
ON CONFLICT (name) DO NOTHING;

INSERT INTO relationship_type (name, label, is_directional, description) VALUES
  ('vendor_of', 'Vendor of', true,
   'Vendor, supplier, or service provider to a client or organisation.'),
  ('has_vendor', 'Has vendor', true,
   'Has a vendor, supplier, or service provider.')
ON CONFLICT (name) DO NOTHING;

-- Agent relationships
INSERT INTO relationship_type (name, label, is_directional, description) VALUES
  ('assigned_to', 'Assigned to', true,
   'Assigned to an AI agent for task management or assistance.'),
  ('manages_agent', 'Manages agent', true,
   'AI agent that manages or assists a person.')
ON CONFLICT (name) DO NOTHING;

INSERT INTO relationship_type (name, label, is_directional, description) VALUES
  ('owned_by', 'Owned by', true,
   'Owned by a person. Used for agent ownership or resource ownership.'),
  ('owns', 'Owns', true,
   'Owns an agent, resource, or entity.')
ON CONFLICT (name) DO NOTHING;

-- ============================================================================
-- LINK INVERSE TYPES
-- ============================================================================
-- Now that all types exist, link each directional pair.

UPDATE relationship_type SET inverse_type_id = (SELECT id FROM relationship_type WHERE name = 'child_of') WHERE name = 'parent_of';
UPDATE relationship_type SET inverse_type_id = (SELECT id FROM relationship_type WHERE name = 'parent_of') WHERE name = 'child_of';

UPDATE relationship_type SET inverse_type_id = (SELECT id FROM relationship_type WHERE name = 'grandchild_of') WHERE name = 'grandparent_of';
UPDATE relationship_type SET inverse_type_id = (SELECT id FROM relationship_type WHERE name = 'grandparent_of') WHERE name = 'grandchild_of';

UPDATE relationship_type SET inverse_type_id = (SELECT id FROM relationship_type WHERE name = 'cared_for_by') WHERE name = 'cares_for';
UPDATE relationship_type SET inverse_type_id = (SELECT id FROM relationship_type WHERE name = 'cares_for') WHERE name = 'cared_for_by';

UPDATE relationship_type SET inverse_type_id = (SELECT id FROM relationship_type WHERE name = 'employed_by') WHERE name = 'employs';
UPDATE relationship_type SET inverse_type_id = (SELECT id FROM relationship_type WHERE name = 'employs') WHERE name = 'employed_by';

UPDATE relationship_type SET inverse_type_id = (SELECT id FROM relationship_type WHERE name = 'managed_by') WHERE name = 'manages';
UPDATE relationship_type SET inverse_type_id = (SELECT id FROM relationship_type WHERE name = 'manages') WHERE name = 'managed_by';

UPDATE relationship_type SET inverse_type_id = (SELECT id FROM relationship_type WHERE name = 'mentee_of') WHERE name = 'mentor_of';
UPDATE relationship_type SET inverse_type_id = (SELECT id FROM relationship_type WHERE name = 'mentor_of') WHERE name = 'mentee_of';

UPDATE relationship_type SET inverse_type_id = (SELECT id FROM relationship_type WHERE name = 'junior_of') WHERE name = 'elder_of';
UPDATE relationship_type SET inverse_type_id = (SELECT id FROM relationship_type WHERE name = 'elder_of') WHERE name = 'junior_of';

UPDATE relationship_type SET inverse_type_id = (SELECT id FROM relationship_type WHERE name = 'has_member') WHERE name = 'member_of';
UPDATE relationship_type SET inverse_type_id = (SELECT id FROM relationship_type WHERE name = 'member_of') WHERE name = 'has_member';

UPDATE relationship_type SET inverse_type_id = (SELECT id FROM relationship_type WHERE name = 'founded_by') WHERE name = 'founder_of';
UPDATE relationship_type SET inverse_type_id = (SELECT id FROM relationship_type WHERE name = 'founder_of') WHERE name = 'founded_by';

UPDATE relationship_type SET inverse_type_id = (SELECT id FROM relationship_type WHERE name = 'has_client') WHERE name = 'client_of';
UPDATE relationship_type SET inverse_type_id = (SELECT id FROM relationship_type WHERE name = 'client_of') WHERE name = 'has_client';

UPDATE relationship_type SET inverse_type_id = (SELECT id FROM relationship_type WHERE name = 'has_vendor') WHERE name = 'vendor_of';
UPDATE relationship_type SET inverse_type_id = (SELECT id FROM relationship_type WHERE name = 'vendor_of') WHERE name = 'has_vendor';

UPDATE relationship_type SET inverse_type_id = (SELECT id FROM relationship_type WHERE name = 'manages_agent') WHERE name = 'assigned_to';
UPDATE relationship_type SET inverse_type_id = (SELECT id FROM relationship_type WHERE name = 'assigned_to') WHERE name = 'manages_agent';

UPDATE relationship_type SET inverse_type_id = (SELECT id FROM relationship_type WHERE name = 'owns') WHERE name = 'owned_by';
UPDATE relationship_type SET inverse_type_id = (SELECT id FROM relationship_type WHERE name = 'owned_by') WHERE name = 'owns';
