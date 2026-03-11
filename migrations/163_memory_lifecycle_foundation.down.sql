-- Down migration for Issue #2464, #2459, #2450
-- Part of Epic #2426 PR1 Foundation

-- Remove cron job
SELECT cron.unschedule('internal_memory_reaper_enqueue')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'internal_memory_reaper_enqueue');

-- Drop reaper function
DROP FUNCTION IF EXISTS enqueue_expired_memory_reaper();

-- Drop indexes
DROP INDEX IF EXISTS idx_memory_expires_active;
DROP INDEX IF EXISTS idx_memory_ns_created_active_embedded;

-- Drop is_active column
ALTER TABLE memory DROP COLUMN IF EXISTS is_active;

-- Note: Cannot remove enum values from PostgreSQL enums without recreating the type.
-- 'entity' and 'other' values will remain harmless if unused.
