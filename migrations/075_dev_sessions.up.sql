-- Issue #1285: Dev session tracking with agent callback webhooks
-- Tracks long-running agent development sessions with structured state.

CREATE TABLE IF NOT EXISTS dev_session (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email          text NOT NULL,
  project_id          uuid REFERENCES work_item(id) ON DELETE SET NULL,
  session_name        text NOT NULL,
  node                text NOT NULL,
  container           text,
  container_user      text,
  repo_org            text,
  repo_name           text,
  branch              text,
  status              text NOT NULL DEFAULT 'active',
  task_summary        text,
  task_prompt         text,
  linked_issues       text[] NOT NULL DEFAULT '{}',
  linked_prs          text[] NOT NULL DEFAULT '{}',
  context_pct         integer,
  last_capture        text,
  last_capture_at     timestamptz,
  webhook_id          uuid REFERENCES project_webhook(id) ON DELETE SET NULL,
  completion_summary  text,
  started_at          timestamptz NOT NULL DEFAULT now(),
  completed_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dev_session_status ON dev_session (status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_dev_session_project ON dev_session (project_id) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dev_session_node ON dev_session (node);
CREATE INDEX IF NOT EXISTS idx_dev_session_user ON dev_session (user_email);
