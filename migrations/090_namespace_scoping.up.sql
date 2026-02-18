-- ============================================================
-- Migration 090: Namespace scoping for all entities
-- Epic #1418 — replaces user_email scoping with namespace-based data partitioning
-- See: docs/plans/2026-02-18-namespace-scoping-design.md Section 9.1
-- ============================================================

-- ============================================================
-- STEP 1: namespace_grant table
-- Maps users to namespaces with roles. The sole mechanism for
-- dashboard user data access. M2M (agent) tokens are unrestricted.
-- ============================================================
CREATE TABLE IF NOT EXISTS namespace_grant (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text NOT NULL REFERENCES user_setting(email) ON DELETE CASCADE,
  namespace   text NOT NULL
                CHECK (namespace ~ '^[a-z0-9][a-z0-9._-]*$' AND length(namespace) <= 63),
  role        text NOT NULL DEFAULT 'member'
                CHECK (role IN ('owner', 'admin', 'member', 'observer')),
  is_default  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (email = lower(email)),
  UNIQUE(email, namespace)
);

CREATE INDEX IF NOT EXISTS idx_namespace_grant_email ON namespace_grant(email);
CREATE INDEX IF NOT EXISTS idx_namespace_grant_namespace ON namespace_grant(namespace);

-- Ensure at most one default namespace per user
CREATE UNIQUE INDEX IF NOT EXISTS idx_namespace_grant_default
  ON namespace_grant(email) WHERE is_default = true;

-- Trigger to update updated_at on namespace_grant
CREATE OR REPLACE FUNCTION update_namespace_grant_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER namespace_grant_updated_at
  BEFORE UPDATE ON namespace_grant
  FOR EACH ROW
  EXECUTE FUNCTION update_namespace_grant_updated_at();

-- ============================================================
-- STEP 2: Bootstrap per-user namespaces from existing data
-- Creates a personal namespace for each known user (from user_setting).
-- Namespace name derived from email local part (slugified).
-- ============================================================
INSERT INTO namespace_grant (email, namespace, role, is_default)
SELECT
  lower(email),
  lower(regexp_replace(split_part(lower(email), '@', 1), '[^a-z0-9]', '-', 'g')),
  'owner',
  true
FROM user_setting
ON CONFLICT (email, namespace) DO NOTHING;

-- Also give everyone access to 'default' for historically-unscoped data
-- (rows with NULL user_email will remain in 'default')
INSERT INTO namespace_grant (email, namespace, role, is_default)
SELECT lower(email), 'default', 'member', false
FROM user_setting
ON CONFLICT (email, namespace) DO NOTHING;

-- ============================================================
-- STEP 3: Add namespace column to all entity tables
-- Default is 'default' — rows with user_email are backfilled in Step 4.
-- CHECK constraint enforces naming pattern on every table.
-- ============================================================

-- Helper: reusable CHECK expression
-- Pattern: starts with lowercase letter/digit, then lowercase letters/digits/dots/hyphens/underscores
-- Max 63 chars (DNS label compatibility)

ALTER TABLE work_item ADD COLUMN IF NOT EXISTS namespace text NOT NULL DEFAULT 'default'
  CHECK (namespace ~ '^[a-z0-9][a-z0-9._-]*$' AND length(namespace) <= 63);
ALTER TABLE memory ADD COLUMN IF NOT EXISTS namespace text NOT NULL DEFAULT 'default'
  CHECK (namespace ~ '^[a-z0-9][a-z0-9._-]*$' AND length(namespace) <= 63);
ALTER TABLE contact ADD COLUMN IF NOT EXISTS namespace text NOT NULL DEFAULT 'default'
  CHECK (namespace ~ '^[a-z0-9][a-z0-9._-]*$' AND length(namespace) <= 63);
ALTER TABLE contact_endpoint ADD COLUMN IF NOT EXISTS namespace text NOT NULL DEFAULT 'default'
  CHECK (namespace ~ '^[a-z0-9][a-z0-9._-]*$' AND length(namespace) <= 63);
ALTER TABLE relationship ADD COLUMN IF NOT EXISTS namespace text NOT NULL DEFAULT 'default'
  CHECK (namespace ~ '^[a-z0-9][a-z0-9._-]*$' AND length(namespace) <= 63);
