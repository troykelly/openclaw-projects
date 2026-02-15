-- Issue #1274: Ad-hoc webhook ingestion linked to projects
-- Creates tables for webhook endpoints and their received events.

CREATE TABLE IF NOT EXISTS project_webhook (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES work_item(id) ON DELETE CASCADE,
  user_email      text NOT NULL,
  label           text NOT NULL,
  token           text NOT NULL,
  payload_mapping jsonb NOT NULL DEFAULT '{}',
  is_active       boolean NOT NULL DEFAULT true,
  last_received   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_webhook_project ON project_webhook (project_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_webhook_token ON project_webhook (token);

CREATE TABLE IF NOT EXISTS project_event (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES work_item(id) ON DELETE CASCADE,
  webhook_id      uuid REFERENCES project_webhook(id) ON DELETE SET NULL,
  user_email      text NOT NULL,
  event_type      text NOT NULL DEFAULT 'webhook',
  summary         text,
  raw_payload     jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_event_project ON project_event (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_event_webhook ON project_event (webhook_id);
