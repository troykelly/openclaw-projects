-- Migration 091 DOWN: Restore user_email scoping columns (Epic #1418, Phase 4 rollback)

BEGIN;

-- Restore user_email columns (nullable, since data is lost on drop)
ALTER TABLE work_item ADD COLUMN IF NOT EXISTS user_email text;
ALTER TABLE contact ADD COLUMN IF NOT EXISTS user_email text;
ALTER TABLE contact_endpoint ADD COLUMN IF NOT EXISTS user_email text;
ALTER TABLE relationship ADD COLUMN IF NOT EXISTS user_email text;
ALTER TABLE external_thread ADD COLUMN IF NOT EXISTS user_email text;
ALTER TABLE external_message ADD COLUMN IF NOT EXISTS user_email text;
ALTER TABLE notebook ADD COLUMN IF NOT EXISTS user_email text;
ALTER TABLE note ADD COLUMN IF NOT EXISTS user_email text;
ALTER TABLE recipe ADD COLUMN IF NOT EXISTS user_email text;
ALTER TABLE meal_log ADD COLUMN IF NOT EXISTS user_email text;
ALTER TABLE pantry_item ADD COLUMN IF NOT EXISTS user_email text;
ALTER TABLE entity_link ADD COLUMN IF NOT EXISTS user_email text;
ALTER TABLE skill_store_item ADD COLUMN IF NOT EXISTS user_email text;
ALTER TABLE memory ADD COLUMN IF NOT EXISTS user_email text;

-- Restore indexes
CREATE INDEX IF NOT EXISTS idx_work_item_user_email ON work_item(user_email);
CREATE INDEX IF NOT EXISTS idx_contact_user_email ON contact(user_email);
CREATE INDEX IF NOT EXISTS idx_contact_endpoint_user_email ON contact_endpoint(user_email);
CREATE INDEX IF NOT EXISTS idx_relationship_user_email ON relationship(user_email);
CREATE INDEX IF NOT EXISTS idx_external_thread_user_email ON external_thread(user_email);
CREATE INDEX IF NOT EXISTS idx_external_message_user_email ON external_message(user_email);
CREATE INDEX IF NOT EXISTS idx_notebook_user_email ON notebook(user_email);
CREATE INDEX IF NOT EXISTS idx_note_user_email ON note(user_email);
CREATE INDEX IF NOT EXISTS idx_recipe_user_email ON recipe(user_email);
CREATE INDEX IF NOT EXISTS idx_meal_log_user_email ON meal_log(user_email);
CREATE INDEX IF NOT EXISTS idx_pantry_item_user_email ON pantry_item(user_email);
CREATE INDEX IF NOT EXISTS idx_entity_link_user_email ON entity_link(user_email);
CREATE INDEX IF NOT EXISTS idx_skill_store_item_user_email ON skill_store_item(user_email);
CREATE INDEX IF NOT EXISTS idx_memory_user_email ON memory(user_email);

-- Remove deprecation comments
COMMENT ON TABLE note_share IS NULL;
COMMENT ON TABLE notebook_share IS NULL;

COMMIT;
