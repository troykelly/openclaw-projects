-- Issue #1273: Project-scoped memory with optional project_id

ALTER TABLE memory ADD COLUMN project_id uuid REFERENCES work_item(id) ON DELETE SET NULL;

CREATE INDEX idx_memory_project_id ON memory (project_id) WHERE project_id IS NOT NULL;
