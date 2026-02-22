-- ============================================================
-- Down migration 113: Drop contact_merge_log table
-- ============================================================

DROP INDEX IF EXISTS idx_contact_merge_log_merged_at;
DROP INDEX IF EXISTS idx_contact_merge_log_loser;
DROP INDEX IF EXISTS idx_contact_merge_log_survivor;
DROP TABLE IF EXISTS contact_merge_log;