ALTER TABLE external_thread ADD COLUMN IF NOT EXISTS namespace text NOT NULL DEFAULT 'default'
  CHECK (namespace ~ '^[a-z0-9][a-z0-9._-]*$' AND length(namespace) <= 63);
ALTER TABLE external_message ADD COLUMN IF NOT EXISTS namespace text NOT NULL DEFAULT 'default'
  CHECK (namespace ~ '^[a-z0-9][a-z0-9._-]*$' AND length(namespace) <= 63);
ALTER TABLE notebook ADD COLUMN IF NOT EXISTS namespace text NOT NULL DEFAULT 'default'
  CHECK (namespace ~ '^[a-z0-9][a-z0-9._-]*$' AND length(namespace) <= 63);
ALTER TABLE note ADD COLUMN IF NOT EXISTS namespace text NOT NULL DEFAULT 'default'
  CHECK (namespace ~ '^[a-z0-9][a-z0-9._-]*$' AND length(namespace) <= 63);
ALTER TABLE notification ADD COLUMN IF NOT EXISTS namespace text NOT NULL DEFAULT 'default'
  CHECK (namespace ~ '^[a-z0-9][a-z0-9._-]*$' AND length(namespace) <= 63);
ALTER TABLE list ADD COLUMN IF NOT EXISTS namespace text NOT NULL DEFAULT 'default'
  CHECK (namespace ~ '^[a-z0-9][a-z0-9._-]*$' AND length(namespace) <= 63);
ALTER TABLE recipe ADD COLUMN IF NOT EXISTS namespace text NOT NULL DEFAULT 'default'
  CHECK (namespace ~ '^[a-z0-9][a-z0-9._-]*$' AND length(namespace) <= 63);
ALTER TABLE meal_log ADD COLUMN IF NOT EXISTS namespace text NOT NULL DEFAULT 'default'
  CHECK (namespace ~ '^[a-z0-9][a-z0-9._-]*$' AND length(namespace) <= 63);
ALTER TABLE pantry_item ADD COLUMN IF NOT EXISTS namespace text NOT NULL DEFAULT 'default'
  CHECK (namespace ~ '^[a-z0-9][a-z0-9._-]*$' AND length(namespace) <= 63);
ALTER TABLE entity_link ADD COLUMN IF NOT EXISTS namespace text NOT NULL DEFAULT 'default'
  CHECK (namespace ~ '^[a-z0-9][a-z0-9._-]*$' AND length(namespace) <= 63);
ALTER TABLE context ADD COLUMN IF NOT EXISTS namespace text NOT NULL DEFAULT 'default'
  CHECK (namespace ~ '^[a-z0-9][a-z0-9._-]*$' AND length(namespace) <= 63);
ALTER TABLE file_attachment ADD COLUMN IF NOT EXISTS namespace text NOT NULL DEFAULT 'default'
  CHECK (namespace ~ '^[a-z0-9][a-z0-9._-]*$' AND length(namespace) <= 63);
ALTER TABLE file_share ADD COLUMN IF NOT EXISTS namespace text NOT NULL DEFAULT 'default'
  CHECK (namespace ~ '^[a-z0-9][a-z0-9._-]*$' AND length(namespace) <= 63);
ALTER TABLE skill_store_item ADD COLUMN IF NOT EXISTS namespace text NOT NULL DEFAULT 'default'
  CHECK (namespace ~ '^[a-z0-9][a-z0-9._-]*$' AND length(namespace) <= 63);

-- ============================================================
-- STEP 4: Backfill — migrate existing data to per-user namespaces
-- Each row's namespace is set to its user_email's default namespace.
-- Rows with NULL user_email stay in 'default' (historically unscoped).
-- ============================================================
UPDATE work_item wi SET namespace = ng.namespace
  FROM namespace_grant ng WHERE ng.email = lower(wi.user_email) AND ng.is_default = true AND wi.user_email IS NOT NULL;
UPDATE memory m SET namespace = ng.namespace
  FROM namespace_grant ng WHERE ng.email = lower(m.user_email) AND ng.is_default = true AND m.user_email IS NOT NULL;
UPDATE contact c SET namespace = ng.namespace
  FROM namespace_grant ng WHERE ng.email = lower(c.user_email) AND ng.is_default = true AND c.user_email IS NOT NULL;
