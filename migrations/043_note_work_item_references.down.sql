-- Migration 043: Note Work Item References (DOWN)
-- Part of Epic #337, Issue #343
-- Reverses all changes from the up migration

-- Drop views
DROP VIEW IF EXISTS work_item_note_backlinks;
DROP VIEW IF EXISTS note_with_references;

-- Drop indexes
DROP INDEX IF EXISTS idx_note_work_item_ref_type;
DROP INDEX IF EXISTS idx_note_work_item_ref_work_item;
DROP INDEX IF EXISTS idx_note_work_item_ref_note;

-- Drop table
DROP TABLE IF EXISTS note_work_item_reference;
