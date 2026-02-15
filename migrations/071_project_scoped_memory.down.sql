-- Issue #1273: Revert project-scoped memory

DROP INDEX IF EXISTS idx_memory_project_id;

ALTER TABLE memory DROP COLUMN IF EXISTS project_id;
