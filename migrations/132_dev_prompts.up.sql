-- ============================================================
-- Migration 132: Dev Prompts
-- Epic #2011 — User-managed prompt templates for common dev tasks
-- Issue #2012 — Database Schema, Migration & Seeding
-- ============================================================

-- ============================================================
-- STEP 1: dev_prompt table
-- Stores system-seeded and user-defined development prompts
-- with Handlebars template bodies and category grouping.
-- ============================================================
CREATE TABLE IF NOT EXISTS dev_prompt (
  id            uuid PRIMARY KEY DEFAULT new_uuid(),
  namespace     text NOT NULL DEFAULT 'default'
                  CHECK (namespace ~ '^[a-z0-9][a-z0-9._-]*$' AND length(namespace) <= 63),
  prompt_key    text NOT NULL
                  CHECK (prompt_key ~ '^[a-z0-9][a-z0-9_]*$' AND length(prompt_key) <= 100),
  category      text NOT NULL DEFAULT 'general'
                  CHECK (category IN ('identification', 'creation', 'triage', 'shipping', 'general', 'custom')),
  is_system     boolean NOT NULL DEFAULT false,
  title         text NOT NULL CHECK (length(TRIM(title)) > 0),
  description   text NOT NULL DEFAULT '',
  body          text NOT NULL DEFAULT '',
  default_body  text NOT NULL DEFAULT '',
  sort_order    integer NOT NULL DEFAULT 0,
  is_active     boolean NOT NULL DEFAULT true,
  deleted_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Partial unique index: prompt_key is unique per namespace among non-deleted rows
CREATE UNIQUE INDEX IF NOT EXISTS idx_dev_prompt_ns_key
  ON dev_prompt (namespace, prompt_key) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_dev_prompt_namespace
  ON dev_prompt (namespace);

CREATE INDEX IF NOT EXISTS idx_dev_prompt_category
  ON dev_prompt (category);

CREATE INDEX IF NOT EXISTS idx_dev_prompt_is_system
  ON dev_prompt (is_system);

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_dev_prompt_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS dev_prompt_updated_at ON dev_prompt;
CREATE TRIGGER dev_prompt_updated_at
  BEFORE UPDATE ON dev_prompt
  FOR EACH ROW
  EXECUTE FUNCTION update_dev_prompt_updated_at();

-- ============================================================
-- STEP 2: Seed system prompts in 'default' namespace
-- Uses ON CONFLICT DO NOTHING so re-running does not overwrite
-- user edits to body.
-- ============================================================
INSERT INTO dev_prompt (namespace, prompt_key, category, is_system, title, description, body, default_body, sort_order)
VALUES
  (
    'default',
    'all_open',
    'identification',
    true,
    'Identify Open Work',
    'Identify and collate open PRs, Initiatives, Epics, and Issues — create a dependency graph and safe parallel shipping lists',
    E'# Identify Open Work\n\nDate: {{ date_long }}\nNamespace: {{ namespace }}\n\n## Instructions\n\nIdentify and collate all open work for **{{ repo_full }}**:\n\n1. List all open PRs with status and reviewers\n2. List all open Initiatives, Epics, and Issues\n3. Build a dependency graph showing blocking relationships\n4. Create safe parallel shipping lists (what can ship together)\n5. Highlight any stale items (no activity in 7+ days)\n\n## Output Format\n\nProvide a structured summary with:\n- Dependency graph (text or mermaid)\n- Parallel shipping lists grouped by phase\n- Risk assessment for each group',
    E'# Identify Open Work\n\nDate: {{ date_long }}\nNamespace: {{ namespace }}\n\n## Instructions\n\nIdentify and collate all open work for **{{ repo_full }}**:\n\n1. List all open PRs with status and reviewers\n2. List all open Initiatives, Epics, and Issues\n3. Build a dependency graph showing blocking relationships\n4. Create safe parallel shipping lists (what can ship together)\n5. Highlight any stale items (no activity in 7+ days)\n\n## Output Format\n\nProvide a structured summary with:\n- Dependency graph (text or mermaid)\n- Parallel shipping lists grouped by phase\n- Risk assessment for each group',
    10
  ),
  (
    'default',
    'new_feature_request',
    'creation',
    true,
    'New Feature Request',
    'Create a new feature request with epic breakdown, acceptance criteria, and TDD plan',
    E'# New Feature Request\n\nDate: {{ date_long }}\nRepo: {{ repo_full }}\nNamespace: {{ namespace }}\n\n## Instructions\n\nCreate a comprehensive feature request:\n\n1. **Summary**: Clear description of the feature and its value\n2. **User Stories**: Who benefits and how\n3. **Epic Breakdown**: Split into implementable issues\n4. **Acceptance Criteria**: Testable criteria for each issue\n5. **TDD Plan**: Test strategy for unit, integration, and e2e\n6. **Dependencies**: What must exist before this can be built\n\n## Template\n\nUse the standard issue template with labels and milestones.',
    E'# New Feature Request\n\nDate: {{ date_long }}\nRepo: {{ repo_full }}\nNamespace: {{ namespace }}\n\n## Instructions\n\nCreate a comprehensive feature request:\n\n1. **Summary**: Clear description of the feature and its value\n2. **User Stories**: Who benefits and how\n3. **Epic Breakdown**: Split into implementable issues\n4. **Acceptance Criteria**: Testable criteria for each issue\n5. **TDD Plan**: Test strategy for unit, integration, and e2e\n6. **Dependencies**: What must exist before this can be built\n\n## Template\n\nUse the standard issue template with labels and milestones.',
    20
  ),
  (
    'default',
    'new_initiative',
    'creation',
    true,
    'New Initiative',
    'Create a new initiative with scope, success criteria, and epic decomposition',
    E'# New Initiative\n\nDate: {{ date_long }}\nRepo: {{ repo_full }}\nNamespace: {{ namespace }}\n\n## Instructions\n\nCreate a new initiative:\n\n1. **Vision**: What does success look like?\n2. **Scope**: Clear boundaries — what is in and out\n3. **Success Criteria**: Measurable outcomes\n4. **Epic Decomposition**: Break into epics with dependencies\n5. **Timeline**: Phased delivery plan\n6. **Risks**: What could go wrong and mitigations',
    E'# New Initiative\n\nDate: {{ date_long }}\nRepo: {{ repo_full }}\nNamespace: {{ namespace }}\n\n## Instructions\n\nCreate a new initiative:\n\n1. **Vision**: What does success look like?\n2. **Scope**: Clear boundaries — what is in and out\n3. **Success Criteria**: Measurable outcomes\n4. **Epic Decomposition**: Break into epics with dependencies\n5. **Timeline**: Phased delivery plan\n6. **Risks**: What could go wrong and mitigations',
    30
  ),
  (
    'default',
    'new_epic',
    'creation',
    true,
    'New Epic',
    'Create a new epic with issue breakdown, acceptance criteria, and implementation plan',
    E'# New Epic\n\nDate: {{ date_long }}\nRepo: {{ repo_full }}\nNamespace: {{ namespace }}\n\n## Instructions\n\nCreate a new epic:\n\n1. **Summary**: What this epic delivers\n2. **Issue Breakdown**: Individual issues with acceptance criteria\n3. **Dependency Graph**: Which issues block others\n4. **Safe Parallel Shipping Lists**: What can be worked on simultaneously\n5. **TDD Plan**: Testing strategy per issue\n6. **Database Changes**: Migration requirements (if any)\n7. **API Changes**: Endpoint additions/modifications (if any)',
    E'# New Epic\n\nDate: {{ date_long }}\nRepo: {{ repo_full }}\nNamespace: {{ namespace }}\n\n## Instructions\n\nCreate a new epic:\n\n1. **Summary**: What this epic delivers\n2. **Issue Breakdown**: Individual issues with acceptance criteria\n3. **Dependency Graph**: Which issues block others\n4. **Safe Parallel Shipping Lists**: What can be worked on simultaneously\n5. **TDD Plan**: Testing strategy per issue\n6. **Database Changes**: Migration requirements (if any)\n7. **API Changes**: Endpoint additions/modifications (if any)',
    40
  ),
  (
    'default',
    'new_bug',
    'creation',
    true,
    'New Bug/Issue',
    'Create a new bug report or issue with reproduction steps, expected behavior, and acceptance criteria',
    E'# New Bug/Issue\n\nDate: {{ date_long }}\nRepo: {{ repo_full }}\nNamespace: {{ namespace }}\n\n## Instructions\n\nCreate a bug report or issue:\n\n1. **Problem**: Clear description of what is broken\n2. **Current Behavior**: What happens now\n3. **Expected Behavior**: What should happen\n4. **Reproduction Steps**: Step-by-step instructions\n5. **Environment**: Branch, commit, relevant files\n6. **Acceptance Criteria**: How to verify the fix\n7. **Severity**: Impact assessment (critical/high/medium/low)',
    E'# New Bug/Issue\n\nDate: {{ date_long }}\nRepo: {{ repo_full }}\nNamespace: {{ namespace }}\n\n## Instructions\n\nCreate a bug report or issue:\n\n1. **Problem**: Clear description of what is broken\n2. **Current Behavior**: What happens now\n3. **Expected Behavior**: What should happen\n4. **Reproduction Steps**: Step-by-step instructions\n5. **Environment**: Branch, commit, relevant files\n6. **Acceptance Criteria**: How to verify the fix\n7. **Severity**: Impact assessment (critical/high/medium/low)',
    50
  ),
  (
    'default',
    'triage',
    'triage',
    true,
    'Triage Bugs/Issues',
    'Triage bugs and issues — assess severity, priority, assign categories, and suggest resolution order',
    E'# Triage Bugs/Issues\n\nDate: {{ date_long }}\nRepo: {{ repo_full }}\nNamespace: {{ namespace }}\n\n## Instructions\n\nTriage open bugs and issues:\n\n1. **Categorize**: Group by component/area\n2. **Severity Assessment**: Rate each (critical/high/medium/low)\n3. **Priority Ordering**: Suggest resolution order based on impact and dependencies\n4. **Quick Wins**: Identify issues that can be fixed rapidly\n5. **Blockers**: Flag issues blocking other work\n6. **Stale Issues**: Identify issues that need attention or closure',
    E'# Triage Bugs/Issues\n\nDate: {{ date_long }}\nRepo: {{ repo_full }}\nNamespace: {{ namespace }}\n\n## Instructions\n\nTriage open bugs and issues:\n\n1. **Categorize**: Group by component/area\n2. **Severity Assessment**: Rate each (critical/high/medium/low)\n3. **Priority Ordering**: Suggest resolution order based on impact and dependencies\n4. **Quick Wins**: Identify issues that can be fixed rapidly\n5. **Blockers**: Flag issues blocking other work\n6. **Stale Issues**: Identify issues that need attention or closure',
    60
  ),
  (
    'default',
    'omnibus_issues',
    'shipping',
    true,
    'Ship Issues (Omnibus PR)',
    'Ship a collection of bugs/issues in an omnibus PR with proper testing and review',
    E'# Ship Issues (Omnibus PR)\n\nDate: {{ date_long }}\nRepo: {{ repo_full }}\nNamespace: {{ namespace }}\n\n## Instructions\n\nShip a collection of issues as an omnibus PR:\n\n1. **Issue Selection**: List issues to include with their acceptance criteria\n2. **Implementation Order**: Determine safe implementation sequence\n3. **TDD**: Write failing tests first for each issue\n4. **Atomic Commits**: One commit per issue, format: [#NN] Description\n5. **PR Creation**: Title format: [#NN] Omnibus: Brief description\n6. **Review**: Self-review for security and blind spots\n7. **CI**: Ensure all checks pass before merge',
    E'# Ship Issues (Omnibus PR)\n\nDate: {{ date_long }}\nRepo: {{ repo_full }}\nNamespace: {{ namespace }}\n\n## Instructions\n\nShip a collection of issues as an omnibus PR:\n\n1. **Issue Selection**: List issues to include with their acceptance criteria\n2. **Implementation Order**: Determine safe implementation sequence\n3. **TDD**: Write failing tests first for each issue\n4. **Atomic Commits**: One commit per issue, format: [#NN] Description\n5. **PR Creation**: Title format: [#NN] Omnibus: Brief description\n6. **Review**: Self-review for security and blind spots\n7. **CI**: Ensure all checks pass before merge',
    70
  ),
  (
    'default',
    'omnibus_epic',
    'shipping',
    true,
    'Ship Epic (Omnibus PR)',
    'Ship an entire epic in one or more omnibus PRs with phased delivery',
    E'# Ship Epic (Omnibus PR)\n\nDate: {{ date_long }}\nRepo: {{ repo_full }}\nNamespace: {{ namespace }}\n\n## Instructions\n\nShip an epic via omnibus PR(s):\n\n1. **Epic Analysis**: Review all issues in the epic\n2. **Phase Planning**: Group issues into safe shipping phases\n3. **Dependency Resolution**: Ensure blocking issues ship first\n4. **Implementation**: TDD for each issue, atomic commits\n5. **PR Strategy**: One PR per phase, or single omnibus if safe\n6. **Acceptance Verification**: Check all epic criteria are met\n7. **Documentation**: Update any affected docs or API specs',
    E'# Ship Epic (Omnibus PR)\n\nDate: {{ date_long }}\nRepo: {{ repo_full }}\nNamespace: {{ namespace }}\n\n## Instructions\n\nShip an epic via omnibus PR(s):\n\n1. **Epic Analysis**: Review all issues in the epic\n2. **Phase Planning**: Group issues into safe shipping phases\n3. **Dependency Resolution**: Ensure blocking issues ship first\n4. **Implementation**: TDD for each issue, atomic commits\n5. **PR Strategy**: One PR per phase, or single omnibus if safe\n6. **Acceptance Verification**: Check all epic criteria are met\n7. **Documentation**: Update any affected docs or API specs',
    80
  ),
  (
    'default',
    'omnibus_initiative',
    'shipping',
    true,
    'Ship Initiative (Omnibus PRs)',
    'Ship an initiative across one or more omnibus PRs with coordinated delivery',
    E'# Ship Initiative (Omnibus PRs)\n\nDate: {{ date_long }}\nRepo: {{ repo_full }}\nNamespace: {{ namespace }}\n\n## Instructions\n\nShip an initiative via coordinated omnibus PRs:\n\n1. **Initiative Review**: Assess all epics and their status\n2. **Phased Delivery Plan**: Map epics to delivery phases\n3. **Cross-Epic Dependencies**: Identify and resolve blocking relationships\n4. **Per-Epic PRs**: Create omnibus PR for each epic/phase\n5. **Integration Testing**: Verify cross-epic interactions\n6. **Success Criteria**: Validate initiative-level success metrics\n7. **Rollback Plan**: Document rollback strategy if issues arise',
    E'# Ship Initiative (Omnibus PRs)\n\nDate: {{ date_long }}\nRepo: {{ repo_full }}\nNamespace: {{ namespace }}\n\n## Instructions\n\nShip an initiative via coordinated omnibus PRs:\n\n1. **Initiative Review**: Assess all epics and their status\n2. **Phased Delivery Plan**: Map epics to delivery phases\n3. **Cross-Epic Dependencies**: Identify and resolve blocking relationships\n4. **Per-Epic PRs**: Create omnibus PR for each epic/phase\n5. **Integration Testing**: Verify cross-epic interactions\n6. **Success Criteria**: Validate initiative-level success metrics\n7. **Rollback Plan**: Document rollback strategy if issues arise',
    90
  )
ON CONFLICT (namespace, prompt_key) WHERE deleted_at IS NULL DO NOTHING;
