-- ============================================================
-- Migration 144: Symphony seed data
-- Epic #2186 — Symphony Orchestration, Issue #2194
-- Seeds: default tool configs + Symphony prompt templates
--
-- Naming convention: tool_name uses snake_case to match existing
-- seed patterns (dev_prompt.prompt_key uses ^[a-z0-9][a-z0-9_]*$).
-- ============================================================

-- ============================================================
-- 1. Default tool configs for Symphony orchestration
-- Uses ON CONFLICT DO NOTHING for idempotency.
-- ============================================================
INSERT INTO symphony_tool_config (namespace, tool_name, command, verify_command, timeout_seconds)
VALUES
  ('default', 'claude_code', 'claude', 'claude --version', 1800),
  ('default', 'codex', 'codex', 'codex --version', 600)
ON CONFLICT (namespace, tool_name) DO NOTHING;

-- ============================================================
-- 2. Symphony prompt templates seeded into dev_prompt
-- Category: 'shipping' (these are used for shipping/implementation work)
-- Uses ON CONFLICT DO NOTHING so re-running does not overwrite
-- user edits to body.
-- ============================================================
INSERT INTO dev_prompt (namespace, prompt_key, category, is_system, title, description, body, default_body, sort_order)
VALUES
  (
    'default',
    'symphony_work_on_issue',
    'shipping',
    true,
    'Symphony: Work on Issue',
    'Standard Symphony implementation prompt with issue context, acceptance criteria, and TDD workflow',
    E'# Work on Issue: {{ issue_title }}\n\nDate: {{ date_long }}\nRepository: {{ repo_full }}\nBranch: {{ branch_name }}\nWorkspace: {{ workspace_path }}\nProject: {{ project_name }}\n\n## Issue Description\n\n{{ issue_body }}\n\n## Labels\n\n{{ issue_labels }}\n\n## Acceptance Criteria\n\n{{ issue_acceptance_criteria }}\n\n## Instructions\n\n1. Read CODING.md, CODING-RUNBOOK.md, TROUBLESHOOTING.md, AGENTS.md\n2. Understand the issue fully before starting\n3. Follow TDD: write failing tests first\n4. Make small, atomic commits with format: [#issue] description\n5. Run typecheck (pnpm run build) and tests (pnpm test) before pushing\n6. Update the GitHub issue with progress\n\n{{#if previous_error}}\n## Previous Error (Attempt {{ run_attempt }})\n\nThe previous attempt failed with:\n\n```\n{{ previous_error }}\n```\n\nFix this error before continuing with the implementation.\n{{/if}}\n\n{{#if pr_url}}\n## Existing PR\n\nA PR already exists: {{ pr_url }}\nPush to the existing branch rather than creating a new PR.\n{{/if}}',
    E'# Work on Issue: {{ issue_title }}\n\nDate: {{ date_long }}\nRepository: {{ repo_full }}\nBranch: {{ branch_name }}\nWorkspace: {{ workspace_path }}\nProject: {{ project_name }}\n\n## Issue Description\n\n{{ issue_body }}\n\n## Labels\n\n{{ issue_labels }}\n\n## Acceptance Criteria\n\n{{ issue_acceptance_criteria }}\n\n## Instructions\n\n1. Read CODING.md, CODING-RUNBOOK.md, TROUBLESHOOTING.md, AGENTS.md\n2. Understand the issue fully before starting\n3. Follow TDD: write failing tests first\n4. Make small, atomic commits with format: [#issue] description\n5. Run typecheck (pnpm run build) and tests (pnpm test) before pushing\n6. Update the GitHub issue with progress\n\n{{#if previous_error}}\n## Previous Error (Attempt {{ run_attempt }})\n\nThe previous attempt failed with:\n\n```\n{{ previous_error }}\n```\n\nFix this error before continuing with the implementation.\n{{/if}}\n\n{{#if pr_url}}\n## Existing PR\n\nA PR already exists: {{ pr_url }}\nPush to the existing branch rather than creating a new PR.\n{{/if}}',
    100
  ),
  (
    'default',
    'symphony_review_pr',
    'shipping',
    true,
    'Symphony: Review PR',
    'Codex review prompt with acceptance criteria validation and security review',
    E'# Review PR: {{ issue_title }}\n\nDate: {{ date_long }}\nRepository: {{ repo_full }}\nBranch: {{ branch_name }}\nPR: {{ pr_url }}\n\n## Issue Description\n\n{{ issue_body }}\n\n## Acceptance Criteria\n\n{{ issue_acceptance_criteria }}\n\n## Review Instructions\n\n1. Review the diff: `git diff origin/main...HEAD`\n2. Verify all acceptance criteria are met\n3. Check for security vulnerabilities (OWASP Top 10)\n4. Check for type safety issues (no unvalidated `any`)\n5. Check for error handling gaps\n6. Verify test coverage is meaningful\n7. Check for naming convention compliance\n8. Look for blind spots and edge cases\n\n## Output Format\n\nFor each finding:\n- **File**: path and line number\n- **Severity**: critical / high / medium / low\n- **Category**: security / correctness / style / performance\n- **Description**: what is wrong\n- **Suggestion**: how to fix it',
    E'# Review PR: {{ issue_title }}\n\nDate: {{ date_long }}\nRepository: {{ repo_full }}\nBranch: {{ branch_name }}\nPR: {{ pr_url }}\n\n## Issue Description\n\n{{ issue_body }}\n\n## Acceptance Criteria\n\n{{ issue_acceptance_criteria }}\n\n## Review Instructions\n\n1. Review the diff: `git diff origin/main...HEAD`\n2. Verify all acceptance criteria are met\n3. Check for security vulnerabilities (OWASP Top 10)\n4. Check for type safety issues (no unvalidated `any`)\n5. Check for error handling gaps\n6. Verify test coverage is meaningful\n7. Check for naming convention compliance\n8. Look for blind spots and edge cases\n\n## Output Format\n\nFor each finding:\n- **File**: path and line number\n- **Severity**: critical / high / medium / low\n- **Category**: security / correctness / style / performance\n- **Description**: what is wrong\n- **Suggestion**: how to fix it',
    110
  ),
  (
    'default',
    'symphony_fix_ci',
    'shipping',
    true,
    'Symphony: Fix CI',
    'Retry prompt with CI failure context for fixing broken builds',
    E'# Fix CI: {{ issue_title }}\n\nDate: {{ date_long }}\nRepository: {{ repo_full }}\nBranch: {{ branch_name }}\nWorkspace: {{ workspace_path }}\nAttempt: {{ run_attempt }}\n\n## CI Failure\n\nThe CI pipeline failed. Fix the issue and push again.\n\n```\n{{ previous_error }}\n```\n\n## Instructions\n\n1. Read the error carefully\n2. Identify the root cause (do not apply band-aids)\n3. Fix the issue\n4. Run tests locally: `pnpm test`\n5. Run typecheck: `pnpm run build`\n6. Commit with format: [#issue] Fix CI: brief description\n7. Push to the existing branch\n\n## Common CI Issues\n\n- Type errors: check `pnpm run build` output\n- Test failures: run the failing test file directly\n- Lint errors: check for formatting issues\n- Migration errors: verify migration numbering and syntax\n\n{{#if pr_url}}\nPR: {{ pr_url }}\n{{/if}}',
    E'# Fix CI: {{ issue_title }}\n\nDate: {{ date_long }}\nRepository: {{ repo_full }}\nBranch: {{ branch_name }}\nWorkspace: {{ workspace_path }}\nAttempt: {{ run_attempt }}\n\n## CI Failure\n\nThe CI pipeline failed. Fix the issue and push again.\n\n```\n{{ previous_error }}\n```\n\n## Instructions\n\n1. Read the error carefully\n2. Identify the root cause (do not apply band-aids)\n3. Fix the issue\n4. Run tests locally: `pnpm test`\n5. Run typecheck: `pnpm run build`\n6. Commit with format: [#issue] Fix CI: brief description\n7. Push to the existing branch\n\n## Common CI Issues\n\n- Type errors: check `pnpm run build` output\n- Test failures: run the failing test file directly\n- Lint errors: check for formatting issues\n- Migration errors: verify migration numbering and syntax\n\n{{#if pr_url}}\nPR: {{ pr_url }}\n{{/if}}',
    120
  ),
  (
    'default',
    'symphony_rebase_and_retry',
    'shipping',
    true,
    'Symphony: Rebase and Retry',
    'Handle diverged base branches by rebasing and retrying the implementation',
    E'# Rebase and Retry: {{ issue_title }}\n\nDate: {{ date_long }}\nRepository: {{ repo_full }}\nBranch: {{ branch_name }}\nWorkspace: {{ workspace_path }}\nAttempt: {{ run_attempt }}\n\n## Problem\n\nThe base branch has diverged. The branch needs to be rebased before continuing.\n\n{{#if previous_error}}\n## Previous Error\n\n```\n{{ previous_error }}\n```\n{{/if}}\n\n## Instructions\n\n1. Fetch the latest changes: `git fetch origin`\n2. Rebase onto the base branch: `git rebase origin/main`\n3. Resolve any merge conflicts\n4. Run tests: `pnpm test`\n5. Run typecheck: `pnpm run build`\n6. Force-push the rebased branch: `git push --force-with-lease`\n\n## Conflict Resolution\n\n- Prefer the incoming changes for generated files (lockfiles, build outputs)\n- For source code conflicts, understand both sides before resolving\n- Never silently drop changes — investigate what each side intended\n- After resolution, verify tests still pass\n\n{{#if pr_url}}\nPR: {{ pr_url }}\n{{/if}}',
    E'# Rebase and Retry: {{ issue_title }}\n\nDate: {{ date_long }}\nRepository: {{ repo_full }}\nBranch: {{ branch_name }}\nWorkspace: {{ workspace_path }}\nAttempt: {{ run_attempt }}\n\n## Problem\n\nThe base branch has diverged. The branch needs to be rebased before continuing.\n\n{{#if previous_error}}\n## Previous Error\n\n```\n{{ previous_error }}\n```\n{{/if}}\n\n## Instructions\n\n1. Fetch the latest changes: `git fetch origin`\n2. Rebase onto the base branch: `git rebase origin/main`\n3. Resolve any merge conflicts\n4. Run tests: `pnpm test`\n5. Run typecheck: `pnpm run build`\n6. Force-push the rebased branch: `git push --force-with-lease`\n\n## Conflict Resolution\n\n- Prefer the incoming changes for generated files (lockfiles, build outputs)\n- For source code conflicts, understand both sides before resolving\n- Never silently drop changes — investigate what each side intended\n- After resolution, verify tests still pass\n\n{{#if pr_url}}\nPR: {{ pr_url }}\n{{/if}}',
    130
  )
ON CONFLICT (namespace, prompt_key) WHERE deleted_at IS NULL DO NOTHING;
