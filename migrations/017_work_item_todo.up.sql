-- Work Item Todo table for checklists/todos attached to work items
-- Issue #108

CREATE TABLE IF NOT EXISTS work_item_todo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id uuid NOT NULL REFERENCES work_item(id) ON DELETE CASCADE,
  text text NOT NULL,
  completed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

-- Index for efficient lookup by work item
CREATE INDEX idx_work_item_todo_work_item_id ON work_item_todo(work_item_id);

-- Index for filtering by completion status
CREATE INDEX idx_work_item_todo_completed ON work_item_todo(completed);
