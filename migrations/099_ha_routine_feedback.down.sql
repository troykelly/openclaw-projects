-- ============================================================
-- Migration 099 (rollback): Drop ha_routine_feedback table
-- Issue #1466
-- ============================================================

DROP TABLE IF EXISTS ha_routine_feedback;
