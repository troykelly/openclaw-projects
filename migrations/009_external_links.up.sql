-- Issue #7: External links for work items

CREATE TABLE IF NOT EXISTS work_item_external_link (
  id uuid PRIMARY KEY DEFAULT new_uuid(),
  work_item_id uuid NOT NULL REFERENCES work_item(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (length(trim(provider)) > 0),
  url text NOT NULL CHECK (length(trim(url)) > 0),
  external_id text NOT NULL CHECK (length(trim(external_id)) > 0),
  github_owner text,
  github_repo text,
  github_kind text,
  github_number integer,
  github_node_id text,
  github_project_node_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    provider <> 'github'
    OR (
      github_owner IS NOT NULL
      AND github_repo IS NOT NULL
      AND github_kind IN ('issue', 'pr', 'project')
      AND (github_kind = 'project' OR github_number IS NOT NULL)
    )
  ),
  UNIQUE (provider, url),
  UNIQUE (provider, work_item_id, external_id)
);

CREATE INDEX IF NOT EXISTS work_item_external_link_work_item_idx ON work_item_external_link(work_item_id);
CREATE INDEX IF NOT EXISTS work_item_external_link_provider_idx ON work_item_external_link(provider);
