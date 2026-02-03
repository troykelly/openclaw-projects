-- Migration 040: Notes and Notebooks Schema (DOWN)
-- Part of Epic #337, Issue #340
-- Reverses all changes from the up migration

-- Drop views first
DROP VIEW IF EXISTS notebook_trash;
DROP VIEW IF EXISTS note_trash;
DROP VIEW IF EXISTS notebook_active;
DROP VIEW IF EXISTS note_active;

-- Drop triggers
DROP TRIGGER IF EXISTS note_embedding_pending_trigger ON note;
DROP TRIGGER IF EXISTS note_search_vector_trigger ON note;
DROP TRIGGER IF EXISTS note_updated_at_trigger ON note;
DROP TRIGGER IF EXISTS notebook_updated_at_trigger ON notebook;

-- Drop functions
DROP FUNCTION IF EXISTS note_embedding_pending_on_change();
DROP FUNCTION IF EXISTS note_search_vector_update();
DROP FUNCTION IF EXISTS update_note_updated_at();
DROP FUNCTION IF EXISTS update_notebook_updated_at();

-- Drop indexes
DROP INDEX IF EXISTS idx_note_embedding_pending;
DROP INDEX IF EXISTS idx_note_embedding;
DROP INDEX IF EXISTS idx_note_search_vector;
DROP INDEX IF EXISTS idx_note_tags;
DROP INDEX IF EXISTS idx_note_pinned;
DROP INDEX IF EXISTS idx_note_updated_at;
DROP INDEX IF EXISTS idx_note_created_at;
DROP INDEX IF EXISTS idx_note_user_not_deleted;
DROP INDEX IF EXISTS idx_note_visibility;
DROP INDEX IF EXISTS idx_note_user_email;
DROP INDEX IF EXISTS idx_note_notebook_id;
DROP INDEX IF EXISTS idx_notebook_user_not_deleted;
DROP INDEX IF EXISTS idx_notebook_parent;
DROP INDEX IF EXISTS idx_notebook_user_email;

-- Drop tables (note first due to FK dependency)
DROP TABLE IF EXISTS note;
DROP TABLE IF EXISTS notebook;
