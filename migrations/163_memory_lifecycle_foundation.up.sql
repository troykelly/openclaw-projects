-- Issue #2464: Add is_active physical column to memory table + pgcron reaper job
-- Issue #2459: Add missing indexes for memory lifecycle queries
-- Issue #2450: Align memory_type enum across frontend, backend, and plugin
-- Part of Epic #2426 PR1 Foundation

-- ============================================================
-- 1. Expand memory_type enum with 'entity' and 'other' values
--    Source of truth: DB enum. Frontend, backend, plugin must match.
-- ============================================================
DO $$ BEGIN
  ALTER TYPE memory_type ADD VALUE 'entity' AFTER 'reference';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE memory_type ADD VALUE 'other' AFTER 'entity';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- 2. Add physical is_active column (Issue #2464)
--    Previously computed as (superseded_by IS NULL) in queries.
--    Physical column allows efficient indexing for reaper queries.
-- ============================================================
ALTER TABLE memory ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- Backfill: memories with superseded_by set are inactive
UPDATE memory SET is_active = false WHERE superseded_by IS NOT NULL AND is_active = true;

COMMENT ON COLUMN memory.is_active IS 'Soft-delete flag. false when superseded or reaped. Replaces computed (superseded_by IS NULL).';

-- ============================================================
-- 3. Add missing indexes (Issue #2459)
-- ============================================================

-- Partial index for reaper: efficiently find expired, active memories
CREATE INDEX IF NOT EXISTS idx_memory_expires_active
  ON memory(expires_at)
  WHERE expires_at IS NOT NULL AND is_active = true;

-- Partial index for digest clustering: active, embedded memories by namespace and date
CREATE INDEX IF NOT EXISTS idx_memory_ns_created_active_embedded
  ON memory(namespace, created_at)
  WHERE is_active = true AND embedding IS NOT NULL;

-- ============================================================
-- 4. Memory reaper function (Issue #2464)
--    Soft-deletes expired memories by setting is_active = false.
--    Enqueues internal_job for the worker to process.
-- ============================================================
CREATE OR REPLACE FUNCTION enqueue_expired_memory_reaper()
RETURNS integer
LANGUAGE sql
AS $$
  WITH expired AS (
    SELECT m.id, m.namespace
      FROM memory m
     WHERE m.expires_at IS NOT NULL
       AND m.expires_at < now()
       AND m.is_active = true
     LIMIT 1000  -- Batch size to avoid long-running transactions
  ),
  inserted AS (
    INSERT INTO internal_job (kind, run_at, payload, idempotency_key)
    SELECT 'memory.reaper.expired',
           now(),
           jsonb_build_object(
             'memory_id', e.id::text,
             'namespace', e.namespace
           ),
           'memory_reaper:' || e.id::text
      FROM expired e
    ON CONFLICT (kind, idempotency_key) DO NOTHING
    RETURNING 1
  )
  SELECT count(*)::int FROM inserted;
$$;

COMMENT ON FUNCTION enqueue_expired_memory_reaper() IS 'Enqueues internal jobs for expired memories that need soft-deletion (is_active=false)';

-- ============================================================
-- 5. Register pg_cron job for memory reaper (Issue #2464)
--    Runs every 6 hours by default.
-- ============================================================
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'internal_memory_reaper_enqueue') THEN
    PERFORM cron.schedule(
      'internal_memory_reaper_enqueue',
      '0 */6 * * *',
      $cmd$SELECT enqueue_expired_memory_reaper();$cmd$
    );
  END IF;
END $do$;
