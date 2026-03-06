-- ============================================================
-- Migration 144 DOWN: Remove Symphony seed data
-- Epic #2186 — Symphony Orchestration, Issue #2194
-- ============================================================

-- Remove Symphony prompt templates
DELETE FROM dev_prompt
WHERE namespace = 'default'
  AND is_system = true
  AND prompt_key IN (
    'symphony_work_on_issue',
    'symphony_review_pr',
    'symphony_fix_ci',
    'symphony_rebase_and_retry'
  );

-- Remove default tool configs
DELETE FROM symphony_tool_config
WHERE namespace = 'default'
  AND tool_name IN ('claude_code', 'codex');
