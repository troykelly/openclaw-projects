-- Issue #1273: Project-scoped memory with optional project_id

ALTER TABLE memory ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES work_item(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_memory_project_id ON memory (project_id) WHERE project_id IS NOT NULL;
