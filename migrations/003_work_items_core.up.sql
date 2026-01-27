-- Issue #3: Core work item model + participants + dependency edges

CREATE TABLE IF NOT EXISTS work_item (
  id uuid PRIMARY KEY DEFAULT new_uuid(),
  title text NOT NULL CHECK (length(trim(title)) > 0),
  description text,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS work_item_status_idx ON work_item(status);
CREATE INDEX IF NOT EXISTS work_item_created_at_idx ON work_item(created_at);

CREATE TABLE IF NOT EXISTS work_item_participant (
  id uuid PRIMARY KEY DEFAULT new_uuid(),
  work_item_id uuid NOT NULL REFERENCES work_item(id) ON DELETE CASCADE,
  participant text NOT NULL CHECK (length(trim(participant)) > 0),
  role text NOT NULL CHECK (length(trim(role)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (work_item_id, participant, role)
);

CREATE INDEX IF NOT EXISTS work_item_participant_work_item_idx ON work_item_participant(work_item_id);

CREATE TABLE IF NOT EXISTS work_item_dependency (
  id uuid PRIMARY KEY DEFAULT new_uuid(),
  work_item_id uuid NOT NULL REFERENCES work_item(id) ON DELETE CASCADE,
  depends_on_work_item_id uuid NOT NULL REFERENCES work_item(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'depends_on' CHECK (length(trim(kind)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (work_item_id <> depends_on_work_item_id),
  UNIQUE (work_item_id, depends_on_work_item_id, kind)
);

CREATE INDEX IF NOT EXISTS work_item_dependency_work_item_idx ON work_item_dependency(work_item_id);
CREATE INDEX IF NOT EXISTS work_item_dependency_depends_on_idx ON work_item_dependency(depends_on_work_item_id);
