-- Work Item Memory table for persistent notes/context attached to work items
-- Issue #138

CREATE TYPE memory_type AS ENUM ('note', 'decision', 'context', 'reference');

CREATE TABLE IF NOT EXISTS work_item_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id uuid NOT NULL REFERENCES work_item(id) ON DELETE CASCADE,
  title text NOT NULL,
  content text NOT NULL,
  memory_type memory_type NOT NULL DEFAULT 'note',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Index for efficient lookup by work item
CREATE INDEX idx_work_item_memory_work_item_id ON work_item_memory(work_item_id);

-- Index for filtering by memory type
CREATE INDEX idx_work_item_memory_type ON work_item_memory(memory_type);
