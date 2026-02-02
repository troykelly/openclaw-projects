-- Migration: Remove soft delete support
-- Part of Issue #225

-- Drop views
DROP VIEW IF EXISTS work_item_trash;
DROP VIEW IF EXISTS contact_trash;
DROP VIEW IF EXISTS work_item_active;
DROP VIEW IF EXISTS contact_active;

-- Drop purge function
DROP FUNCTION IF EXISTS purge_soft_deleted(integer);

-- Drop indexes
DROP INDEX IF EXISTS idx_work_item_deleted_at;
DROP INDEX IF EXISTS idx_contact_deleted_at;

-- Remove columns
ALTER TABLE work_item DROP COLUMN IF EXISTS deleted_at;
ALTER TABLE contact DROP COLUMN IF EXISTS deleted_at;
