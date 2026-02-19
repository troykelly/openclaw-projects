-- ============================================================
-- Down migration 092: Drop inbound routing tables
-- Reverse order: channel_default, inbound_destination, prompt_template
-- ============================================================

-- STEP 1: Drop channel_default
DROP TRIGGER IF EXISTS channel_default_updated_at ON channel_default;
DROP FUNCTION IF EXISTS update_channel_default_updated_at();
DROP TABLE IF EXISTS channel_default;

-- STEP 2: Drop inbound_destination
DROP TRIGGER IF EXISTS inbound_destination_updated_at ON inbound_destination;
DROP FUNCTION IF EXISTS update_inbound_destination_updated_at();
DROP INDEX IF EXISTS idx_inbound_dest_namespace;
DROP INDEX IF EXISTS idx_inbound_dest_address;
DROP TABLE IF EXISTS inbound_destination;

-- STEP 3: Drop prompt_template
DROP TRIGGER IF EXISTS prompt_template_updated_at ON prompt_template;
DROP FUNCTION IF EXISTS update_prompt_template_updated_at();
DROP INDEX IF EXISTS idx_prompt_template_channel;
DROP INDEX IF EXISTS idx_prompt_template_namespace;
DROP INDEX IF EXISTS idx_prompt_template_default;
DROP TABLE IF EXISTS prompt_template;
