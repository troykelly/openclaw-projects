-- ============================================================
-- Migration 103 DOWN: Remove priority column from namespace_grant
-- Issue #1535 — Epic #1533
-- ============================================================

ALTER TABLE namespace_grant DROP COLUMN IF EXISTS priority;
