ALTER TABLE user_setting
  ADD COLUMN IF NOT EXISTS visible_agent_ids text[];

COMMENT ON COLUMN user_setting.visible_agent_ids IS
  'Agent IDs visible in chat UI. NULL means all agents visible.';
