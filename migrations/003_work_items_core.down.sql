-- Issue #3 rollback

-- Use CASCADE so rollbacks are robust even if later migrations (or partial runs)
-- left dependent objects behind.
DROP TABLE IF EXISTS work_item_dependency CASCADE;
DROP TABLE IF EXISTS work_item_participant CASCADE;
DROP TABLE IF EXISTS work_item CASCADE;
