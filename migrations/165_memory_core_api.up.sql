-- Issue #2427: Memory Digest — vector clustering support
-- Issue #2428: Expired Memory Reaper — hard-delete cascade
-- Issue #2429: Bulk Supersession — atomic memory consolidation
-- Issue #2432: Memory Upsert-by-Tag — sliding window slot management
-- Issue #2439: Server-side cap for digest endpoint
-- Issue #2440: Namespace-scope reaper cascade
-- Issue #2441: Bulk supersede atomicity
-- Part of Epic #2426 PR2 Core API

-- ============================================================
-- 1. unified_memory_attachment alias if not present
--    The hard-delete reaper cascades attachments via this table.
-- ============================================================
-- unified_memory_attachment already exists from earlier migrations.
-- No schema change needed — reaper will use it in application layer.

-- ============================================================
-- 2. Ensure superseded_by FK ON DELETE SET NULL (from migration 164)
--    is the only FK on superseded_by — idempotent check.
-- ============================================================
-- Already handled in migration 164.

-- No additional schema changes needed — all new features are application-layer.
-- The application service code handles:
--   - digest endpoint with server-side cap
--   - hard-delete cascade through application (not DB trigger)
--   - bulk-supersede atomically in a transaction with FOR UPDATE
--   - upsert-by-tag via application query
