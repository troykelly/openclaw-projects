-- Migration 052 down: Remove Skill Store Activity tracking (issue #808)

DROP TABLE IF EXISTS skill_store_activity;
DROP TYPE IF EXISTS skill_store_activity_type;
