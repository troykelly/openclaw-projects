-- Migration 015 down: Remove work item activity tracking

DROP TABLE IF EXISTS work_item_activity CASCADE;
DROP TYPE IF EXISTS work_item_activity_type CASCADE;
