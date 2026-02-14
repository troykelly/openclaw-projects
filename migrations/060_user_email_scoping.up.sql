-- Migration 060: Add user_email scoping to core tables
-- Issue #1172: Enable per-user data isolation for work_item, contact,
-- contact_endpoint, relationship, external_thread, external_message.
-- Column is nullable for backwards compatibility — existing rows remain
-- visible to all users (no user_email = global).

-- work_item
ALTER TABLE work_item ADD COLUMN IF NOT EXISTS user_email TEXT;
CREATE INDEX IF NOT EXISTS idx_work_item_user_email ON work_item(user_email);

-- contact
ALTER TABLE contact ADD COLUMN IF NOT EXISTS user_email TEXT;
CREATE INDEX IF NOT EXISTS idx_contact_user_email ON contact(user_email);

-- contact_endpoint
ALTER TABLE contact_endpoint ADD COLUMN IF NOT EXISTS user_email TEXT;
CREATE INDEX IF NOT EXISTS idx_contact_endpoint_user_email ON contact_endpoint(user_email);

-- relationship
ALTER TABLE relationship ADD COLUMN IF NOT EXISTS user_email TEXT;
CREATE INDEX IF NOT EXISTS idx_relationship_user_email ON relationship(user_email);

-- external_thread
ALTER TABLE external_thread ADD COLUMN IF NOT EXISTS user_email TEXT;
CREATE INDEX IF NOT EXISTS idx_external_thread_user_email ON external_thread(user_email);

-- external_message
ALTER TABLE external_message ADD COLUMN IF NOT EXISTS user_email TEXT;
CREATE INDEX IF NOT EXISTS idx_external_message_user_email ON external_message(user_email);
