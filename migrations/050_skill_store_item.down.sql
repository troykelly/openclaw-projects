-- Migration 050: Skill Store Item Schema (Rollback)
-- Part of Epic #794, Issue #795
-- WARNING: This will permanently delete all skill store items

-- Remove pgcron jobs
DO $do$
BEGIN
  PERFORM cron.unschedule('skill_store_cleanup_expired');
EXCEPTION WHEN OTHERS THEN NULL;
END $do$;

DO $do$
BEGIN
  PERFORM cron.unschedule('skill_store_purge_soft_deleted');
EXCEPTION WHEN OTHERS THEN NULL;
END $do$;

-- Remove table first (cascades triggers and indexes)
DROP TABLE IF EXISTS skill_store_item;

-- Remove functions (safe now that dependent triggers are gone)
DROP FUNCTION IF EXISTS skill_store_purge_soft_deleted();
DROP FUNCTION IF EXISTS skill_store_cleanup_expired();
DROP FUNCTION IF EXISTS update_skill_store_item_updated_at();
DROP FUNCTION IF EXISTS skill_store_item_search_vector_update();

-- Remove enum type
DROP TYPE IF EXISTS skill_store_item_status;