UPDATE contact_endpoint ce SET namespace = ng.namespace
  FROM namespace_grant ng WHERE ng.email = lower(ce.user_email) AND ng.is_default = true AND ce.user_email IS NOT NULL;
UPDATE relationship r SET namespace = ng.namespace
  FROM namespace_grant ng WHERE ng.email = lower(r.user_email) AND ng.is_default = true AND r.user_email IS NOT NULL;
UPDATE external_thread et SET namespace = ng.namespace
  FROM namespace_grant ng WHERE ng.email = lower(et.user_email) AND ng.is_default = true AND et.user_email IS NOT NULL;
UPDATE external_message em SET namespace = ng.namespace
  FROM namespace_grant ng WHERE ng.email = lower(em.user_email) AND ng.is_default = true AND em.user_email IS NOT NULL;
UPDATE notebook nb SET namespace = ng.namespace
  FROM namespace_grant ng WHERE ng.email = lower(nb.user_email) AND ng.is_default = true;
UPDATE note n SET namespace = ng.namespace
  FROM namespace_grant ng WHERE ng.email = lower(n.user_email) AND ng.is_default = true;
UPDATE notification ntf SET namespace = ng.namespace
  FROM namespace_grant ng WHERE ng.email = lower(ntf.user_email) AND ng.is_default = true;
UPDATE recipe r SET namespace = ng.namespace
  FROM namespace_grant ng WHERE ng.email = lower(r.user_email) AND ng.is_default = true;
UPDATE meal_log ml SET namespace = ng.namespace
  FROM namespace_grant ng WHERE ng.email = lower(ml.user_email) AND ng.is_default = true;
UPDATE pantry_item pi SET namespace = ng.namespace
  FROM namespace_grant ng WHERE ng.email = lower(pi.user_email) AND ng.is_default = true AND pi.user_email IS NOT NULL;
UPDATE entity_link el SET namespace = ng.namespace
  FROM namespace_grant ng WHERE ng.email = lower(el.user_email) AND ng.is_default = true AND el.user_email IS NOT NULL;
UPDATE skill_store_item ssi SET namespace = ng.namespace
  FROM namespace_grant ng WHERE ng.email = lower(ssi.user_email) AND ng.is_default = true AND ssi.user_email IS NOT NULL;
-- file_attachment has no user_email (only uploaded_by attribution) — stays 'default'
-- file_share has no user_email (only created_by attribution) — stays 'default'
-- list has no user_email — stays 'default'
-- context has no user_email — stays 'default'

-- ============================================================
-- STEP 5: Indexes on namespace column for efficient filtered queries
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_work_item_namespace ON work_item(namespace);
CREATE INDEX IF NOT EXISTS idx_memory_namespace ON memory(namespace);
CREATE INDEX IF NOT EXISTS idx_contact_namespace ON contact(namespace);
CREATE INDEX IF NOT EXISTS idx_contact_endpoint_namespace ON contact_endpoint(namespace);
CREATE INDEX IF NOT EXISTS idx_relationship_namespace ON relationship(namespace);
CREATE INDEX IF NOT EXISTS idx_external_thread_namespace ON external_thread(namespace);
CREATE INDEX IF NOT EXISTS idx_external_message_namespace ON external_message(namespace);
CREATE INDEX IF NOT EXISTS idx_notebook_namespace ON notebook(namespace);
CREATE INDEX IF NOT EXISTS idx_note_namespace ON note(namespace);
CREATE INDEX IF NOT EXISTS idx_notification_namespace ON notification(namespace);
CREATE INDEX IF NOT EXISTS idx_list_namespace ON list(namespace);
CREATE INDEX IF NOT EXISTS idx_recipe_namespace ON recipe(namespace);
CREATE INDEX IF NOT EXISTS idx_meal_log_namespace ON meal_log(namespace);
CREATE INDEX IF NOT EXISTS idx_pantry_item_namespace ON pantry_item(namespace);
CREATE INDEX IF NOT EXISTS idx_entity_link_namespace ON entity_link(namespace);
CREATE INDEX IF NOT EXISTS idx_context_namespace ON context(namespace);
CREATE INDEX IF NOT EXISTS idx_file_attachment_namespace ON file_attachment(namespace);
CREATE INDEX IF NOT EXISTS idx_file_share_namespace ON file_share(namespace);
CREATE INDEX IF NOT EXISTS idx_skill_store_item_namespace ON skill_store_item(namespace);
