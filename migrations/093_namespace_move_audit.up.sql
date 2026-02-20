-- Issue #1483: Add 'namespace_move' to enum types for tracking entity moves.

-- Add to audit_action_type (audit_log table, migration 034)
ALTER TYPE audit_action_type ADD VALUE IF NOT EXISTS 'namespace_move';

-- Add to work_item_activity_type (work_item_activity table, migration 015)
ALTER TYPE work_item_activity_type ADD VALUE IF NOT EXISTS 'namespace_move';
