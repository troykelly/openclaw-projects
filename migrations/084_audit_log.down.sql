-- Migration 084: Drop audit log table
-- Issue #1339, Epic #1322 (JWT Auth)

DROP INDEX IF EXISTS idx_audit_log_actor_email_hash;
DROP INDEX IF EXISTS idx_audit_log_created_at;
DROP INDEX IF EXISTS idx_audit_log_event_type;
DROP TABLE IF EXISTS audit_log;
