-- Migration 027: Unified Search with Full-Text Search Vectors
-- Part of Epic #199, Issue #216

-- Add search vector columns to searchable tables

-- Work Items: search by title and description
ALTER TABLE work_item ADD COLUMN IF NOT EXISTS search_vector tsvector;

-- Contacts: search by display_name and notes
ALTER TABLE contact ADD COLUMN IF NOT EXISTS search_vector tsvector;

-- Memories: already have title and content, add search vector
ALTER TABLE work_item_memory ADD COLUMN IF NOT EXISTS search_vector tsvector;

-- External Messages: search by body
ALTER TABLE external_message ADD COLUMN IF NOT EXISTS search_vector tsvector;

-- Create GIN indexes for fast full-text search
CREATE INDEX IF NOT EXISTS idx_work_item_search ON work_item USING GIN(search_vector);
CREATE INDEX IF NOT EXISTS idx_contact_search ON contact USING GIN(search_vector);
CREATE INDEX IF NOT EXISTS idx_memory_search ON work_item_memory USING GIN(search_vector);
CREATE INDEX IF NOT EXISTS idx_message_search ON external_message USING GIN(search_vector);

-- Function to update work_item search vector
CREATE OR REPLACE FUNCTION work_item_search_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector := to_tsvector('english',
    coalesce(NEW.title, '') || ' ' || coalesce(NEW.description, '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for work_item
DROP TRIGGER IF EXISTS work_item_search_trigger ON work_item;
CREATE TRIGGER work_item_search_trigger
BEFORE INSERT OR UPDATE OF title, description ON work_item
FOR EACH ROW EXECUTE FUNCTION work_item_search_update();

-- Function to update contact search vector
CREATE OR REPLACE FUNCTION contact_search_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector := to_tsvector('english',
    coalesce(NEW.display_name, '') || ' ' || coalesce(NEW.notes, '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for contact
DROP TRIGGER IF EXISTS contact_search_trigger ON contact;
CREATE TRIGGER contact_search_trigger
BEFORE INSERT OR UPDATE OF display_name, notes ON contact
FOR EACH ROW EXECUTE FUNCTION contact_search_update();

-- Function to update memory search vector
CREATE OR REPLACE FUNCTION memory_search_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector := to_tsvector('english',
    coalesce(NEW.title, '') || ' ' || coalesce(NEW.content, '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for work_item_memory
DROP TRIGGER IF EXISTS memory_search_trigger ON work_item_memory;
CREATE TRIGGER memory_search_trigger
BEFORE INSERT OR UPDATE OF title, content ON work_item_memory
FOR EACH ROW EXECUTE FUNCTION memory_search_update();

-- Function to update external_message search vector
CREATE OR REPLACE FUNCTION message_search_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector := to_tsvector('english',
    coalesce(NEW.body, '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for external_message
DROP TRIGGER IF EXISTS message_search_trigger ON external_message;
CREATE TRIGGER message_search_trigger
BEFORE INSERT OR UPDATE OF body ON external_message
FOR EACH ROW EXECUTE FUNCTION message_search_update();

-- Backfill existing data with search vectors
UPDATE work_item SET search_vector = to_tsvector('english',
  coalesce(title, '') || ' ' || coalesce(description, '')
) WHERE search_vector IS NULL;

UPDATE contact SET search_vector = to_tsvector('english',
  coalesce(display_name, '') || ' ' || coalesce(notes, '')
) WHERE search_vector IS NULL;

UPDATE work_item_memory SET search_vector = to_tsvector('english',
  coalesce(title, '') || ' ' || coalesce(content, '')
) WHERE search_vector IS NULL;

UPDATE external_message SET search_vector = to_tsvector('english',
  coalesce(body, '')
) WHERE search_vector IS NULL;

-- Add comments
COMMENT ON COLUMN work_item.search_vector IS 'Full-text search vector for work item title and description';
COMMENT ON COLUMN contact.search_vector IS 'Full-text search vector for contact display_name and notes';
COMMENT ON COLUMN work_item_memory.search_vector IS 'Full-text search vector for memory title and content';
COMMENT ON COLUMN external_message.search_vector IS 'Full-text search vector for message body';
